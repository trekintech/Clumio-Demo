-- Kerbside finance database: the RDS side of the demo.
--
-- MySQL 8.0 or later (uses recursive CTEs and window functions).
-- Run against the live instance before taking the Clumio backup.
--
--   mysql -h <endpoint> -u admin -p < sql/01-schema-and-data.sql
--
-- Generates Q1 2025 trading for three restaurants: 810 orders and the weekly
-- settlements computed from them, so the payouts reconcile to the underlying
-- orders exactly. An auditor would check that, so it needs to hold.

CREATE DATABASE IF NOT EXISTS kerbside_finance
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kerbside_finance;

DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS tenants;

CREATE TABLE tenants (
  tenant_slug   VARCHAR(64)  NOT NULL PRIMARY KEY,
  trading_name  VARCHAR(128) NOT NULL,
  onboarded_on  DATE         NOT NULL
);

CREATE TABLE orders (
  order_id      BIGINT       NOT NULL PRIMARY KEY,
  tenant_slug   VARCHAR(64)  NOT NULL,
  placed_at     DATETIME     NOT NULL,
  gross_pence   INT          NOT NULL,
  refund_pence  INT          NOT NULL DEFAULT 0,
  refund_reason VARCHAR(64)  NULL,
  CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_slug) REFERENCES tenants (tenant_slug),
  INDEX idx_orders_tenant_date (tenant_slug, placed_at)
);

-- One row per restaurant per trading week. Money is held in pence as integers;
-- storing currency as a float is how reconciliations end up off by a penny.
CREATE TABLE settlements (
  settlement_id    BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_slug      VARCHAR(64) NOT NULL,
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  gross_pence      INT         NOT NULL,
  refunds_pence    INT         NOT NULL,
  commission_pence INT         NOT NULL,
  net_paid_pence   INT         NOT NULL,
  paid_at          DATETIME    NOT NULL,
  CONSTRAINT fk_settlements_tenant FOREIGN KEY (tenant_slug) REFERENCES tenants (tenant_slug),
  UNIQUE KEY uq_settlement (tenant_slug, period_start)
);

INSERT INTO tenants (tenant_slug, trading_name, onboarded_on) VALUES
  ('alma-kitchen',     'Alma Kitchen',     '2023-04-11'),
  ('brick-lane-grill', 'Brick Lane Grill', '2022-11-02'),
  ('corner-pantry',    'Corner Pantry',    '2024-01-15');

-- The recursive CTE default caps out at 1000 rows.
SET SESSION cte_max_recursion_depth = 10000;

-- 810 orders: 3 restaurants x 3 orders a day x 90 days of Q1 2025.
--
-- Two kinds of refund are seeded. A light scatter of 'item-unavailable'
-- across the quarter, which is normal trading noise, and a concentrated run
-- of 'duplicate-charge' refunds against Alma Kitchen in the week beginning
-- 10 February 2025. That week is what the audit query has to surface.
INSERT INTO orders (order_id, tenant_slug, placed_at, gross_pence, refund_pence, refund_reason)
WITH RECURSIVE seq (n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 810
)
SELECT
  400000 + n,
  CASE (n - 1) % 3
    WHEN 0 THEN 'alma-kitchen'
    WHEN 1 THEN 'brick-lane-grill'
    ELSE        'corner-pantry'
  END,
  TIMESTAMPADD(HOUR, 11 + (n % 9), TIMESTAMP(DATE_ADD('2025-01-01', INTERVAL FLOOR((n - 1) / 9) DAY))),
  800 + ((n * 37) % 2200),
  CASE
    WHEN (n - 1) % 3 = 0 AND FLOOR((n - 1) / 9) BETWEEN 40 AND 46 AND n % 2 = 0
      THEN 800 + ((n * 37) % 2200)
    WHEN n % 53 = 0
      THEN FLOOR((800 + ((n * 37) % 2200)) / 2)
    ELSE 0
  END,
  CASE
    WHEN (n - 1) % 3 = 0 AND FLOOR((n - 1) / 9) BETWEEN 40 AND 46 AND n % 2 = 0
      THEN 'duplicate-charge'
    WHEN n % 53 = 0
      THEN 'item-unavailable'
    ELSE NULL
  END
FROM seq;

-- Settlements are derived from the orders rather than written independently,
-- so gross, refunds, commission and net always agree with the transactions
-- behind them. Commission is 18% of net-of-refunds. WEEKDAY() returns 0 for
-- Monday, so this buckets by trading week starting Monday.
INSERT INTO settlements
  (tenant_slug, period_start, period_end, gross_pence, refunds_pence, commission_pence, net_paid_pence, paid_at)
SELECT
  tenant_slug,
  wk_start,
  DATE_ADD(wk_start, INTERVAL 6 DAY),
  gross,
  refunds,
  ROUND((gross - refunds) * 0.18),
  (gross - refunds) - ROUND((gross - refunds) * 0.18),
  TIMESTAMPADD(HOUR, 10, TIMESTAMP(DATE_ADD(wk_start, INTERVAL 9 DAY)))
FROM (
  SELECT
    tenant_slug,
    DATE_SUB(DATE(placed_at), INTERVAL WEEKDAY(placed_at) DAY) AS wk_start,
    SUM(gross_pence)  AS gross,
    SUM(refund_pence) AS refunds
  FROM orders
  GROUP BY tenant_slug, wk_start
) w;

-- Sanity: both should return zero rows.
SELECT 'settlements that do not reconcile' AS check_name, COUNT(*) AS failures
FROM settlements
WHERE net_paid_pence <> gross_pence - refunds_pence - commission_pence;

SELECT 'settlement totals not matching orders' AS check_name, COUNT(*) AS failures
FROM settlements s
JOIN (
  SELECT tenant_slug,
         DATE_SUB(DATE(placed_at), INTERVAL WEEKDAY(placed_at) DAY) AS wk_start,
         SUM(gross_pence) AS gross, SUM(refund_pence) AS refunds
  FROM orders GROUP BY tenant_slug, wk_start
) o ON o.tenant_slug = s.tenant_slug AND o.wk_start = s.period_start
WHERE o.gross <> s.gross_pence OR o.refunds <> s.refunds_pence;
