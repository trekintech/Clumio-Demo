# RDS segment: the story and the slide brief

> **If you're Claude and someone's just pasted this to you:** build the RDS
> section of a partner-event slide deck from it. There's a suggested seven-slide
> sequence near the end, but it's a starting point, not a rule. Everything you
> need is here. Don't invent figures and don't add timings or RTO numbers. Use
> both data tables as written, including the commission column. The audience is
> partner solutions engineers who'll check the arithmetic. UK English, GBP.
>
> It's a vendor deck, so Commvault and Clumio branding belongs on the slides.
> The app in the demo footage is deliberately unbranded, but that's a property
> of the demo, not the deck.

Every figure here came off the live console.

---

## What this segment has to do

The other two clips are about getting something back. A table gets corrupted
and comes back. A bucket gets emptied and the storefront keeps trading. Both
are dramatic because something visibly breaks and then visibly stops being
broken.

This one's different, and if you tell it as a third recovery story it'll be the
weakest of the three. Nothing's broken here. Nothing's down. Nobody's paging
anybody. A finance team has been asked a question they can't answer, and the
answer's sitting inside a backup.

The argument isn't "we got the data back". It's:

> The data you need is in a backup. Everything you already know how to do with
> data, you can do to it where it sits, without bringing it back.

That's a different claim from recovery, and it's the one that gets a finance or
compliance team interested in a backup product for the first time.

---

## The setup

Kerbside is a multi-tenant food ordering platform. Restaurants sign up, take
orders through it, get paid weekly. The finance ledger runs on RDS PostgreSQL:

- **250 restaurants**, each on a negotiated commission rate
- **897,260 orders**, with channel, payment method, VAT, tip and delivery fee
- **2,005,124 order lines**, the actual dishes and prices
- **23,000 weekly settlements**, one payout per restaurant per week

Production keeps **13 months**. Anything older gets purged and lives only in
the archived backup. That's a completely ordinary retention policy, and it's
also what creates the problem. Nobody did anything wrong: the rule is right, it
was applied correctly, and it's exactly why the business can't answer the
question.

After the purge, **602,492 orders are still live**. That matters for the demo.
The database isn't empty. It's a healthy production system that just doesn't go
back far enough.

---

## What kicks it off

**September 2026.** An accountant acting for Alma Kitchen, one of the 250
restaurants, emails in. Their February 2025 payouts look short. They reckon
they were underpaid and they'd like it explained.

That's nineteen months ago. Whoever ran that week has probably moved on, the
restaurant's own records are thin, and the rows that would settle it were
purged seven months back.

It's a completely unremarkable request. It's also the sort that quietly costs a
company days.

---

## What you'd have had to do instead

Put this on a slide before the demo. The demo only lands if the alternative is
fresh in the room.

To answer this the old way you restore the archived database. So you provision
an instance to restore onto, you pay for it, you wait. And now you're holding a
live, complete second copy of 249 other restaurants' financial records, every
order and every payout, so you can read four rows about one of them. Then you
have to secure it, justify it to whoever governs data in your business, and
remember to destroy it afterwards.

The compute isn't really the cost. The cost is that answering a small question
forced you to make a large copy, and that copy is a liability for as long as it
exists.

---

## The demo

Six screens, three of them queries. Each one answers the question the last one
raised. Don't present them as three things the product can do. The order is
what was paid, why it was short, and proof the evidence is real.

### Screen 1: production, in pgAdmin

**Why:** anyone can claim data has aged out. This shows it. You take the
accountant's question and put it to the live database, in the customer's own
tooling.

**What comes back:** nothing.

**What that tells you:** the query isn't wrong. It's well formed, it runs
without error, the tables are all there, and 602,492 orders are sitting in the
database. Production is fine. The answer just isn't among the rows it still
holds.

Labour that for a second. This isn't a broken database or a failed query. It's
a correct query against a healthy database that has correctly forgotten.

**What it leaves hanging:** so where is it, and what does getting at it cost?

---

### Screen 2: the Clumio console

**Why:** to show what you're about to query before you query it.

**What comes back:** the archived backup, and next to it a schema browser
listing all six tables. Expand any of them and you get every column and its
type.

