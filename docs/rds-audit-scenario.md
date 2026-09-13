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

Kerbside pays its restaurants weekly. Those payments live in an RDS MySQL
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

## What to build

A deliberately small MySQL instance. It holds three tables and around 800
rows; nothing here needs capacity.

Provision it with the AWS CLI rather than a script in this repo. The VPC,
subnet group and security group choices are specific to your account, and the
repo has no database driver to load data with.

```bash
aws rds create-db-instance \
  --db-instance-identifier kerbside-finance \
  --engine mysql \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 \
  --storage-type gp3 \
  --master-username admin \
  --manage-master-user-password \
  --no-multi-az \
  --backup-retention-period 1 \
  --publicly-accessible \
  --region eu-west-2
```

`--manage-master-user-password` puts the password in Secrets Manager rather
than in your shell history or this repo. Retrieve it from the Secrets Manager
console when you connect.

`db.t4g.micro` with 20GB single-AZ is the smallest sensible shape and is the
class the free tier covers, if your account still has free tier available.
Assume it does not and delete the instance afterwards.

`--publicly-accessible` is there so you can load data from your laptop. Lock
the security group to your own IP on port 3306. Do not open it to the world,
even for a sandbox.

Wait for it to come up, then take the endpoint:

```bash
aws rds wait db-instance-available --db-instance-identifier kerbside-finance
aws rds describe-db-instances --db-instance-identifier kerbside-finance \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

## Load, back up, purge

Order matters. The purge has to happen after the backup or there is nothing in
the archive to query.

```bash
mysql -h <endpoint> -u admin -p < sql/01-schema-and-data.sql
```

That creates the schema and generates Q1 2025: 810 orders across three
restaurants, and the weekly settlements derived from them. It finishes with two
checks that both report zero failures, because an auditor's first move is to
ask whether the payouts reconcile to the transactions.

Then, in Clumio: back the instance up to **SecureVault Archive**.

Then purge, which is what makes the scenario real:

```bash
mysql -h <endpoint> -u admin -p < sql/02-retention-purge.sql
```

That deletes everything before August 2025 under the 13-month retention rule
and prints the remaining counts, which are zero. Worth filming: it is the proof
that the data genuinely is not in production, rather than something the
audience has to take your word for.

## Recording it

The 48-hour thaw decides the shape. **Request the thaw at least two days before
you record.** There is no version of this where you start the thaw on camera.

| Seg | Capture | Doing |
|---|---|---|
| R1 | Terminal, against production | Run the auditor's question. Zero rows. |
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

```bash
aws rds delete-db-instance \
  --db-instance-identifier kerbside-finance \
  --skip-final-snapshot \
  --delete-automated-backups
```

An idle RDS instance bills by the hour whether anyone queries it or not, so
this is the one piece of the demo estate worth deleting promptly rather than
leaving up between rehearsals. `npm run teardown` does not touch it: that only
handles the DynamoDB table and the S3 bucket.

Clean up the Clumio backup and the thawed archive in the Clumio console.

## A note on the SQL

It targets MySQL 8.0 or later, which is what RDS gives you by default. It uses
recursive CTEs to generate the orders and window-free aggregation to build the
settlements from them.

The logic was verified before it was written down: the settlement
reconciliation and the shape of the February anomaly were both run and checked.
It has not been executed against a live MySQL engine, so treat the first run as
the real test. The two checks at the end of `01-schema-and-data.sql` will tell
you immediately if anything is off.
