-- The audit query. PostgreSQL.
--
-- Run this against the ARCHIVED BACKUP in Clumio, not against production,
-- where these rows no longer exist.
--
-- The question: Alma Kitchen's accountant says their February 2025 payouts
-- were short. Prove what was paid, and why.

SET search_path TO kerbside_finance;

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
  ROUND(s.commission_bps / 100.0, 2)   AS commission_pct,
  ROUND(s.commission_pence / 100.0, 2) AS commission_gbp,
  ROUND(s.net_paid_pence   / 100.0, 2) AS net_paid_gbp,
  s.payout_ref
FROM settlements s
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
FROM orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND o.placed_at::date BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  AND o.refund_pence > 0
ORDER BY o.placed_at;

-- 3. The same thing by day, which is the shape that reads on screen.
-- Trading stops dead on the 12th and does not resume until the 16th.
SELECT
  o.placed_at::date                                                  AS day,
  to_char(o.placed_at, 'Dy')                                         AS weekday,
  COUNT(*)                                                           AS orders,
  COUNT(*) FILTER (WHERE o.refund_pence > 0)                         AS refunded,
  ROUND(SUM(o.gross_pence)  / 100.0, 2)                              AS charged_gbp,
  ROUND(SUM(o.refund_pence) / 100.0, 2)                              AS refunded_gbp
FROM orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND o.placed_at::date BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
GROUP BY 1, 2
ORDER BY 1;

-- 4. These were real baskets, not adjustments. The lines behind the three
-- largest cancelled orders, which is the question that follows if anyone
-- suspects the refunds were manufactured.
SELECT
  o.order_id,
  o.placed_at,
  oi.dish_name,
  oi.quantity,
  ROUND(oi.unit_price_pence / 100.0, 2) AS unit_price_gbp,
  ROUND(oi.line_total_pence / 100.0, 2) AS line_total_gbp
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.order_id IN (
  SELECT order_id FROM orders
  WHERE tenant_slug = 'alma-kitchen'
    AND refund_reason = 'restaurant-cancelled'
    AND placed_at::date BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  ORDER BY gross_pence DESC
  LIMIT 3
)
ORDER BY o.placed_at, oi.order_item_id;

-- 5. The one-line answer, for when it gets asked a third time.
SELECT
  o.refund_reason,
  COUNT(*)                              AS refunded_orders,
  ROUND(SUM(o.refund_pence) / 100.0, 2) AS total_refunded_gbp
FROM orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND o.placed_at::date BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  AND o.refund_pence > 0
GROUP BY o.refund_reason
ORDER BY 3 DESC;
