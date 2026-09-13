-- The audit query. Run this against the ARCHIVED BACKUP in Clumio, not
-- against production, where the rows no longer exist.
--
-- The question: Alma Kitchen's accountant says their February 2025 payouts
-- were short. Prove what was paid, and why.

USE kerbside_finance;

-- 1. The payouts in dispute.
--
-- The week beginning 10 February pays out roughly half of the weeks either
-- side of it, against a normal level of trade. The refund column is the reason.
SELECT
  s.period_start                        AS week_beginning,
  s.period_end                          AS week_ending,
  ROUND(s.gross_pence      / 100, 2)    AS gross_gbp,
  ROUND(s.refunds_pence    / 100, 2)    AS refunds_gbp,
  ROUND(s.commission_pence / 100, 2)    AS commission_gbp,
  ROUND(s.net_paid_pence   / 100, 2)    AS net_paid_gbp,
  (
    SELECT COUNT(*)
    FROM orders o
    WHERE o.tenant_slug = s.tenant_slug
      AND DATE(o.placed_at) BETWEEN s.period_start AND s.period_end
      AND o.refund_pence > 0
  )                                     AS refunded_orders
FROM settlements s
WHERE s.tenant_slug = 'alma-kitchen'
  AND s.period_start BETWEEN '2025-02-01' AND '2025-02-28'
ORDER BY s.period_start;

-- 2. Why that week was short: the refunds behind it, itemised.
--
-- This is the evidence to hand to finance. Ten duplicate charges, refunded in
-- full, in a single week. The payout was correct; the trading week was not.
SELECT
  o.order_id,
  o.placed_at,
  ROUND(o.gross_pence  / 100, 2) AS charged_gbp,
  ROUND(o.refund_pence / 100, 2) AS refunded_gbp,
  o.refund_reason
FROM orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND DATE(o.placed_at) BETWEEN '2025-02-10' AND '2025-02-16'
  AND o.refund_pence > 0
ORDER BY o.placed_at;

-- 3. The one-line answer, in case it is asked a third time.
SELECT
  COUNT(*)                            AS refunded_orders,
  ROUND(SUM(o.refund_pence) / 100, 2) AS total_refunded_gbp,
  o.refund_reason
FROM orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND DATE(o.placed_at) BETWEEN '2025-02-10' AND '2025-02-16'
  AND o.refund_pence > 0
GROUP BY o.refund_reason;
