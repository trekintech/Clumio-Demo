# RDS segment: the story, and the brief for the deck

> **If you are Claude and someone has just pasted this to you:** build the RDS
> section of a partner-event slide deck from it. The suggested slide sequence is
> near the end — seven slides — but treat it as a starting point rather than a
> constraint. Everything you need is in this document; do not invent figures,
> and do not add timing or RTO numbers. Use the two data tables as they are
> written, including the commission column. The audience is partner solutions
> engineers who will check the arithmetic. UK English, GBP.
>
> The deck is a vendor deck, so Commvault and Clumio branding is expected on
> the slides. (The application shown in the demo footage is deliberately
> unbranded — that is a property of the demo, not of the deck.)

Everything needed to build the RDS slides and narrate the clip. Every figure
here came off the live console.

---

## What this segment has to achieve

The other two clips are about getting something back. A table gets corrupted
and comes back. A bucket gets emptied and the storefront keeps trading. Both
are recovery stories and both are dramatic, because something visibly breaks
and then visibly stops being broken.

This one is different, and if it is told as a third recovery story it will be
the weakest of the three. Nothing is broken here. Nothing is down. Nobody is
paging anybody. A finance team has been asked a question they cannot answer,
and the answer is sitting inside a backup.

The argument is not "we got the data back". It is:

> The data you need is in a backup. Everything you know how to do with
> data — query it, join it, filter it, aggregate it, export it — you can do to
> it where it sits, without bringing it back.

That is a different claim from recovery, and it is the one that makes a
finance, audit or compliance team care about a backup product for the first
time.

---

## The world

Kerbside is a multi-tenant food ordering platform. Restaurants sign up, take
orders through it, and get paid weekly. The finance ledger runs on RDS
PostgreSQL and holds:

- **250 restaurants**, each on a negotiated commission rate
- **897,260 orders**, each with its channel, payment method, VAT, tip and
  delivery fee
- **2,005,124 order lines** — the actual dishes, quantities and prices
- **23,000 weekly settlements** — one payout row per restaurant per week

Production keeps **13 months**. Anything older is purged on a schedule and
exists only in the archived backup. This is an entirely ordinary retention
policy. It is also the thing that creates the problem, and it is worth saying
out loud that nobody did anything wrong here: the retention rule is correct,
it was applied correctly, and it is precisely why the business cannot answer
the question.

After the purge runs, **602,492 orders remain live**. This matters for the
demo: the database is not empty. It is a healthy production system that simply
does not go back far enough.

---

## The trigger

**September 2026.** An accountant acting for Alma Kitchen, one of the 250
restaurants, sends an email. Their February 2025 payouts look short. They think
they were underpaid, and they would like it explained.

Nineteen months have passed. Whoever ran that week has probably moved on. The
restaurant's own records of it are thin. And the rows that would settle it were
purged from production seven months ago.

This is an unremarkable request. It is also the kind that quietly costs a
company days.

---

## What you would have had to do instead

Worth putting on a slide before the demo starts, because the demo only lands if
the alternative is fresh in the room.

To answer this the old way you restore the archived database. That means:

- Provisioning an instance to restore it onto, and paying for it
- Waiting for the restore
- Now holding a **live, complete, second copy of 249 other restaurants'
  financial records** — every order, every card payment method, every payout —
  in order to read four rows about one of them
- Securing that copy, justifying it to whoever governs data in your business,
  and remembering to destroy it afterwards

The cost is not really the compute. It is that answering a small question
forced you to make a large copy, and that copy is now a liability for as long
as it exists.

---

## The demo, query by query

Six screens, three of them queries. Each one answers the question the previous
one raised, and that chain is the point — do not present them as a list of
things the product can do. The order is deliberate: **what was paid, why it was
short, and proof the evidence is real.**

### Screen 1 — production, in pgAdmin. The question, asked of the live database.

**Why we run it:** anybody can assert that data has aged out. This shows it.
We take the accountant's question and put it to the production database, in the
customer's own tooling, in front of the audience.

**What comes back:** nothing. No rows.

**What it tells you:** the query is not wrong. It is well formed, it runs
without error, the tables exist, and there are 602,492 orders sitting in there.
Production is healthy. The answer simply is not among the rows it still holds.

That distinction is worth labouring for a beat. This is not a broken database
or a failed query. It is a correct query against a correct database that has
correctly forgotten.

**What it leaves open:** so where is it, and what does it cost to get at it?

