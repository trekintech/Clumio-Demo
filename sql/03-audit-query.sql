-- The audit query. Run in the CLUMIO QUERY EDITOR, against the archived
-- backup. Not in pgAdmin, and not against production, where these rows don't
-- exist any more.
--
-- The question: Alma Kitchen's accountant says their February 2025 payouts
-- were short. Prove what was paid, and why.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU RUN THIS: replace the three table tokens.
--
-- Clumio doesn't expose the tables under their own names. It flattens schema
-- and table into one generated identifier, per backup:
--
--   kerbside_finance_settlements_dda39285_20260914_2c2e2d1db06211f19fc1f21...
--   \_____________/ \_________/ \______/ \______/ \______________________/
--      schema           table       id     backup       backup job id
--                                          date
--
-- The suffix changes every time you take a backup, so these names can't live
-- in the repo. Get them from the table picker in the console and find-replace:
--
--   SETTLEMENTS_TABLE   ->  kerbside_finance_settlements_...
--   ORDERS_TABLE        ->  kerbside_finance_orders_...
--   ORDER_ITEMS_TABLE   ->  kerbside_finance_order_items_...
--
-- Set "Default database name" to the matching
-- kerbside_..._rds_<account>_<region>_instance_<resource> entry and you won't
-- need to prefix the database as well.
--
-- Other rules that editor enforces:
--
--   * SELECT statements only. No SET, so there's no search_path to lean on.
--   * Paste ONE query at a time. Not the whole file.
--   * The engine isn't Postgres. An unaliased column comes back as _col0,
--     which is the Presto/Trino convention, so this file sticks to plain ANSI:
--     CAST rather than ::, no to_char, no FILTER, no alias called "day".
--   * Dates and timestamps arrive as STRINGS, and there's no implicit
--     coercion. Tested in the console:
--
--       period_start BETWEEN DATE '...' AND DATE '...'              ERRORS
--       period_start BETWEEN '2025-02-01' AND '2025-02-28'          works
--       CAST(period_start AS DATE) BETWEEN DATE '...' AND DATE '...' works
--       CAST(placed_at AS DATE) = DATE '2025-02-15'                 works
--       SUBSTR(placed_at, 1, 10) = '2025-02-15'                     works
--
--     So: cast the column, or compare strings to strings. Never put a bare
--     column next to a DATE literal, which is the one combination that
--     errors, and it's easy to put back without noticing.
--
--     This file uses SUBSTR for placed_at and CAST for period_start, which
--     are the two forms actually run in the console. SUBSTR is also immune to
--     the timestamp format, which CAST does. Note that SUBSTR on placed_at
--     won't run in Postgres, where that column is a real timestamp. These
--     queries are for the Clumio editor and nothing else.
--
--     Verified against the live console: every query below returns the row
--     counts and figures quoted in docs/rds-audit-scenario.md.
--
-- Because the names are tied to a backup, write these queries AFTER taking the
-- backup you will actually demo from, and save the filled-in version. Taking
-- the backup again invalidates them.
--
-- If a query returns nothing, see the troubleshooting section in
-- docs/rds-audit-scenario.md before changing the SQL.
-- ---------------------------------------------------------------------------


-- 1. The payouts in dispute.   [RECORDED - segment R3]
--
-- Read the order count alongside the payout. The week beginning 10 February
-- took a normal number of orders and paid out about a third of the weeks
-- either side. The refunds column is the reason.
SELECT
  s.period_start                       AS week_beginning,
  s.period_end                         AS week_ending,
  s.order_count                        AS orders,
  ROUND(s.gross_pence      / 100.0, 2) AS gross_gbp,
  ROUND(s.refunds_pence    / 100.0, 2) AS refunds_gbp,
  ROUND(s.commission_bps   / 100.0, 2) AS commission_pct,
  ROUND(s.commission_pence / 100.0, 2) AS commission_gbp,
  ROUND(s.net_paid_pence   / 100.0, 2) AS net_paid_gbp,
  s.payout_ref
