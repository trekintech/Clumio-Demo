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
costs, and you now hold a second live copy of 249 other restaurants' financial
records while you rummage through it.

**With it,** you query the archived backup where it sits, pull the rows that
answer the question, and export them as CSV for finance.

**The answer,** which the query produces: the week beginning 10 February 2025
paid out £267.37, against £984.76 and £791.15 in the weeks either side. Not an
underpayment. Alma Kitchen lost refrigeration on the Wednesday and did not
trade again until the Sunday. Nobody marked the storefront closed, so orders
kept arriving and were cancelled on receipt: 25 orders, £935.26, refunded in
full.

The detail that makes it land is the order count. That week took 39 orders,
more than the 35 and 37 either side. On volume it was a normal week. They took
the orders and could not fulfil a single one from the Wednesday on.

That is a better ending than "we recovered the data". The business got an
answer, not a restore.

## What you need

An RDS **PostgreSQL** instance you can reach from pgAdmin or psql. If you
already have one, use it: everything goes into its own `kerbside_finance`
schema, so it cannot collide with anything else on the instance and drops
cleanly afterwards.

Six tables and about 2.9 million rows, which is a few hundred MB. Nothing here
needs a large instance, but it is not a toy dataset either, and that is
deliberate: "restore the whole database to answer one question" only sounds
absurd if the database is worth not restoring.

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

## What gets created

| Table | Rows | What it holds |
|---|---|---|
| `tenants` | 250 | The restaurants. The eight named ones share their slugs with the storefront. |
| `contracts` | 250 | Negotiated commission rate per restaurant, in basis points. |
| `dishes` | 60 | Four dishes per cuisine, priced. |
| `orders` | 897,260 | One row per order: basket, delivery fee, tip, VAT, payment method, refund. |
| `order_items` | 2,005,124 | The lines behind each order. |
| `settlements` | 23,000 | One weekly payout per restaurant, derived from the orders. |

Settlements are computed from the orders and the contract rate rather than
written independently, so gross, refunds, commission and net always agree with
the transactions behind them. Six checks at the end of the load prove it.

Commission is **18% for Alma Kitchen**, and 14% to 26% elsewhere. Net is
`gross - refunds - commission`, which is why a settlement row never reads as
gross minus refunds on its own.

VAT is recorded per order for audit and does not enter the settlement: the
restaurant accounts for its own VAT, and the platform pays gross less
commission.

## Sizing

The default is 250 restaurants, which comes to **378 MB** of tables and
indexes. Against the 20 GB the `create-db-instance` command above allocates,
that is under 2%. Storage is not what this costs you: an idle instance billed
by the hour dwarfs a few hundred MB of gp3, so the thing to watch is deleting
the instance afterwards, not the row count.

Three sizes, all measured:

| `tenant_count` | orders | order lines | schema size |
|---|---|---|---|
| 250 (default) | 897,260 | 2,005,124 | 378 MB |
| 100 | 345,494 | 771,813 | 145 MB |
| 25 | 80,808 | 180,470 | 34 MB |

**Alma Kitchen's figures are identical at all three.** Every restaurant owns
its own block of order IDs, so the estate size does not move a single number
this document quotes. Verified, not assumed.

Pick the size before step 5. Changing the data after the backup means taking
the backup again.

250 is the recommendation. The whole argument is that restoring the database to
answer one question is absurd, and that reads better at 900,000 orders than at
80,000. The one thing worth a look on your first run is how long query 2 and
query 3 take in the Clumio query editor against the archive — that is the only
part of this nobody can measure in advance. If it drags, reload at 100 and take
the backup again; the narration does not change.

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

**F5** runs it. Expect a couple of minutes: it is writing about 2.9 million
rows. It drops and recreates `kerbside_finance` at the top, so re-running it is
safe and nothing else in the database is affected.

For a faster loop while you are rehearsing, edit the knobs near the top of the
file:

```sql
INSERT INTO gen_params VALUES (250, DATE '2025-01-01', DATE '2026-09-30');
```

Drop the tenant count to 25 and it loads in seconds. Alma Kitchen's figures do
not change when you do: every restaurant owns its own block of order IDs, so
the estate size does not disturb the numbers this demo quotes.

Two pgAdmin behaviours will make this look like it failed when it hasn't:

- **Data Output only shows the last result set.** The file ends with the
  reconciliation checks, so those are what you will see. That is the useful
  one, but it means nothing else in the script appears.
