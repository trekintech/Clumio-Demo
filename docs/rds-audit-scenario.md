# RDS: the audit scenario

The third capability. Unlike the DynamoDB and S3 clips this one is not about
recovery speed, and it must not be told as though it is.

Granular record retrieval runs SQL against an archived backup and exports the
result. It uses the SecureVault **Archive** tier, and it answers the kind of
question you have time to answer: an audit, a dispute, a regulator. Not an
outage.

That framing is the story rather than a caveat to work around. Nobody restores
a production database to settle one invoice query.

## The story

Kerbside pays its restaurants weekly. Those payments live in an RDS PostgreSQL
database, and production keeps 13 months of them. Anything older is purged and
lives only in the archived backup.

In September 2026, Alma Kitchen's accountant disputes their February 2025
payouts. They believe they were underpaid.

That data left production months ago.

**Without granular retrieval,** you restore an entire database from an archive
to answer one question about one restaurant and one month. It is slow, it
costs, and you now hold a second live copy of other restaurants' financial
records while you rummage through it.

**With it,** you query the archived backup where it sits, pull the rows that
answer the question, and export them as CSV for finance.

**The answer,** which the query produces: the week beginning 10 February 2025
paid out £168.40 against roughly £320 in the weeks either side. Not an
underpayment. Ten orders were duplicate-charged that week and refunded in
full, £184.70 in total. The payout was correct and the query proves it,
itemised, in a file you can send back.

That is a better ending than "we recovered the data". The business got an
answer, not a restore.

## What you need

An RDS **PostgreSQL** instance you can reach from pgAdmin or psql. If you
already have one, use it: everything goes into its own `kerbside_finance`
schema, so it cannot collide with anything else on the instance and drops
cleanly afterwards. Three tables and around 800 rows; nothing here needs
capacity.

If you are standing one up specifically for this, keep it small and delete it
afterwards:

```bash
aws rds create-db-instance \
  --db-instance-identifier kerbside-finance \
  --engine postgres \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 \
  --storage-type gp3 \
  --master-username postgres \
  --manage-master-user-password \
  --no-multi-az \
  --publicly-accessible \
  --region eu-west-2
```

`--manage-master-user-password` puts the password in Secrets Manager rather
than in your shell history or this repo. `--publicly-accessible` is only so you
can reach it from your laptop: lock the security group to your own IP on 5432,
not to the world, even in a sandbox.

---

# Running it

Seven steps. Steps 1 to 4 and step 6 are pgAdmin against your own instance.
Steps 5 and 7 are Clumio.

The order matters in one place only: the purge in step 6 has to come after the
backup in step 5, or there is nothing in the archive to query and the demo has
no ending.

## Step 1. Connect pgAdmin to the instance

Object Explorer, on the left. Right-click **Servers**, then **Register** →
**Server…**

- **General** tab: Name, anything. `Kerbside RDS` will do.
- **Connection** tab: Host is the RDS endpoint
  (`something.eu-west-2.rds.amazonaws.com`), Port `5432`, Maintenance database
  is your database name, then username and password. Tick **Save password**.
- **Parameters** tab: leave SSL mode at `prefer`. RDS accepts it.

Save. The server should appear in the tree with its icon no longer greyed out.

If it sits there and then times out, it is the security group rather than
anything in pgAdmin. Inbound TCP 5432 from your own IP, not from 0.0.0.0/0.

## Step 2. Open a Query Tool on the right database

Expand **Servers → your server → Databases** and click your database once so it
is selected. Then **Tools → Query Tool**, or right-click the database and pick
Query Tool from there.

The Query Tool connects to whatever was selected when you opened it. Open it
with `postgres` highlighted and that is where the schema lands. The tab title
names the database it is connected to; check it before running anything.

## Step 3. Load the data

The folder icon in the Query Tool toolbar opens a file. Point it at
`sql/01-schema-and-data.sql` in your clone. Opening that file in a text editor
and pasting the contents in works just as well, and avoids pgAdmin's file
dialog.

**F5** runs it. It creates the schema and generates Q1 2025: 810 orders across
three restaurants, and the 42 weekly settlements derived from them. It drops
and recreates `kerbside_finance` at the top, so re-running it is safe and
nothing else in the database is affected.

Two pgAdmin behaviours will make this look like it failed when it hasn't:

- **Data Output only shows the last result set.** The script ends with several
  SELECTs and you will only see the final one.
