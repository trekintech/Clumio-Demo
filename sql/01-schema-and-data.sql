-- Kerbside finance: the RDS side of the demo. PostgreSQL.
--
-- Run against your existing RDS Postgres instance, before taking the Clumio
-- backup. Paste into a pgAdmin query window, or:
--
--   psql -h <endpoint> -U <user> -d <database> -f sql/01-schema-and-data.sql
--
-- Everything lives in its own schema, so it can't collide with anything else
-- already on the instance and is trivial to remove afterwards.
--
-- Generates Q1 2025 trading for three restaurants: 810 orders, and the weekly
-- settlements computed from them so the payouts reconcile to the orders
-- exactly. That reconciliation is the first thing an auditor checks, so it has
-- to hold.

-- Drops and recreates only this schema. Nothing else on the instance is touched.
DROP SCHEMA IF EXISTS kerbside_finance CASCADE;
CREATE SCHEMA kerbside_finance;
SET search_path TO kerbside_finance;

CREATE TABLE tenants (
  tenant_slug   VARCHAR(64)  PRIMARY KEY,
  trading_name  VARCHAR(128) NOT NULL,
  onboarded_on  DATE         NOT NULL
);

CREATE TABLE orders (
  order_id      BIGINT      PRIMARY KEY,
  tenant_slug   VARCHAR(64) NOT NULL REFERENCES tenants (tenant_slug),
  placed_at     TIMESTAMP   NOT NULL,
  gross_pence   INTEGER     NOT NULL,
  refund_pence  INTEGER     NOT NULL DEFAULT 0,
  refund_reason VARCHAR(64)
);

CREATE INDEX idx_orders_tenant_date ON orders (tenant_slug, placed_at);

-- One row per restaurant per trading week. Money is pence as integers;
-- storing currency as a float is how reconciliations end up a penny out.
CREATE TABLE settlements (
  settlement_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_slug      VARCHAR(64) NOT NULL REFERENCES tenants (tenant_slug),
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  gross_pence      INTEGER     NOT NULL,
  refunds_pence    INTEGER     NOT NULL,
  commission_pence INTEGER     NOT NULL,
  net_paid_pence   INTEGER     NOT NULL,
  paid_at          TIMESTAMP   NOT NULL,
  UNIQUE (tenant_slug, period_start)
);

INSERT INTO tenants (tenant_slug, trading_name, onboarded_on) VALUES
  ('alma-kitchen',     'Alma Kitchen',     DATE '2023-04-11'),
  ('brick-lane-grill', 'Brick Lane Grill', DATE '2022-11-02'),
  ('corner-pantry',    'Corner Pantry',    DATE '2024-01-15');

-- 810 orders: 3 restaurants x 3 orders a day x the 90 days of Q1 2025.
--
-- Two kinds of refund. A light scatter of 'item-unavailable' across the
-- quarter, which is ordinary trading noise, and a concentrated run of
-- 'duplicate-charge' refunds against Alma Kitchen in the week beginning
-- 10 February 2025. That week is what the audit query has to surface.
INSERT INTO orders (order_id, tenant_slug, placed_at, gross_pence, refund_pence, refund_reason)
SELECT
  400000 + n,
  CASE (n - 1) % 3
    WHEN 0 THEN 'alma-kitchen'
    WHEN 1 THEN 'brick-lane-grill'
    ELSE        'corner-pantry'
  END,
  (DATE '2025-01-01' + ((n - 1) / 9))::timestamp + ((11 + n % 9) * INTERVAL '1 hour'),
  800 + ((n * 37) % 2200),
  CASE
    WHEN (n - 1) % 3 = 0 AND ((n - 1) / 9) BETWEEN 40 AND 46 AND n % 2 = 0
      THEN 800 + ((n * 37) % 2200)
    WHEN n % 53 = 0
      THEN (800 + ((n * 37) % 2200)) / 2
    ELSE 0
  END,
  CASE
    WHEN (n - 1) % 3 = 0 AND ((n - 1) / 9) BETWEEN 40 AND 46 AND n % 2 = 0
      THEN 'duplicate-charge'
    WHEN n % 53 = 0
      THEN 'item-unavailable'
    ELSE NULL
  END
FROM generate_series(1, 810) AS n;

-- Settlements are derived from the orders rather than written independently,
-- so gross, refunds, commission and net always agree with the transactions
-- behind them. Commission is 18% of net-of-refunds. date_trunc('week', ...)
-- buckets by ISO week, which starts Monday.
INSERT INTO settlements
  (tenant_slug, period_start, period_end, gross_pence, refunds_pence, commission_pence, net_paid_pence, paid_at)
SELECT
  tenant_slug,
  wk_start,
  wk_start + 6,
  gross,
  refunds,
  ROUND((gross - refunds) * 0.18)::int,
  (gross - refunds) - ROUND((gross - refunds) * 0.18)::int,
  (wk_start + 9)::timestamp + INTERVAL '10 hours'
FROM (
  SELECT
    tenant_slug,
    date_trunc('week', placed_at)::date AS wk_start,
    SUM(gross_pence)::int               AS gross,
    SUM(refund_pence)::int              AS refunds
  FROM orders
  GROUP BY tenant_slug, date_trunc('week', placed_at)::date
) w;

-- Both checks should report zero failures.
SELECT 'settlements that do not reconcile' AS check_name, COUNT(*) AS failures
FROM settlements
WHERE net_paid_pence <> gross_pence - refunds_pence - commission_pence;

SELECT 'settlement totals not matching orders' AS check_name, COUNT(*) AS failures
FROM settlements s
JOIN (
  SELECT tenant_slug,
         date_trunc('week', placed_at)::date AS wk_start,
         SUM(gross_pence)::int  AS gross,
         SUM(refund_pence)::int AS refunds
  FROM orders
  GROUP BY tenant_slug, date_trunc('week', placed_at)::date
) o ON o.tenant_slug = s.tenant_slug AND o.wk_start = s.period_start
WHERE o.gross <> s.gross_pence OR o.refunds <> s.refunds_pence;

-- What the auditor will ask about later, as it stands today.
--
-- Commission is in the output deliberately. Net is gross - refunds -
-- commission, so without that column the row reads as though it does not
-- reconcile.
SELECT period_start AS week_beginning,
       ROUND(gross_pence      / 100.0, 2) AS gross_gbp,
       ROUND(refunds_pence    / 100.0, 2) AS refunds_gbp,
       ROUND(commission_pence / 100.0, 2) AS commission_gbp,
       ROUND(net_paid_pence   / 100.0, 2) AS net_paid_gbp
FROM settlements
WHERE tenant_slug = 'alma-kitchen'
  AND period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY period_start;
