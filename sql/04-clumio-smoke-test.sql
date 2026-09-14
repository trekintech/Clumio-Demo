-- Clumio query editor smoke test.
--
-- Run these in order in the Record restore dialog BEFORE relying on
-- 03-audit-query.sql, and certainly before recording anything. Each one
-- isolates a single thing the audit queries depend on.
--
-- All of these have been run against the live console once, against the
-- dataset 01-schema-and-data.sql generates. Exactly one failed: 5b. Re-run
-- them after any change to the data or a Clumio upgrade, not before.
--
-- Why this file exists: that editor isn't Postgres. An unaliased column comes
-- back as _col0 and the schema browser reports Hive/Trino types - bigint, int,
-- string - so date and timestamp columns arrive as STRINGS. Anything written
-- against Postgres semantics is a guess until it has run here.
--
-- SETUP
--
--   The schema browser on the left lists all six tables with a copy icon
--   beside each name. Use it, because the generated names are long and change
--   with every backup. Replace these three tokens:
--
--     SETTLEMENTS_TABLE   ->  kerbside_finance_settlements_...
--     ORDERS_TABLE        ->  kerbside_finance_orders_...
--     ORDER_ITEMS_TABLE   ->  kerbside_finance_order_items_...
--
--   "Default database name" is already set, so the table name alone is enough.
--   Paste ONE query at a time and use "Preview first 10 records".
--
-- WHAT TO RECORD AS YOU GO
--
--   For each query: the result, or the error text. Queries 3 and 4 decide how
--   every date filter in 03-audit-query.sql has to be written, so don't skip
--   them even if 1 and 2 look fine.


-- ===========================================================================
-- PART 1: can it see the data
-- ===========================================================================

-- 1. Expect 23000. Already confirmed working.
SELECT COUNT(*) FROM SETTLEMENTS_TABLE;

-- 2. Expect 897260 and 2005124.
SELECT COUNT(*) FROM ORDERS_TABLE;
SELECT COUNT(*) FROM ORDER_ITEMS_TABLE;


-- ===========================================================================
-- PART 2: what do dates actually look like
--
-- This is the important part. Expand "settlements" and "orders" in the schema
-- browser and note the reported type of period_start and placed_at, then run
-- these two to see the literal values.
-- ===========================================================================

-- 3. What format is a timestamp in? Look at placed_at in the result.
--    Postgres holds it as "2025-01-05 13:51:00". Whether it survives as
--    that, as ISO with a T, or with a timezone on the end is the question.
SELECT order_id, tenant_slug, placed_at
FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen';

-- 4. And a plain date? Postgres holds it as "2025-02-03".
SELECT tenant_slug, period_start, period_end, payout_ref
FROM SETTLEMENTS_TABLE
WHERE tenant_slug = 'alma-kitchen';


-- ===========================================================================
-- PART 3: which date filter works
--
-- Try all three. At least one will work. Whichever it is decides how
-- 03-audit-query.sql gets written, so note which ones error.
-- ===========================================================================

-- 5a. Plain string comparison, ISO-8601 sorting correctly as text.
--     CONFIRMED WORKING. Expect 4.
SELECT COUNT(*) FROM SETTLEMENTS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND period_start BETWEEN '2025-02-01' AND '2025-02-28';

-- 5b. DATE literals against a bare column. CONFIRMED TO ERROR - dates arrive
--     as strings and there is no implicit coercion. Kept as the regression
--     case: if this ever starts working, the engine changed.
SELECT COUNT(*) FROM SETTLEMENTS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28';

-- 5c. Cast the literal side instead. Expect 4.
SELECT COUNT(*) FROM SETTLEMENTS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND CAST(period_start AS DATE) BETWEEN DATE '2025-02-01' AND DATE '2025-02-28';


-- 6a. Same three for a timestamp column, which is the harder case. Taking the
--     first 10 characters sidesteps the format entirely. CONFIRMED WORKING.
--     Expect 9.
SELECT COUNT(*) FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND SUBSTR(placed_at, 1, 10) = '2025-02-15';

-- 6b. Expect 9. CONFIRMED WORKING, which was not obvious: placed_at holds a
--     full timestamp as text and the cast still copes.
SELECT COUNT(*) FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND CAST(placed_at AS DATE) = DATE '2025-02-15';

-- 6c. Expect 9.
SELECT COUNT(*) FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND CAST(SUBSTR(placed_at, 1, 10) AS DATE) = DATE '2025-02-15';


-- ===========================================================================
-- PART 4: everything else the audit queries use
-- ===========================================================================

-- 7. Integer division and rounding. Expect 267.37.
SELECT ROUND(net_paid_pence / 100.0, 2) AS net_gbp
FROM SETTLEMENTS_TABLE
WHERE payout_ref = 'KB-2025W07-218DF9';

-- 8. Conditional aggregate, which is what replaced FILTER. CONFIRMED WORKING,
--    together with GROUP BY SUBSTR(...) and ORDER BY on an ordinal: the full
--    by-day query returned all seven rows matching Postgres exactly. Expect 9.
SELECT SUM(CASE WHEN refund_pence > 0 THEN 1 ELSE 0 END) AS refunded
FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND SUBSTR(placed_at, 1, 10) = '2025-02-15';

-- 9. Join across two tables. Expect 20. This is the one query 4 of the audit
--    depends on, and the one worth knowing the timing of.
SELECT COUNT(*)
FROM ORDERS_TABLE o
JOIN ORDER_ITEMS_TABLE oi ON oi.order_id = o.order_id
WHERE o.tenant_slug = 'alma-kitchen'
  AND SUBSTR(o.placed_at, 1, 10) = '2025-02-15';

-- 10. GROUP BY, and ORDER BY on a column ordinal. Expect three rows:
--     item-unavailable 60, restaurant-cancelled 25, customer-complaint 17.
SELECT refund_reason, COUNT(*) AS n
FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND refund_pence > 0
GROUP BY refund_reason
ORDER BY 2 DESC;

-- 11. If 10 errors on the ordinal, this is the fallback.
SELECT refund_reason, COUNT(*) AS n
FROM ORDERS_TABLE
WHERE tenant_slug = 'alma-kitchen'
  AND refund_pence > 0
GROUP BY refund_reason
ORDER BY COUNT(*) DESC;
