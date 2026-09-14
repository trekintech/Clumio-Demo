# RDS: the audit scenario

The third capability. Unlike the DynamoDB and S3 clips this one isn't about
recovery speed, and it mustn't be told as though it is.

Granular record retrieval runs SQL against an archived backup and exports the
result. It uses the SecureVault **Archive** tier, and it answers the sort of
question you've got time to answer. An audit, a dispute, a regulator. Not an
outage.

That's the story rather than something to work around. Nobody restores a
production database to settle one invoice query.

## The story

Kerbside pays its restaurants weekly. Those payments live in an RDS PostgreSQL
database, and production keeps 13 months of them. Anything older is purged and
lives only in the archived backup.

In September 2026, Alma Kitchen's accountant disputes their February 2025
payouts. They believe they were underpaid.

That data left production months ago.

**Without granular retrieval,** you restore a whole database from an archive to
answer one question about one restaurant and one month. It's slow, it costs,
and while you're rummaging through it you're holding a second live copy of 249
other restaurants' financial records.

**With it,** you query the archived backup where it sits, pull the rows that
answer the question, and export them as CSV for finance.

**The answer,** which the query produces: the week beginning 10 February 2025
paid out £267.37, against £984.76 and £791.15 in the weeks either side. Not an
underpayment. Alma Kitchen lost refrigeration on the Wednesday and did not
trade again until the Sunday. Nobody marked the storefront closed, so orders
kept arriving and were cancelled on receipt: 25 orders, £935.26, refunded in
full.

The bit that makes it land is the order count. That week took 39 orders, more
than the 35 and 37 either side. On volume it was a normal week. They took the
orders and couldn't fulfil one of them from the Wednesday on.

That's a better ending than "we recovered the data". The business got an answer,
not a restore.

## What you need

An RDS **PostgreSQL** instance you can reach from pgAdmin or psql. If you
already have one, use it: everything goes into its own `kerbside_finance`
schema, so it can't collide with anything else on the instance and drops
cleanly afterwards.

Six tables and about 2.9 million rows, so a few hundred MB. Nothing here needs
a large instance, but it isn't a toy dataset either. "Restore the whole
database to answer one question" only sounds absurd if the database is big
enough to be worth not restoring.

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
written separately, so gross, refunds, commission and net always agree with the
transactions behind them. Six checks at the end of the load prove it.

Commission is **18% for Alma Kitchen**, 14% to 26% elsewhere. Net is
`gross - refunds - commission`, which is why a settlement row never reads as
gross minus refunds on its own.

VAT is recorded per order for audit and doesn't enter the settlement. The
restaurant accounts for its own VAT and the platform pays gross less
commission.

## Sizing

The default is 250 restaurants, which comes to **378 MB** of tables and
indexes. The `create-db-instance` command above allocates 20 GB, so that's
under 2%. Storage isn't what this costs you. An idle instance billed by the
hour dwarfs a few hundred MB of gp3, so watch that you delete the instance
afterwards, not the row count.

Three sizes, all measured:

| `tenant_count` | orders | order lines | schema size |
|---|---|---|---|
| 250 (default) | 897,260 | 2,005,124 | 378 MB |
| 100 | 345,494 | 771,813 | 145 MB |
| 25 | 80,808 | 180,470 | 34 MB |

**Alma Kitchen's figures are identical at all three.** Every restaurant owns
its own block of order IDs, so estate size doesn't move a single number this
document quotes. That was checked, not assumed.

Pick the size before step 5. Changing the data after the backup means taking
the backup again.

Go with 250. The whole argument is that restoring the database to answer one
question is absurd, and that reads better at 900,000 orders than at 80,000. The
one thing to watch on your first run is how long queries 2 and 3 take in the
Clumio editor against the archive, since that's the part nobody can measure in
advance. If it drags, reload at 100 and back up again. The narration doesn't
change.

---

# Running it

Seven steps. Steps 1 to 4 and step 6 are pgAdmin against your own instance.
Steps 5 and 7 are Clumio.

The order matters in one place only: the purge in step 6 has to come after the
backup in step 5, or there's nothing in the archive to query and the demo has
no ending.

## Step 1. Connect pgAdmin to the instance

Object Explorer, on the left. Right-click **Servers**, then **Register** →
**Server…**

- **General** tab: Name, anything. `Kerbside RDS` will do.
- **Connection** tab: Host is the RDS endpoint
  (`something.eu-west-2.rds.amazonaws.com`), Port `5432`, Maintenance database
  is your database name, then username and password. Tick **Save password**.
- **Parameters** tab: leave SSL mode at `prefer`. RDS accepts it.

Save. The server should show up in the tree with its icon no longer greyed out.

If it sits there and then times out, that's the security group rather than
anything in pgAdmin. Inbound TCP 5432 from your own IP, not 0.0.0.0/0.

## Step 2. Open a Query Tool on the right database

Expand **Servers → your server → Databases** and click your database once so it
is selected. Then **Tools → Query Tool**, or right-click the database and pick
Query Tool from there.

The Query Tool connects to whatever was selected when you opened it. Open it
with `postgres` highlighted and that's where the schema lands. The tab title
names the database it's connected to, so check it before you run anything.