- **`search_path` is per-session.** Each file sets it at the top, so running
  whole files is fine. Run a query fragment on its own without that line and
  you get `relation "orders" does not exist`.

## Step 4. Check the load

Open a new Query Tool tab and run this. It is the whole verification in one
result set, so pgAdmin will actually show it:

```sql
SET search_path TO kerbside_finance;

SELECT 'orders loaded'           AS check_name, COUNT(*)::text AS result FROM orders
UNION ALL
SELECT 'settlements loaded',     COUNT(*)::text FROM settlements
UNION ALL
SELECT 'reconciliation failures', COUNT(*)::text FROM settlements
  WHERE net_paid_pence <> gross_pence - refunds_pence - commission_pence;
```

Expected:

| check_name | result |
|---|---|
| orders loaded | 810 |
| settlements loaded | 42 |
| reconciliation failures | 0 |

Then the figure the whole demo turns on. This is the auditor's question, run
against production while the data is still there:

```sql
SET search_path TO kerbside_finance;

SELECT period_start                          AS week_beginning,
       ROUND(gross_pence      / 100.0, 2)    AS gross_gbp,
       ROUND(refunds_pence    / 100.0, 2)    AS refunds_gbp,
       ROUND(commission_pence / 100.0, 2)    AS commission_gbp,
       ROUND(net_paid_pence   / 100.0, 2)    AS net_paid_gbp
FROM settlements
WHERE tenant_slug = 'alma-kitchen'
  AND period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY period_start;
```

Expected, exactly:

| week_beginning | gross_gbp | refunds_gbp | commission_gbp | net_paid_gbp |
|---|---|---|---|---|
| 2025-02-03 | 384.56 | 0.00 | 69.22 | 315.34 |
| 2025-02-10 | 390.07 | 184.70 | 36.97 | **168.40** |
| 2025-02-17 | 395.58 | 5.44 | 70.23 | 319.91 |
| 2025-02-24 | 401.09 | 0.00 | 72.20 | 328.89 |

Always show the commission column. Net is
`gross - refunds - commission`, and Kerbside takes 18% of what is left after
refunds, so 390.07 - 184.70 = 205.37, less 36.97 commission, pays 168.40. Drop
the commission column and the row looks like it does not add up, which is the
last thing you want an auditor's arithmetic to do on camera.

If 10 February reads £168.40 against roughly £320 either side, the data is
right and everything downstream will work. If it doesn't, stop here rather than
taking a backup of the wrong numbers.

## Step 5. Back up

In Clumio, back the instance up to **SecureVault Archive**.

Do not move on until this has finished. The purge cannot be undone against
production, and after it the archive is the only copy. That is the demo, but
only if the backup exists first.

## Step 6. Purge

Back in pgAdmin. Open `sql/02-retention-purge.sql` and run it, or paste this,
which is the same thing:

```sql
SET search_path TO kerbside_finance;

SELECT 'rows about to be purged' AS note,
       (SELECT COUNT(*) FROM orders      WHERE placed_at    < DATE '2025-08-01') AS orders_to_purge,
       (SELECT COUNT(*) FROM settlements WHERE period_start < DATE '2025-08-01') AS settlements_to_purge;

DELETE FROM settlements WHERE period_start < DATE '2025-08-01';
DELETE FROM orders      WHERE placed_at    < DATE '2025-08-01';
```

810 orders and 42 settlements go. Everything generated is Q1 2025, which is
older than the 13-month cutoff, so the tables end up empty.

Then the shot. Run the auditor's question again, against production, now that
retention has taken the answer away:

```sql
SET search_path TO kerbside_finance;

SELECT period_start                          AS week_beginning,
       ROUND(gross_pence      / 100.0, 2)    AS gross_gbp,
       ROUND(refunds_pence    / 100.0, 2)    AS refunds_gbp,
       ROUND(commission_pence / 100.0, 2)    AS commission_gbp,
       ROUND(net_paid_pence   / 100.0, 2)    AS net_paid_gbp
FROM settlements
WHERE tenant_slug = 'alma-kitchen'
  AND period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY period_start;
```

No rows. This is worth filming. It is the difference between telling the
audience the data is gone and showing them: the query is correct, the database
simply no longer holds the answer.

## Step 7. Query the archive

This does not run in pgAdmin. It goes in the **Clumio query editor**, against
the backup taken in step 5. The full file is `sql/03-audit-query.sql`.