- **`search_path` is per-session.** Each file sets it at the top, so running
  whole files is fine. Run a query fragment on its own without that line and
  you get `relation "orders" does not exist`.

## Step 4. Check the load

The checks run automatically as the last statement of step 3. All six must
read zero:

| check_name | failures |
|---|---|
| settlement internal maths | 0 |
| settlement totals vs orders | 0 |
| order header vs its lines | 0 |
| gross vs its components | 0 |
| refund larger than the order | 0 |
| commission rate vs contract | 0 |

Then the figures the whole demo turns on. This is the auditor's question, run
against production while the data is still there:

```sql
SET search_path TO kerbside_finance;

SELECT period_start                          AS week_beginning,
       order_count                           AS orders,
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

| week_beginning | orders | gross_gbp | refunds_gbp | commission_gbp | net_paid_gbp |
|---|---|---|---|---|---|
| 2025-02-03 | 35 | 1218.73 | 17.80 | 216.17 | 984.76 |
| 2025-02-10 | 39 | 1312.72 | 986.66 | 58.69 | **267.37** |
| 2025-02-17 | 37 | 964.82 | 0.00 | 173.67 | 791.15 |
| 2025-02-24 | 38 | 1174.47 | 47.95 | 202.77 | 923.75 |

Always show the commission column. Net is `gross - refunds - commission`, so
1312.72 - 986.66 = 326.06, less 58.69 commission, pays 267.37. Drop the
commission column and the row looks like it does not add up, which is the last
thing you want an auditor's arithmetic to do on camera.

If 10 February reads £267.37 with 39 orders, the data is right and everything
downstream will work. If it doesn't, stop here rather than taking a backup of
the wrong numbers.

## Step 5. Back up

In Clumio, back the instance up to **SecureVault Archive**.

Do not move on until this has finished. The purge cannot be undone against
production, and after it the archive is the only copy. That is the demo, but
only if the backup exists first.

## Step 6. Purge

Back in pgAdmin. Open `sql/02-retention-purge.sql` and run it. It deletes
everything before August 2025 under the 13-month retention rule:

| | rows |
|---|---|
| orders purged | 294,768 |
| order lines purged | 659,524 |
| settlements purged | 7,750 |
| orders still live | 602,492 |
| settlements still live | 15,250 |

Note the last two. This reads as a retention boundary rather than a wiped
database: the 13 months retention is meant to keep are all still there. If
someone asks whether you just truncated the table, the answer is on screen.

The file finishes by running the auditor's question against production now that
retention has taken the answer away. **No rows.** That is the shot: the query is
correct, the database simply no longer holds the answer.

## Step 7. Query the archive

This does not run in pgAdmin. It goes in the **Clumio query editor**, against
the backup taken in step 5. The full file is `sql/03-audit-query.sql`, which
holds five queries.

That editor is stricter than pgAdmin, and works differently enough that the
file has to be filled in before it will run.

### Table names are generated per backup

Clumio does not expose the tables under their own names. It flattens schema and
table into a single identifier with the backup baked into it:

```
kerbside_finance_settlements_dda39285_20260914_2c2e2d1db06211f19fc1f219e1933199
└─── schema ───┘└─ table ──┘└─ id ──┘└─ date ┘└────── backup job id ──────┘
```

The suffix changes every time you take a backup, so these cannot live in the
repo. `sql/03-audit-query.sql` uses three tokens instead. Get the real names
from the table picker in the console and find-replace:

| Token | Replace with |
|---|---|
| `SETTLEMENTS_TABLE` | `kerbside_finance_settlements_…` |
| `ORDERS_TABLE` | `kerbside_finance_orders_…` |
| `ORDER_ITEMS_TABLE` | `kerbside_finance_order_items_…` |

Set **Default database name** to the matching
`kerbside_…_rds_<account>_<region>_instance_<resource>` entry and you do not
need to prefix the database as well.

Do this **after** taking the backup you will actually demo from, and save the
filled-in queries. Taking the backup again invalidates every name in them.

### The engine is not Postgres

An unaliased column comes back as `_col0`, the schema browser reports
Hive/Trino types, and **dates and timestamps arrive as strings**. There is no
implicit coercion between the two. Tested in the console against this dataset:

| Pattern | Result |
|---|---|
| `period_start BETWEEN DATE '2025-02-01' AND DATE '2025-02-28'` | **errors** |
| `period_start BETWEEN '2025-02-01' AND '2025-02-28'` | works |
| `CAST(period_start AS DATE) BETWEEN DATE '…' AND DATE '…'` | works |
| `CAST(placed_at AS DATE) = DATE '2025-02-15'` | works |
| `SUBSTR(placed_at, 1, 10) = '2025-02-15'` | works |

Cast the column, or compare strings to strings. A bare column next to a `DATE`
literal is the one combination that fails, and it is easy to reintroduce
without noticing because it is what you would write against Postgres.

`03-audit-query.sql` uses `SUBSTR` for `placed_at` and `CAST` for
`period_start`, which are the two forms actually run in the console. `SUBSTR`
is also immune to the timestamp format. It will not run in pgAdmin, where
`placed_at` is a real timestamp — that file targets the Clumio editor and
nothing else.

`CAST(placed_at AS DATE)` working is worth knowing: that column holds a full
timestamp as text (`2025-01-05 13:51:00`), and the cast copes with it. Plain
Trino would not, so the engine is more forgiving than its error messages
suggest.

The rest of what the audit queries use is confirmed working: `ROUND(x / 100.0,
2)`, `COUNT(*)`, `GROUP BY`, `ORDER BY` on a column ordinal, and a two-table
`JOIN`. Also: **SELECT statements only**, so no `SET` and no `search_path`, and
**paste one query at a time**.

### If it returns nothing

Run the smallest possible query first. It separates "the editor cannot see the
table" from "my query is wrong":

```sql
SELECT COUNT(*) FROM SETTLEMENTS_TABLE
```

Expect **23000**.

- **Errors** — the name is wrong rather than the query. Copy it again from the
  table picker; the suffix is long and easy to truncate.
- **Returns 0** — the backup is older than the data load. The tables are
  genuinely not in it. Take the backup again.
- **Returns 23000 but your query still gives nothing** — check you replaced
  every token, including the two in query 4.

The red wavy underlines in the editor are the browser's spellchecker on a plain
textarea, not SQL errors. Ignore them.

### Worth saying on camera

Those generated table names are ugly, and that is useful. They are visible
proof you are not querying production: the name has the backup date and job id
in it. Point at it once.

**Query 1 — the payouts in dispute.** The same four rows as step 4, plus the
commission rate and payout reference. This is the one that answers the
accountant.

**Query 2 — the refunds itemised.** 27 rows: the 25 cancellations plus two
ordinary item-unavailable refunds that happened to fall in the same week. Order
IDs, timestamps, channel, payment method, amount charged and amount refunded.
This is the CSV you export.

**Query 3 — the same thing by day.** This is the one that reads on screen:

| order_day | orders | refunded | charged_gbp | refunded_gbp |
|---|---|---|---|---|
| 2025-02-10 | 3 | 0 | 94.53 | 0.0 |
| 2025-02-11 | 5 | 1 | 108.18 | 12.85 |
| 2025-02-12 | 4 | 4 | 189.83 | 189.83 |
| 2025-02-13 | 6 | 6 | 202.32 | 202.32 |
| 2025-02-14 | 6 | 6 | 258.32 | 258.32 |
| 2025-02-15 | 9 | 9 | 284.79 | 284.79 |
| 2025-02-16 | 6 | 1 | 174.75 | 38.55 |

That is copied from the console, not from Postgres. The engine trims trailing
zeros, so a round number shows as `0.0` rather than `0.00`.

There is no weekday column: `to_char` does not exist in that engine. The 12th
is the Wednesday and the 15th the Saturday, so say it rather than showing it.

Four consecutive days where charged and refunded are the same number, including
the Friday and Saturday that carry the week. Nobody needs the story explained
after seeing that.

**Query 4 — the baskets behind the cancelled orders over £50.** 19 rows:
dish, quantity, unit price, joined into the 2 million order lines. The answer
to "how do we know these refunds were real orders and not an adjustment
someone posted".

**Query 5 — the one-line answer**, for when it gets asked a third time:

| refund_reason | refunded_orders | total_refunded_gbp |
|---|---|---|
| restaurant-cancelled | 25 | 935.26 |
| item-unavailable | 2 | 51.40 |

---

## Recording it

Prepare the backup ahead of the session rather than on camera.

The full narrative — the story in prose, what each query proves, and the
figures written out for slides — is in
[rds-slide-brief.md](rds-slide-brief.md). This section is the shot list. That
one is what you hand to someone building the deck.

The whole segment is text in grids. It has no dashboard going red and no
four-second poll bringing it back, so it cannot be carried the way clips 1 and
2 are. What it has instead is an escalation across **three queries**: what was
paid, why it was short, and proof the evidence is real. Shoot it in that order
and it builds. Shoot it as "here is a query tool" and it dies.

Three queries is the whole point. One is not enough to show it is a real
engine, and five is a man reading SQL aloud.

**Why each one follows the last.** Do not present these as three things the
product can do. Each exists because the one before it left a question open:

| Query | Runs because | Leaves open |
|---|---|---|
| 1. The payouts | It is the accountant's question, unchanged — the same SQL that just returned nothing against production | £986.66 of refunds is a number, not an explanation. When did it happen, and whose fault was it? |
| 2. By day | Finance cannot reply to an accountant with a total. They need the shape: spread across the week, or concentrated? | Refund rows are just rows. Anyone can post one. Were these real orders? |
| 3. The baskets | To answer exactly that, by going down to what was in them | Nothing. This is the end. |

The pivot in query 1 is the **order count**, not the payout. £267.37 against
£900 only says something is odd. Thirty-nine orders — more than either
neighbouring week — kills the obvious explanations: they did not trade badly,
and they were not closed in any way the platform recorded. That is what makes
query 2 necessary rather than merely interesting.

| Seg | Capture | Doing | Rows |
|---|---|---|---|
| R1 | pgAdmin, against production | The auditor's question | 0 |
| R2 | Clumio Record restore | The backup, and the schema browser beside it | — |
| R3 | Clumio query editor | Query 1: the four February payouts | 4 |
| R4 | Clumio query editor | Query 3: the same week by day | 7 |
| R5 | Clumio query editor | Query 4: the baskets behind the cancellations | 19 |
| R6 | Export | Download as CSV, open it | — |

Queries 2 and 5 stay in the file but do not get recorded. Query 2 is the
itemised list you would actually send an accountant, so it is worth having
ready if someone asks to see it. Query 5 collapses the answer to one line for
when the question comes back from the floor.

**Narration**

- R1: "This is the live database. The question is about February last year, and
  retention took that out months ago. There is nothing to query."
- R2: "The archive has it. And look at the panel on the left — that is the
  schema, read straight out of the backup. Six tables, every column, still the
  shape the application wrote them in."
- R3: "I am not restoring anything. I am running SQL against the backup. Two
  hundred and sixty-seven pounds, against nine hundred and eighty-four the week
  before. And look at the order count — thirty-nine. It was their busiest week
  of the month."
- R4: "There it is. Wednesday to Saturday, charged and refunded are the same
  number. They lost refrigeration, nobody took the storefront offline, so
  orders kept coming in and kept getting cancelled."
- R5: This is the one for the engineers. "That is a join, into two million order
  lines, inside a backup. I am not searching an index of filenames. It is SQL,
  and I can prove those refunds were real baskets rather than an adjustment
  somebody posted."
- R6: "That goes back to their accountant. No restore, no second copy of two
  hundred and forty-nine other restaurants' financial data sitting around while
  we looked."

**Where the argument actually lands**

R4 wins the room and R5 wins the follow-up questions. R3 only sets them up, so
keep it brisk — it is a number that looks wrong, nothing more.

If you are over time, cut R5 rather than R4. R4 is the one an audience
remembers, and R5's argument can be made in a sentence over the top of R4.

**Traps**

- Do not sell this as recovery speed. It is an audit answer, not an outage fix,
  and that is the stronger story. No duration figures.
- If Instant Access comes up from the floor, it is Standard tier and this is
  Archive — different capability, different shape. Worth a straight answer
  rather than a deflection, since the person asking has usually spotted that
  the two segments work differently and wants to know why.
- Keep query 1 brisk. It is a number that looks wrong, nothing more, and
  lingering on it spends the attention query 2 needs.

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

All three files were run end to end against PostgreSQL 18 and every figure on
this page came out of that run: the load, the six checks, the five audit
queries and the purge. That was PGlite rather than RDS, so the engine is real
but the instance is not. The checks at the end of the load are still the thing
to watch on the first run against your own instance.

Generation is deterministic. The data comes from an MD5-based hash of each key
rather than `random()`, so the same script produces the same ledger every time,
on any engine, and the figures quoted here stay true.
