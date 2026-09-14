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

**1. Load.** Run `sql/01-schema-and-data.sql` in pgAdmin, or:

```bash
psql -h <endpoint> -U <user> -d <database> -f sql/01-schema-and-data.sql
```

It creates the schema and generates Q1 2025: 810 orders across three
restaurants and the weekly settlements derived from them. It ends with two
checks that should both report zero failures, and prints Alma Kitchen's
February payouts as they stand.

**2. Back up.** In Clumio, back the instance up to **SecureVault Archive**.

**3. Purge.** Run `sql/02-retention-purge.sql`. It deletes everything before
August 2025 under the 13-month retention rule, prints the remaining counts
(zero), and then runs the auditor's question against production so you can see
it return nothing.

That last query is worth filming. It is the difference between telling the
audience the data is gone and showing them.

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