**What that tells you:** the backup isn't an opaque blob. The structure came
with it and you can read it. You don't need to already know the schema, keep a
copy of the DDL, or track down the engineer who designed it.

It's a small moment but give it ten seconds, because it quietly answers "how
would I even know what to query".

**What it leaves hanging:** knowing the schema isn't the same as being able to
use it. Can you actually run something?

---

### Screen 3: what was actually paid

**Why:** because this is the accountant's question, unchanged. The same SQL
that just returned nothing against production, pointed at the backup. Say that
out loud. Nobody had to learn anything new to do this.

**What comes back:** four rows, one per week of February 2025.

| Week beginning | Orders | Gross | Refunds | Commission | Net paid |
|---|---|---|---|---|---|
| 2025-02-03 | 35 | £1,218.73 | £17.80 | £216.17 | £984.76 |
| **2025-02-10** | **39** | £1,312.72 | £986.66 | £58.69 | **£267.37** |
| 2025-02-17 | 37 | £964.82 | £0.00 | £173.67 | £791.15 |
| 2025-02-24 | 38 | £1,174.47 | £47.95 | £202.77 | £923.75 |

**What that tells you:** the accountant was right to ask. One week paid £267.37
where the others paid between £791 and £985. Call it a third.

**Then the bit that changes the story.** Look at the order count. That week took
**39 orders, more than any of the other three**. It wasn't a quiet week, it was
their busiest week of the month, and it paid a third as much.

So the easy explanations are already dead. They didn't trade badly. They
weren't closed in any way the platform recorded. Something happened to orders
that were placed and accepted.

**What it leaves hanging:** refunds are £986.66 against £1,312.72 of gross.
That's three quarters of the week's takings given back. Refunds of what? All at
once or spread out? And whose fault?

---

### Screen 4: why the week was short

**Why:** because £986.66 is a number, not an explanation. Finance can't reply to
an accountant with a total. They need the shape of it: when it happened, and
whether it looks like a billing problem or an operational one. So you take the
same week and break it down by day.

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

**What that tells you:** nothing, from you. The table does it. Four days
running, charged and refunded are the same number to the penny. Every order
taken Wednesday through Saturday was refunded in full. Monday, Tuesday and
Sunday look completely normal.

A billing error would be scattered. A dispute would be a handful of orders.
This is an outage shape, with a hard start and a hard stop. And it takes out
Friday and Saturday, the two days that carry a restaurant's week, which is why
four days out of seven costs them three quarters of the money.

**The story it reconstructs:** Alma Kitchen lost refrigeration on the
Wednesday. They couldn't serve. But nobody marked the storefront closed, so the
platform kept taking orders and every one got cancelled and refunded on
receipt. That's why the order count was high and the payout was low at the same
time, which is the bit that looked contradictory on the last screen.

The accountant now has their answer. The payout was right. The shortfall was
four days of their own cancellations, refunded to their customers in full.

**What it leaves hanging:** one thing, and it's what a sceptical auditor asks
next. Refund rows are just rows. Anyone can write a refund into a ledger. How
do you know these were real customer orders and not adjustments somebody posted
to make a discrepancy go away?

---

### Screen 5: proof the orders were real

**Why:** to answer exactly that. You stop looking at totals and go down to what
was in the baskets, which means joining the cancelled orders to the order lines.

**What comes back:** the contents of the biggest cancelled orders. Order
10000226, placed 19:01 on Wednesday 12 February, collection, £75.65:

| Dish | Qty | Unit | Line total |
|---|---|---|---|
| Tonkotsu ramen | 2 | £12.85 | £25.70 |
| Gyoza | 2 | £6.45 | £12.90 |
| Katsu curry | 3 | £12.35 | £37.05 |

**What that tells the business:** that's somebody's Wednesday night dinner for a
family. It's not a journal entry. Real dishes, real quantities, real prices, and
the lines add up to what was charged and refunded.

**What it tells the engineers in the room, and this is their moment:** that
query joined `orders` to `order_items`, **2,005,124 rows**, inside a backup.
Filtered it, sorted it, returned the answer. Three things follow:

1. It's a real query engine. Joins, aggregates, filters, ordering. Not a search
   index and not a file listing.