---

### Screen 2 — the Clumio console. The backup, and its schema.

**Why we run it:** to establish what we are about to query, before we query it.

**What comes back:** the archived backup, and beside it a schema browser
listing all six tables — `tenants`, `contracts`, `dishes`, `orders`,
`order_items`, `settlements` — each one expandable to every column and its
type.

**What it tells you:** the backup is not an opaque blob. The structure came
with it and is readable. You do not need to already know the schema, keep a
copy of the DDL, or find the engineer who designed it. Open the backup and the
shape of the data is right there.

This is a small moment and it is worth ten seconds, because it quietly answers
"how would I even know what to query".

**What it leaves open:** knowing the schema is not the same as being able to
use it. Can we actually run something?

---

### Screen 3 — query one. What was actually paid.

**Why we run it:** because this is the accountant's question, unchanged. The
same SQL that returned nothing against production, pointed at the backup. That
parallel is the entire pitch and it should be said explicitly: nothing new had
to be learned to do this.

**What comes back:** four rows, one per week of February 2025.

| Week beginning | Orders | Gross | Refunds | Commission | Net paid |
|---|---|---|---|---|---|
| 2025-02-03 | 35 | £1,218.73 | £17.80 | £216.17 | £984.76 |
| **2025-02-10** | **39** | £1,312.72 | £986.66 | £58.69 | **£267.37** |
| 2025-02-17 | 37 | £964.82 | £0.00 | £173.67 | £791.15 |
| 2025-02-24 | 38 | £1,174.47 | £47.95 | £202.77 | £923.75 |

**What it tells you:** the accountant was right to ask. One week paid £267.37
where the others paid between £791 and £985. Roughly a third.

**Then the detail that changes the story.** Read the order count. That week
took **39 orders — more than any of the other three**. This was not a quiet
week. It was their busiest week of the month, and it paid a third as much.

So the obvious explanations are already dead. They did not trade badly. They
were not closed in any way the platform recorded. Something happened to orders
that were placed and accepted.

**What it leaves open:** the refunds column says £986.66 against £1,312.72 of
gross. That is three quarters of the week's takings refunded. Refunds of what?
Were they spread across the week, or concentrated? And critically — whose fault
were they?

---

### Screen 4 — query two. Why the week was short.

**Why we run it:** because £986.66 is a number, not an explanation. A finance
team cannot reply to an accountant with a total. They need the shape of it:
when it happened, and whether it looks like a billing problem or an operational
one.

So we take the same week and break it down by day.

**What comes back:** seven rows.

| Day | Orders | Refunded | Charged | Refunded |
|---|---|---|---|---|
| Mon 10 Feb | 3 | 0 | £94.53 | £0.00 |
| Tue 11 Feb | 5 | 1 | £108.18 | £12.85 |
| **Wed 12 Feb** | 4 | **4** | £189.83 | **£189.83** |
| **Thu 13 Feb** | 6 | **6** | £202.32 | **£202.32** |
| **Fri 14 Feb** | 6 | **6** | £258.32 | **£258.32** |
| **Sat 15 Feb** | 9 | **9** | £284.79 | **£284.79** |
| Sun 16 Feb | 6 | 1 | £174.75 | £38.55 |

**What it tells you:** this needs no interpretation from the stage. For four
consecutive days, charged and refunded are the same number, to the penny.
Every single order taken on Wednesday, Thursday, Friday and Saturday was
refunded in full. Monday, Tuesday and Sunday look completely normal.

That is not the pattern of a billing error, which would be scattered. It is not
the pattern of a dispute, which would be a handful of orders. It is an outage
shape — a hard start and a hard stop.

And it includes **Friday and Saturday, the two days that carry a restaurant's
week**, which is why the financial impact is so far out of proportion to four
days out of seven.

**The story it reconstructs:** Alma Kitchen lost refrigeration on the
Wednesday. They could not serve. But nobody marked the storefront closed, so
the platform kept accepting orders, and every one of them was cancelled and
refunded on receipt. That is why the order count was high and the payout was
low at the same time — the two facts that looked contradictory on the previous
screen.

**The answer to the accountant is now complete:** the payout was correct. The
shortfall was four days of their own cancellations, refunded to their
customers in full.

**What it leaves open:** one thing, and it is the question a sceptical
auditor — or a sceptical solutions engineer in the audience — asks next.
Refund rows are just rows. Anybody can write a refund into a ledger. How do we
know these were real customer orders and not adjustments someone posted to make
a discrepancy disappear?

