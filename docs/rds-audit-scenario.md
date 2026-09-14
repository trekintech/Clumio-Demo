# RDS: the audit scenario

The third capability. Unlike the DynamoDB and S3 clips this one is not about
recovery speed, and it must not be told as though it is.

Granular record retrieval runs SQL against an archived backup and exports the
result. It needs the SecureVault **Archive** tier, and thawing an archive takes
**up to 48 hours**. So it answers a question you have time to answer: an audit,
a dispute, a regulator. Never an outage.

That constraint is the story rather than a caveat to work around. Nobody
restores a production database inside 48 hours to settle an invoice query.

## The story

Kerbside pays its restaurants weekly. Those payments live in an RDS
PostgreSQL database, and production keeps 13 months of them. Anything older is purged and
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

## Load, back up, purge

The order matters. The purge has to come after the backup, or there is nothing
in the archive to query and the demo has no ending.

Three SQL files, run in order, with the Clumio backup between the first and the
second. The first two go in pgAdmin against your own instance. The third does
not: it runs in the Clumio query editor against the archive.

### 1. Connect pgAdmin to the instance

Object Explorer, on the left. Right-click **Servers**, then **Register** →
**Server…**

- **General** tab: Name, anything. `Kerbside RDS` will do.
- **Connection** tab: Host is the RDS endpoint
  (`something.eu-west-2.rds.amazonaws.com`), Port `5432`, Maintenance database
  is your database name, then username and password. Tick **Save password**.
- **Parameters** tab: leave SSL mode at `prefer`. RDS accepts it.

If it sits there and then times out, it is the security group rather than
anything in pgAdmin. Inbound TCP 5432 from your own IP, not from 0.0.0.0/0.

### 2. Open a Query Tool on the right database

Expand **Servers → your server → Databases** and click your database once so it
is selected. Then **Tools → Query Tool**, or right-click the database and pick
Query Tool from there.

The Query Tool connects to whatever was selected when you opened it. Open it
with `postgres` highlighted and that is where the schema lands. Check the tab
title names your database before running anything.

### 3. Load the data

The folder icon in the Query Tool toolbar opens a file. Point it at
`sql/01-schema-and-data.sql` in your clone. Opening the file in a text editor
and pasting it in works just as well, and avoids pgAdmin's file dialog.

**F5** runs it. The script creates the schema and generates Q1 2025: 810 orders
across three restaurants, and the weekly settlements derived from them. It
drops and recreates `kerbside_finance` at the top, so re-running it is safe and
nothing else in the database is affected.

Two things about pgAdmin worth knowing before you trust what you see:

- **Data Output only shows the last result set.** The script ends with four
  SELECTs, so you get Alma Kitchen's February payouts and nothing else. To see
  the two reconciliation checks, highlight just those two queries and press F5.
  pgAdmin runs only the selection when there is one. Both must report `0`
  failures.
- **`search_path` is per-session.** Each file sets it at the top, so running
  whole files is fine. If you highlight a query from the middle of a file and
  run only that, include the `SET search_path` line in the selection or you
  will get `relation "orders" does not exist`.

The figure to look for: week beginning 2025-02-10 nets **£168.40**, against
roughly £320 in the weeks either side.

Or from a terminal, if you would rather:

```bash
psql -h <endpoint> -U <user> -d <database> -f sql/01-schema-and-data.sql
```

`psql` prints every result set, so the checks are visible without selecting
anything.

### 4. Back up

In Clumio, back the instance up to **SecureVault Archive**, and request the
thaw at the same time. It takes up to 48 hours.

Do not move on until this has run. The purge cannot be undone against
production, and after it the archive is the only copy. That is the demo, but
only if the backup exists first.

### 5. Purge

Same Query Tool. Open `sql/02-retention-purge.sql` and run it.

It deletes everything before August 2025 under the 13-month retention rule,
prints the remaining counts (zero), and then runs the auditor's question
against production so you can see it return nothing.

That last query is worth filming. It is the difference between telling the
audience the data is gone and showing them.

### 6. The audit query

`sql/03-audit-query.sql` does not run in pgAdmin. It goes in the Clumio query
editor, against the thawed archive. Query 1 is the payout comparison, query 2
is the ten duplicate charges itemised, and query 2 is the one you export as
CSV.

## Recording it

The 48-hour thaw decides the shape. **Request the thaw at least two days before
you record.** There is no version of this where you start the thaw on camera.

| Seg | Capture | Doing |
|---|---|---|
| R1 | pgAdmin, against production | Run the auditor's question. No rows. |
| R2 | Clumio console | The archived backup, already thawed |
| R3 | Clumio query editor | Paste query 1 from `sql/03-audit-query.sql` |
| R4 | Results | The 10 February row against the weeks either side |
| R5 | Clumio query editor | Query 2: the ten duplicate charges, itemised |
| R6 | Export | Download as CSV, open it |

**Narration**

- R1: "This is the live database. The question is about February last year, and
  retention took that out months ago. There is nothing to query."
- R2: "The archive has it. This was thawed ahead of time — on the Archive tier
  that takes up to 48 hours, which is fine, because an audit is not an outage."
- R3: "I am not restoring anything. I am running SQL against the backup."
- R4: "That week paid out about half of the weeks either side."
- R5: "Ten duplicate charges, refunded in full. The payout was right."
- R6: "That CSV goes back to their accountant. No restore, no second copy of
  everyone else's financial data sitting around while we looked."

**Traps**

- Never imply this is fast. The Archive thaw is up to 48 hours and the honesty
  is part of the argument.
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

Clean up the Clumio backup and the thawed archive in the Clumio console.

## A note on the SQL

It targets PostgreSQL and lives in a `kerbside_finance` schema, so it will not
disturb anything already on the instance and `DROP SCHEMA kerbside_finance
CASCADE` removes every trace of it.

The generation logic and the figures quoted above were run and checked before
being written down, including a week-boundary bug that put Monday's orders in
the previous week's settlement. The Postgres syntax itself has not been
executed against a live engine, so treat the first run as the real test: the
two checks at the end of `01-schema-and-data.sql` report immediately if
anything is off.
