-- Retention purge. Run this AFTER the Clumio backup has been taken.
--
--   mysql -h <endpoint> -u admin -p < sql/02-retention-purge.sql
--
-- Kerbside keeps 13 months of finance data in production and relies on the
-- archived backup for anything older. This is what makes the demo honest: by
-- the time the auditor asks about Q1 2025, those rows genuinely are not in the
-- live database, so there is nothing to query except the archive.
--
-- Nobody watching has to take that on trust either. The counts printed at the
-- end are zero, live, on camera.

USE kerbside_finance;

SET @cutoff = '2025-08-01';

SELECT 'rows about to be purged' AS note,
       (SELECT COUNT(*) FROM orders      WHERE placed_at    < @cutoff) AS orders_to_purge,
       (SELECT COUNT(*) FROM settlements WHERE period_start < @cutoff) AS settlements_to_purge;

DELETE FROM settlements WHERE period_start < @cutoff;
DELETE FROM orders      WHERE placed_at    < @cutoff;

-- Both zero. The Q1 2025 trading history is gone from production.
SELECT 'remaining rows before the cutoff' AS note,
       (SELECT COUNT(*) FROM orders      WHERE placed_at    < @cutoff) AS orders_left,
       (SELECT COUNT(*) FROM settlements WHERE period_start < @cutoff) AS settlements_left;

-- Worth showing too: the exact question the auditor will ask returns nothing
-- from production.
SELECT 'Alma Kitchen, February 2025, from production' AS note, COUNT(*) AS rows_found
FROM settlements
WHERE tenant_slug = 'alma-kitchen'
  AND period_start BETWEEN '2025-02-01' AND '2025-02-28';