FROM SETTLEMENTS_TABLE s
WHERE s.tenant_slug = 'alma-kitchen'
  AND CAST(s.period_start AS DATE) BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY s.period_start;


-- 2. The refunds itemised.   [NOT recorded - keep ready for questions]
--
-- This is the evidence that goes back to the accountant. Export it as CSV.
-- Four consecutive days of cancellations, every order refunded in full.
SELECT
  o.order_id,
  o.placed_at,
  o.channel,
  o.payment_method,
  ROUND(o.gross_pence  / 100.0, 2) AS charged_gbp,
  ROUND(o.refund_pence / 100.0, 2) AS refunded_gbp,
  o.refund_reason
FROM ORDERS_TABLE o
WHERE o.tenant_slug = 'alma-kitchen'
  AND SUBSTR(o.placed_at, 1, 10) BETWEEN '2025-02-10' AND '2025-02-16'
  AND o.refund_pence > 0
ORDER BY o.placed_at;


-- 3. The same week by day.   [RECORDED - segment R4. The shot that carries it]
-- Trading stops dead on the 12th and doesn't resume until the 16th.
SELECT
  SUBSTR(o.placed_at, 1, 10)                          AS order_day,
  COUNT(*)                                            AS orders,
  SUM(CASE WHEN o.refund_pence > 0 THEN 1 ELSE 0 END) AS refunded,
  ROUND(SUM(o.gross_pence)  / 100.0, 2)               AS charged_gbp,
  ROUND(SUM(o.refund_pence) / 100.0, 2)               AS refunded_gbp
FROM ORDERS_TABLE o
WHERE o.tenant_slug = 'alma-kitchen'
  AND SUBSTR(o.placed_at, 1, 10) BETWEEN '2025-02-10' AND '2025-02-16'
GROUP BY SUBSTR(o.placed_at, 1, 10)
ORDER BY 1;


-- 4. The baskets behind the cancellations.   [RECORDED - segment R5]
-- These were real orders, not adjustments. The lines behind the largest
-- cancelled orders, joined into two million order lines.
--
-- This is the query that proves the capability rather than describing it.
SELECT
  o.order_id,
  o.placed_at,
  oi.dish_name,
  oi.quantity,
  ROUND(oi.unit_price_pence / 100.0, 2) AS unit_price_gbp,
  ROUND(oi.line_total_pence / 100.0, 2) AS line_total_gbp
FROM ORDERS_TABLE o
JOIN ORDER_ITEMS_TABLE oi
  ON oi.order_id = o.order_id
WHERE o.tenant_slug = 'alma-kitchen'
  AND o.refund_reason = 'restaurant-cancelled'
  AND SUBSTR(o.placed_at, 1, 10) BETWEEN '2025-02-10' AND '2025-02-16'
  AND o.gross_pence >= 5000
ORDER BY o.gross_pence DESC, o.order_id, oi.order_item_id;


-- 5. The one-line answer.   [NOT recorded - for when it's asked from the floor]
SELECT
  o.refund_reason,
  COUNT(*)                              AS refunded_orders,
  ROUND(SUM(o.refund_pence) / 100.0, 2) AS total_refunded_gbp
FROM ORDERS_TABLE o
WHERE o.tenant_slug = 'alma-kitchen'
  AND SUBSTR(o.placed_at, 1, 10) BETWEEN '2025-02-10' AND '2025-02-16'
  AND o.refund_pence > 0
GROUP BY o.refund_reason
ORDER BY 3 DESC;


-- ---------------------------------------------------------------------------
-- If nothing comes back, run this first. It is the smallest possible query and
-- it tells you whether the editor can see the table at all, which is a
-- different problem from the query being wrong.
--
--   SELECT COUNT(*) FROM SETTLEMENTS_TABLE
--
-- Expect 23000. If it errors the name's wrong rather than the query, so go
-- back to the table picker and copy it again. If it returns 0 the backup is
-- older than the data load, and you need to take it again.
-- ---------------------------------------------------------------------------