## Step 3. Load the data

The folder icon in the Query Tool toolbar opens a file. Point it at
`sql/01-schema-and-data.sql` in your clone. Opening that file in a text editor
and pasting the contents in works just as well, and avoids pgAdmin's file
dialog.

**F5** runs it. Give it a couple of minutes, it's writing about 2.9 million
rows. It drops and recreates `kerbside_finance` at the top, so re-running is
safe and nothing else in the database is touched.

For a faster loop while you are rehearsing, edit the knobs near the top of the
file:

```sql
INSERT INTO gen_params VALUES (250, DATE '2025-01-01', DATE '2026-09-30');
```

Drop the tenant count to 25 and it loads in seconds. Alma Kitchen's figures
don't change when you do, because every restaurant owns its own block of order
IDs, so estate size doesn't disturb the numbers this demo quotes.

Two pgAdmin habits will make this look like it failed when it hasn't:

- **Data Output only shows the last result set.** The file ends with the
  reconciliation checks, so those are what you'll see. That's the useful one,
  but nothing else in the script shows up.
- **`search_path` is per-session.** Each file sets it at the top, so running
  whole files is fine. Run a fragment on its own without that line and you get
  `relation "orders" does not exist`.

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
1312.72 less 986.66 is 326.06, less 58.69 commission, pays 267.37. Drop that
column and the row looks like it doesn't add up, which is the last thing you
want an auditor's arithmetic doing on camera.

If 10 February reads £267.37 with 39 orders, the data's right and everything
downstream will work. If it doesn't, stop here rather than backing up the wrong
numbers.

## Step 5. Back up

In Clumio, back the instance up to **SecureVault Archive**.

Don't move on until it's finished. The purge can't be undone against
production, and after it the archive is the only copy. That's the demo, but
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
database, because the 13 months retention is meant to keep are all still there.
If someone asks whether you just truncated the table, the answer's on screen.

The file finishes by running the auditor's question against production, now
that retention has taken the answer away. **No rows.** That's the shot. The
query is correct, the database just doesn't hold the answer any more.

## Step 7. Query the archive

This doesn't run in pgAdmin. It goes in the **Clumio query editor**, against
the backup taken in step 5. The full file is `sql/03-audit-query.sql`, which
holds five queries.

That editor is stricter than pgAdmin, and different enough that you have to
fill the file in before it'll run.

### Table names are generated per backup

Clumio doesn't expose the tables under their own names. It flattens schema and
table into a single identifier with the backup baked into it:

```
kerbside_finance_settlements_dda39285_20260914_2c2e2d1db06211f19fc1f219e1933199
└─── schema ───┘└─ table ──┘└─ id ──┘└─ date ┘└────── backup job id ──────┘
```

The suffix changes every time you take a backup, so these can't live in the
repo. `sql/03-audit-query.sql` uses three tokens instead. Grab the real names
from the table picker in the console and find-replace:

| Token | Replace with |
|---|---|
| `SETTLEMENTS_TABLE` | `kerbside_finance_settlements_…` |
| `ORDERS_TABLE` | `kerbside_finance_orders_…` |
| `ORDER_ITEMS_TABLE` | `kerbside_finance_order_items_…` |

Set **Default database name** to the matching
`kerbside_…_rds_<account>_<region>_instance_<resource>` entry and you won't need
to prefix the database as well.

Do this **after** you've taken the backup you'll actually demo from, and save
the filled-in queries. Taking the backup again invalidates every name in them.

### The engine isn't Postgres

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
literal is the one combination that fails, and it's easy to put back without
noticing because it's what you'd write against Postgres.

`03-audit-query.sql` uses `SUBSTR` for `placed_at` and `CAST` for
`period_start`, which are the two forms that were actually run in the console.
`SUBSTR` also doesn't care what format the timestamp is in. It won't run in
pgAdmin, where `placed_at` is a real timestamp. That file is for the Clumio
editor and nothing else.

`CAST(placed_at AS DATE)` working is a useful one to know. That column holds a
full timestamp as text (`2025-01-05 13:51:00`) and the cast copes with it.
Plain Trino wouldn't, so the engine's more forgiving than its error messages
suggest.

The rest of what the audit queries use is confirmed working: `ROUND(x / 100.0,
2)`, `COUNT(*)`, `GROUP BY`, `ORDER BY` on a column ordinal, and a two-table
`JOIN`. Also: **SELECT statements only**, so no `SET` and no `search_path`, and
**paste one query at a time**.

### If it returns nothing

Run the smallest query you can first. It separates "the editor can't see the
table" from "my query is wrong":

```sql
SELECT COUNT(*) FROM SETTLEMENTS_TABLE
```

Expect **23000**.

- **Errors.** The name's wrong rather than the query. Copy it again from the
  table picker, the suffix is long and easy to truncate.
- **Returns 0.** The backup is older than the data load, so the tables really
  aren't in it. Take the backup again.
- **Returns 23000 but your query still gives nothing.** Check you replaced
  every token, including both of them in query 4.

The red wavy underlines in the editor are the browser's spellchecker on a plain
textarea, not SQL errors. Ignore them.

