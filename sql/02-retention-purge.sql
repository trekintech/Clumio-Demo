-- Retention purge. PostgreSQL.
--
-- Run this AFTER the Clumio backup has been taken. If you run it first there
-- is nothing in the archive to query and the demo has no ending.
--
-- Kerbside keeps 13 months of finance data in production and relies on the
-- archived backup for anything older. This is what makes the scenario honest:
-- by the time the auditor asks about Q1 2025, those rows genuinely are not in
-- the live database.
--
-- Nobody has to take that on trust. The counts at the end are zero, live.

SET search_path TO kerbside_finance;

-- 13 months back from September 2026.
SELECT 'rows about to be purged' AS note,
       (SELECT COUNT(*) FROM orders      WHERE placed_at    < DATE '2025-08-01') AS orders_to_purge,
       (SELECT COUNT(*) FROM settlements WHERE period_start < DATE '2025-08-01') AS settlements_to_purge,
       (SELECT COUNT(*) FROM order_items oi JOIN orders o USING (order_id)
         WHERE o.placed_at < DATE '2025-08-01')                                  AS order_lines_to_purge;

-- Lines first, then the orders they belong to. Settlements are independent.
DELETE FROM order_items oi USING orders o
 WHERE oi.order_id = o.order_id AND o.placed_at < DATE '2025-08-01';

DELETE FROM settlements WHERE period_start < DATE '2025-08-01';
DELETE FROM orders      WHERE placed_at    < DATE '2025-08-01';

-- Zero, zero, zero. The Q1 2025 trading history is gone from production.
-- What remains is the 13 months retention is meant to keep, so this reads as a
-- retention boundary rather than an empty database.
SELECT 'before the cutoff (should be zero)' AS note,
       (SELECT COUNT(*) FROM orders      WHERE placed_at    < DATE '2025-08-01') AS orders_left,
       (SELECT COUNT(*) FROM settlements WHERE period_start < DATE '2025-08-01') AS settlements_left
UNION ALL
SELECT 'still live after the cutoff',
       (SELECT COUNT(*) FROM orders),
       (SELECT COUNT(*) FROM settlements);

-- The exact question the auditor will ask, run against production. No rows.
-- This is the shot: the query is correct, the database simply no longer holds
-- the answer.
SELECT s.period_start                        AS week_beginning,
       s.order_count                         AS orders,
       ROUND(s.gross_pence      / 100.0, 2)  AS gross_gbp,
       ROUND(s.refunds_pence    / 100.0, 2)  AS refunds_gbp,
       ROUND(s.commission_pence / 100.0, 2)  AS commission_gbp,
       ROUND(s.net_paid_pence   / 100.0, 2)  AS net_paid_gbp
FROM settlements s
WHERE s.tenant_slug = 'alma-kitchen'
  AND s.period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY s.period_start;