**Query 1 — the payouts in dispute.** The one that answers the accountant:

```sql
SET search_path TO kerbside_finance;

SELECT
  s.period_start                       AS week_beginning,
  s.period_end                         AS week_ending,
  ROUND(s.gross_pence      / 100.0, 2) AS gross_gbp,
  ROUND(s.refunds_pence    / 100.0, 2) AS refunds_gbp,
  ROUND(s.commission_pence / 100.0, 2) AS commission_gbp,
  ROUND(s.net_paid_pence   / 100.0, 2) AS net_paid_gbp,
  (
    SELECT COUNT(*)
    FROM orders o
    WHERE o.tenant_slug = s.tenant_slug
      AND o.placed_at::date BETWEEN s.period_start AND s.period_end
      AND o.refund_pence > 0
  )                                    AS refunded_orders
FROM settlements s
WHERE s.tenant_slug = 'alma-kitchen'
  AND s.period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'
ORDER BY s.period_start;
```

The same four rows as step 4, plus the refunded-order count that explains them:
0, **10**, 1, 0.

**Query 2 — the evidence.** The ten duplicate charges, itemised. This is the
one you export as CSV:

```sql
SET search_path TO kerbside_finance;

SELECT
  o.order_id,
  o.placed_at,
  ROUND(o.gross_pence  / 100.0, 2) AS charged_gbp,
  ROUND(o.refund_pence / 100.0, 2) AS refunded_gbp,
  o.refund_reason
FROM orders o
WHERE o.tenant_slug = 'alma-kitchen'
  AND o.placed_at::date BETWEEN DATE '2025-02-10' AND DATE '2025-02-16'
  AND o.refund_pence > 0
ORDER BY o.placed_at;
```

Ten rows, order IDs 400364 to 400418, charged and refunded identical on every
one, all of them `duplicate-charge`. They total £184.70.

There is a third query in the file that collapses that to a single line
(`duplicate-charge | 10 | 184.70`) for when the question gets asked again from
the floor.

---

## Recording it

Prepare the backup ahead of the session rather than on camera.

| Seg | Capture | Doing |
|---|---|---|
| R1 | pgAdmin, against production | Run the auditor's question. No rows. |
| R2 | Clumio console | The archived backup |
| R3 | Clumio query editor | Paste query 1 from `sql/03-audit-query.sql` |
| R4 | Results | The 10 February row against the weeks either side |
| R5 | Clumio query editor | Query 2: the ten duplicate charges, itemised |
| R6 | Export | Download as CSV, open it |

**Narration**

- R1: "This is the live database. The question is about February last year, and
  retention took that out months ago. There is nothing to query."
- R2: "The archive has it."
- R3: "I am not restoring anything. I am running SQL against the backup."
- R4: "That week paid out about half of the weeks either side."
- R5: "Ten duplicate charges, refunded in full. The payout was right."
- R6: "That CSV goes back to their accountant. No restore, no second copy of
  everyone else's financial data sitting around while we looked."

**Traps**

- Do not sell this as recovery speed. It is an audit answer, not an outage fix,
  and that is the stronger story.
- Instant Access does not apply here. That is Standard tier and a different
  capability; this is Archive.
- Do not call this Backtrack. Backtrack is the rollback capability used in the
  DynamoDB and S3 clips.

## Afterwards

If you used an existing instance, just drop the schema. Nothing else on the
instance is affected:

```sql
DROP SCHEMA kerbside_finance CASCADE;
```

If you created an instance for this, delete it. An idle RDS instance bills by
the hour whether anyone queries it or not:

```bash
aws rds delete-db-instance \
  --db-instance-identifier kerbside-finance \
  --skip-final-snapshot \
  --delete-automated-backups
```

`npm run teardown` touches neither. It only handles the DynamoDB table and the
S3 bucket.

Clean up the Clumio backup in the Clumio console.

## A note on the SQL

It targets PostgreSQL and lives in a `kerbside_finance` schema, so it will not
disturb anything already on the instance and `DROP SCHEMA kerbside_finance
CASCADE` removes every trace of it.

The generation logic and every figure quoted above were run and checked before
being written down, including a week-boundary bug that put Monday's orders in
the previous week's settlement. The Postgres syntax itself has not been
executed against a live engine, so treat the first run as the real test: the
counts in step 4 report immediately if anything is off.