### Worth saying on camera

Those generated table names are ugly, which is useful. They're visible proof
you aren't querying production, because the name has the backup date and job id
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

That's copied from the console, not from Postgres. The engine trims trailing
zeros, so a round number shows as `0.0` rather than `0.00`.

There's no weekday column because `to_char` doesn't exist in that engine. The
12th is the Wednesday and the 15th the Saturday, so say it rather than show
it.

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

The full story in prose, what each query proves, and the figures written out
for slides are all in [rds-slide-brief.md](rds-slide-brief.md). This section is
the shot list. That one's what you hand to whoever's building the deck.

The whole segment is text in grids. No dashboard going red, no four-second poll
bringing it back, so it can't be carried the way clips 1 and 2 are. What it has
instead is a build across **three queries**: what was paid, why it was short,
and proof the evidence is real. Shoot it in that order and it works. Shoot it
as "here's a query tool" and it dies.

Three is the number. One doesn't show it's a real engine, and five is a man
reading SQL out loud.

**Why each one follows the last.** Don't present these as three things the
product can do. Each one's there because the one before left a question open:

| Query | Runs because | Leaves open |
|---|---|---|
| 1. The payouts | It's the accountant's question, unchanged. The same SQL that just returned nothing against production | £986.66 of refunds is a number, not an explanation. When did it happen, and whose fault was it? |
| 2. By day | Finance can't reply to an accountant with a total. They need the shape: all at once, or spread out? | Refund rows are just rows. Anyone can post one. Were these real orders? |
| 3. The baskets | To answer exactly that, by going down to what was in them | Nothing. This is the end. |

The pivot in query 1 is the **order count**, not the payout. £267.37 against
£900 only says something's odd. Thirty-nine orders, more than either
neighbouring week, kills the easy explanations. They didn't trade badly and
they weren't closed in any way the platform recorded. That's what makes query 2
necessary rather than just interesting.

| Seg | Capture | Doing | Rows |
|---|---|---|---|
| R1 | pgAdmin, against production | The auditor's question | 0 |
| R2 | Clumio Record restore | The backup, and the schema browser beside it | — |
| R3 | Clumio query editor | Query 1: the four February payouts | 4 |
| R4 | Clumio query editor | Query 3: the same week by day | 7 |
| R5 | Clumio query editor | Query 4: the baskets behind the cancellations | 19 |
| R6 | Export | Download as CSV, open it | — |

Queries 2 and 5 stay in the file but don't get recorded. Query 2 is the
itemised list you'd actually send an accountant, so have it ready in case
someone asks to see it. Query 5 collapses the answer to one line for when the
question comes back from the floor.

**Narration**

- R1: "This is the live database. The question's about February last year, and
  retention took that out months ago. There's nothing to query."
- R2: "The archive has it. And look at the panel on the left, that's the schema
  read straight out of the backup. Six tables, every column, still the shape the
  application wrote them in."
- R3: "I'm not restoring anything. I'm running SQL against the backup. Two
  hundred and sixty-seven pounds, against nine hundred and eighty-four the week
  before. And look at the order count. Thirty-nine. That was their busiest week
  of the month."
- R4: "There it is. Wednesday to Saturday, charged and refunded are the same
  number. They lost refrigeration, nobody took the storefront offline, so orders
  kept coming in and kept getting cancelled."
- R5: This one's for the engineers. "That's a join, into two million order
  lines, inside a backup. I'm not searching an index of filenames. It's SQL, and
  I can prove those refunds were real baskets rather than an adjustment somebody
  posted."
- R6: "That goes back to their accountant. No restore, and no second copy of two
  hundred and forty-nine other restaurants' financial data sitting around while
  we looked."

**Where the argument actually lands**

R4 wins the room and R5 wins the follow-up questions. R3 just sets them up, so
keep it brisk. It's a number that looks wrong, nothing more.

If you're over time, cut R5 rather than R4. R4 is the one an audience
remembers, and you can make R5's point in a sentence over the top of it.

**Traps**

- Don't sell this as recovery speed. It's an audit answer, not an outage fix,
  and that's the stronger story. No duration figures.
- If Instant Access comes up from the floor, it's Standard tier and this is
  Archive. Different capability, different shape. Give a straight answer rather
  than deflecting, because whoever's asking has usually spotted that the two
  segments work differently and wants to know why.
- Don't linger on query 1. It spends the attention query 2 needs.

## Afterwards

If you used an existing instance, just drop the schema. Nothing else on it is
affected:

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

It targets PostgreSQL and lives in a `kerbside_finance` schema, so it won't
disturb anything already on the instance, and `DROP SCHEMA kerbside_finance
CASCADE` removes every trace of it.

All three files were run end to end against PostgreSQL 18 and every figure on
this page came out of that run: the load, the six checks, the five audit
queries and the purge. That was PGlite rather than RDS, so the engine's real
but the instance isn't. The checks at the end of the load are still the thing
to watch on your first run against your own instance.

Generation is deterministic. The data comes from an MD5 hash of each key rather
than `random()`, so the same script gives you the same ledger every time on any
engine, and the figures here stay true.