2. The relational structure survived into the backup. `order_items` still joins
   to `orders` on `order_id`. It's still a database, not an export.
3. Two million rows, and what you get back is the handful you asked for.

**What it leaves hanging:** nothing. That's the end.

---

### Screen 6: the export

Results go out as CSV and back to the accountant. That's what the business
actually wanted. Not a restored database, a file that answers the question.

---

## How to close it

> Nothing was restored. No instance got provisioned, no database got rebuilt,
> and at no point did a second live copy of 249 other restaurants' financial
> records exist anywhere. We asked a backup a question and got four rows, seven
> rows, and a basket of ramen.

And underneath it:

> The question was never whether you can get the data back. Of course you can.
> It was whether you can answer a small question without having all of it live
> again.

---

## Slide copy: the four asks

Short version for the deck, if the slides are carrying the asks and the footage
is carrying the answers. Each ask comes out of what the previous query showed,
so the order matters.

**Slide 1, the framing**

> It's September 2026. Alma Kitchen's accountant says their February 2025
> payouts were short and wants it explained.
>
> We keep 13 months of finance data. Those rows left production seven months
> ago, so nobody here can answer him.

**Slide 2, first ask** (then run query 1)

> Start with the obvious question: what did we actually pay them that month?
>
> Four rows would settle it. They're in the backup, not the database.

**Slide 3, second ask** (then run query 2)

> One week paid a third of the others, and took more orders than any of them.
> So it wasn't a quiet week.
>
> Next question: what happened on each individual day?

**Slide 4, third ask** (then run query 3)

> Four days where every single order was refunded in full. That's an outage,
> not a billing error.
>
> Last question, and it's the one an auditor asks: were those real customer
> orders, or someone tidying up a ledger?

**Close, what it's told us**

> The payout was right. Four days of their own cancellations, refunded to
> customers in full, proven down to the individual dish.
>
> We answered it from the backup. Nothing was restored, and no second copy of
> 249 other restaurants' financial records ever existed.

---

## Suggested slides

| # | Slide | Content |
|---|---|---|
| 1 | The setup | Kerbside, 250 restaurants, weekly payouts, 13-month retention |
| 2 | The email | The accountant's request, September 2026, about February 2025 |
| 3 | The problem | Retention did its job. Those rows aren't in production |
| 4 | The old answer | Restore the archive. The cost is the second copy, not the compute |
| 5 | Demo | Screens 1 to 6 |
| 6 | What just happened | Three queries: what was paid, why, and proof it was real |
| 7 | The close | Nothing was restored. No second copy existed |

Slide 6 is where the by-day table earns its place. If only one table makes the
deck, make it that one. Four days where charged equals refunded doesn't need a
presenter.

---

## Positioning

This sits on the SecureVault **Archive** tier, and the honest frame is that it
answers questions you've got time to answer. An audit, a dispute, a regulator, a
year end. Not an outage.

That's a feature of the set rather than something to manage. Nobody restores a
production database inside a working day to settle an invoice query, and an
audience of solutions engineers will trust the other two clips more for having
heard one described accurately. Three different shapes of problem beats three
claims of speed.

Keep duration and RTO numbers out of this segment. Everything above is a figure
that reconciles. Adding one that doesn't is the quickest way to lose a room like
that.

---

## Figures

Dataset: 250 restaurants, 897,260 orders, 2,005,124 order lines, 23,000
settlements, 378 MB.

After the purge: 294,768 orders and 7,750 settlements gone, **602,492 orders and
15,250 settlements still live**.

The disputed week, 10 to 16 February 2025: 39 orders, £1,312.72 gross, £986.66
refunded, £58.69 commission, **£267.37 net paid**.

Refunds that week: **25 orders cancelled by the restaurant, £935.26**, plus two
ordinary item-unavailable refunds of £51.40. 27 refunded orders, £986.66.

Alma Kitchen's rate is 18%. Net is `gross - refunds - commission`, so 1,312.72
less 986.66 is 326.06, less 58.69 commission, pays 267.37. Always show the
commission column or the arithmetic looks broken.

Rows on screen: 4, then 7, then 19.