---

### Screen 5 — query three. Proof the orders were real.

**Why we run it:** to answer exactly that. We stop looking at totals and go
down to what was in the baskets — which means joining from the cancelled orders
into the order lines.

**What comes back:** the contents of the largest cancelled orders. For example
order 10000226, placed 19:01 on Wednesday 12 February, collection, £75.65:

| Dish | Qty | Unit | Line total |
|---|---|---|---|
| Tonkotsu ramen | 2 | £12.85 | £25.70 |
| Gyoza | 2 | £6.45 | £12.90 |
| Katsu curry | 3 | £12.35 | £37.05 |

**What it tells you, commercially:** that is somebody's Wednesday night dinner
for a family. It is not a journal entry. Real dishes, real quantities, real
prices, and the lines add up to the amount charged and refunded. The evidence
holds.

**What it tells you, technically, and this is the moment for the engineers in
the room:** that query joined `orders` to `order_items` — **2,005,124 rows** —
inside a backup, filtered it, sorted it and returned the answer. Three things
follow from that:

1. It is a real query engine, not a search index or a file listing. Joins,
   aggregates, filters, ordering.
2. The relational structure survived into the backup. `order_items` still joins
   to `orders` on `order_id`. It is still a database, not an export.
3. Scale is not a barrier. Two million rows, and the thing you get back is the
   handful you asked for.

**What it leaves open:** nothing. This is where the segment ends.

---

### Screen 6 — the export.

The result goes out as CSV and back to the accountant. That is the artefact the
business actually wanted: not a restored database, a file that answers the
question.

---

## The close

Worth landing hard, because it is the line that separates this from a recovery
story:

> Nothing was restored. No instance was provisioned, no database was rebuilt,
> and at no point did a second live copy of 249 other restaurants' financial
> records exist anywhere. We asked a question of a backup and got four rows,
> seven rows, and a basket of ramen.

And the reframe underneath it:

> The question was never "can we get the data back". Of course you can get it
> back. The question was whether you could answer a small question without
> taking on the risk and cost of having all of it live again.

---

## Suggested slide sequence

| # | Slide | Content |
|---|---|---|
| 1 | The setup | Kerbside, 250 restaurants, weekly payouts, 13-month retention |
| 2 | The email | The accountant's request, September 2026, about February 2025 |
| 3 | The problem | Retention did its job. The rows are gone from production |
| 4 | The old answer | Restore the archive. The cost is the second copy, not the compute |
| 5 | Demo | Screens 1–6 |
| 6 | What just happened | Three queries: what was paid, why, and proof it was real |
| 7 | The close | Nothing was restored. No second copy existed |

Slide 6 is where the by-day table earns its place. If you only put one table in
the deck, it is that one — four days where charged equals refunded needs no
explanation from a presenter.

---

## Positioning

This capability sits on the SecureVault **Archive** tier, and the honest frame
is that it answers questions you have time to answer: an audit, a dispute, a
regulator, a year-end. Not an outage.

That is a feature of the story rather than a caveat to manage. Nobody restores
a production database inside a working day to settle an invoice query, and an
audience of solutions engineers will trust the other two clips more for having
heard one of them described accurately. Pair it with the DynamoDB and S3
segments and the set reads as three different shapes of problem, which is
stronger than three claims of speed.

Avoid duration and RTO numbers anywhere in this segment. Everything above is a
figure that reconciles; adding one that does not is the fastest way to lose a
technical room.

---

## Figures reference

Dataset: 250 restaurants · 897,260 orders · 2,005,124 order lines · 23,000
settlements · 378 MB.

After the retention purge: 294,768 orders and 7,750 settlements removed,
**602,492 orders and 15,250 settlements still live**.

The disputed week, 10–16 February 2025: 39 orders, £1,312.72 gross, £986.66
refunded, £58.69 commission, **£267.37 net paid**.

Refunds in that week: **25 orders cancelled by the restaurant, £935.26**, plus
2 ordinary item-unavailable refunds of £51.40. 27 refunded orders, £986.66.

Alma Kitchen's commission rate is 18%. Net is `gross − refunds − commission`,
so 1,312.72 − 986.66 = 326.06, less 58.69, pays 267.37. Always show the
commission column or the arithmetic looks wrong.

Query row counts on screen: 4, then 7, then 19.
