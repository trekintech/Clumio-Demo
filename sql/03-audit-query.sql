-- The audit query. Run in the CLUMIO QUERY EDITOR, against the archived
-- backup. Not in pgAdmin, and not against production, where these rows no
-- longer exist.
--
-- The question: Alma Kitchen's accountant says their February 2025 payouts
-- were short. Prove what was paid, and why.
--
-- ---------------------------------------------------------------------------
-- Written for the Clumio editor, which is stricter than pgAdmin:
--
--   * SELECT statements only. No SET, so there is no search_path to lean on
--     and every table is written out in full.
--   * Addressing is <database>.<table>. Set "Default database name" to the
--     one holding these tables and the prefix below becomes optional. Leave
--     it in and it works either way.
--   * Paste ONE query at a time. Not the whole file.
--   * Kept to plain ANSI SQL - CAST rather than ::, no to_char, no FILTER -
--     so it does not depend on the engine behind the editor being Postgres.
--
-- If a query returns nothing, see the troubleshooting section in
-- docs/rds-audit-scenario.md before changing the SQL.
-- ---------------------------------------------------------------------------


-- 1. The payouts in dispute.
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
FROM kerbside_finance.settlements s
WHERE s.tenant_slug = 'alma-kitchen'
  AND s.period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY s.period_start;


-- 2. Why that week was short: the refunds behind it, itemised.
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
FROM kerbside_finance.orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND CAST(o.placed_at AS DATE) BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  AND o.refund_pence > 0
ORDER BY o.placed_at;


-- 3. The same week by day, which is the shape that reads on screen.
-- Trading stops dead on the 12th and does not resume until the 16th.
SELECT
  CAST(o.placed_at AS DATE)                           AS day,
  COUNT(*)                                            AS orders,
  SUM(CASE WHEN o.refund_pence > 0 THEN 1 ELSE 0 END) AS refunded,
  ROUND(SUM(o.gross_pence)  / 100.0, 2)               AS charged_gbp,
  ROUND(SUM(o.refund_pence) / 100.0, 2)               AS refunded_gbp
FROM kerbside_finance.orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND CAST(o.placed_at AS DATE) BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
GROUP BY CAST(o.placed_at AS DATE)
ORDER BY 1;


-- 4. These were real baskets, not adjustments. The lines behind the largest
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
FROM kerbside_finance.orders o
JOIN kerbside_finance.order_items oi
  ON oi.order_id = o.order_id
WHERE o.tenant_slug = 'alma-kitchen'
  AND o.refund_reason = 'restaurant-cancelled'
  AND CAST(o.placed_at AS DATE) BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  AND o.gross_pence >= 5000
ORDER BY o.gross_pence DESC, o.order_id, oi.order_item_id;


-- 5. The one-line answer, for when it gets asked a third time.
SELECT
  o.refund_reason,
  COUNT(*)                              AS refunded_orders,
  ROUND(SUM(o.refund_pence) / 100.0, 2) AS total_refunded_gbp
FROM kerbside_finance.orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND CAST(o.placed_at AS DATE) BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  AND o.refund_pence > 0
GROUP BY o.refund_reason
ORDER BY 3 DESC;


-- ---------------------------------------------------------------------------
-- If nothing comes back, run this first. It is the smallest possible query
-- and it tells you whether the editor can see the table at all.
--
--   SELECT COUNT(*) FROM kerbside_finance.settlements
--
-- Expect 23000. If that errors, the problem is addressing rather than your
-- query: check the "Default database name" dropdown, then try the table
-- unqualified, then quoted as "kerbside_finance"."settlements".
-- ---------------------------------------------------------------------------
