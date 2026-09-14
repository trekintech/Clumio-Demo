# RDS segment: brief for the deck

Everything needed to build the RDS slides. Figures are from the live console,
not estimates. Nothing here needs checking against another document.

## Where this sits

Third of three capabilities. The other two are DynamoDB Backtrack (partition
level, in place) and S3 recovery. This one is deliberately not about speed, and
the deck should not try to make it so — the credibility of the whole set
depends on one of them being honest about being slow.

Persona: the AWS-native builder who owns Lambda, S3, DynamoDB and RDS, has
never bought a backup appliance, and carries the pager.

## The customer and the application

Kerbside is a multi-tenant food ordering platform. 250 restaurants in the
finance ledger, paid weekly. The settlement data lives in RDS PostgreSQL:
897,260 orders, 2,005,124 order lines, 23,000 weekly payouts.

Production keeps **13 months**. Anything older is purged and exists only in the
archived backup. That is an ordinary retention policy, not a contrivance.

## The story, in three acts

**Act 1 — the question.** September 2026. Alma Kitchen's accountant disputes
their February 2025 payouts. They believe they were underpaid. Nobody at
Kerbside can answer: retention removed those rows months ago.

**Act 2 — the two options.**

- Restore the whole database from the archive to answer one question about one
  restaurant and one month. Slow, expensive, and it leaves you holding a live
  second copy of 249 other restaurants' financial records while you rummage.
- Or query the backup where it sits.

**Act 3 — the answer.** The week beginning 10 February 2025 paid **£267.37**,
against £984.76 and £791.15 either side. It was not an underpayment. Alma
Kitchen lost refrigeration on the Wednesday and did not trade again until the
Sunday. Nobody marked the storefront closed, so orders kept arriving and were
cancelled on receipt: **25 orders, £935.26**, refunded in full.

The business got an answer, not a restore.

## The figures

The disputed month, as it appears on screen:

| Week beginning | Orders | Gross | Refunds | Commission | Net paid |
|---|---|---|---|---|---|
| 2025-02-03 | 35 | £1,218.73 | £17.80 | £216.17 | £984.76 |
| **2025-02-10** | **39** | £1,312.72 | £986.66 | £58.69 | **£267.37** |
| 2025-02-17 | 37 | £964.82 | £0.00 | £173.67 | £791.15 |
| 2025-02-24 | 38 | £1,174.47 | £47.95 | £202.77 | £923.75 |

**The detail that makes the story land is the order count.** That week took 39
orders — more than either neighbour. On volume it was their busiest week of the
month. They took the orders and could not fulfil one of them from Wednesday on.

The same week by day:

| Day | Orders | Refunded | Charged | Refunded |
|---|---|---|---|---|
| Mon 10 Feb | 3 | 0 | £94.53 | £0.00 |
| Tue 11 Feb | 5 | 1 | £108.18 | £12.85 |
| **Wed 12 Feb** | 4 | **4** | £189.83 | £189.83 |
| **Thu 13 Feb** | 6 | **6** | £202.32 | £202.32 |
| **Fri 14 Feb** | 6 | **6** | £258.32 | £258.32 |
| **Sat 15 Feb** | 9 | **9** | £284.79 | £284.79 |
| Sun 16 Feb | 6 | 1 | £174.75 | £38.55 |

Four consecutive days where charged and refunded are the same number, including
the Friday and Saturday that carry a restaurant's week. This table is the
strongest single slide in the segment.

Net is `gross − refunds − commission`. Alma is on a negotiated 18%. Always show
the commission column or the arithmetic looks broken.

## The three queries, and what each one proves

| # | Query | Proves |
|---|---|---|
| 1 | Four weekly payouts for one restaurant | There is an anomaly, and it is specific |
| 2 | The same week broken down by day | The cause, visible without explanation |
| 3 | Order lines behind the cancelled orders | It is real SQL over real data, not a canned lookup |

Query 3 is the one for technical buyers: a join into 2 million order lines,
inside a backup, returning the actual baskets — dish, quantity, unit price. It
answers "how do you know those refunds were real orders and not an adjustment
someone posted."

## How it works

```
RDS PostgreSQL ──backup──▶ Clumio SecureVault (Archive tier)
                                    │
                                    ▼
                          Record restore: schema browser
                          + SQL editor over the backup
                                    │
                                    ▼
                             results ──▶ CSV
```

Points worth making on an architecture slide:

- The backup is queryable **in place**. No instance is provisioned, no database
  is restored, no data is copied into the customer's account to be read.
- The schema comes back with it. The console's schema browser lists all six
  tables and every column with its type, read out of the backup itself.
- Only the matching records leave. The output is the rows that answer the
  question, exported as CSV.
- Scope is the point. Answering this question never materialises the other 249
  restaurants' financial records anywhere.

## Claims that are safe

- Query an archived backup with SQL, without restoring it.
- Retrieve only the records that answer the question.
- Export the result for the requester.
- No second live copy of the rest of the data.
- The schema is preserved and browsable, so you do not need to already know the
  table layout to use it.

## Claims to avoid

- **Anything about speed.** This is the SecureVault Archive tier and it is an
  audit and compliance capability. Frame it as answering a question you have
  time to answer: an audit, a dispute, a regulator. Never an outage.
- **Do not call it Backtrack.** Backtrack is the rollback capability used in
  the DynamoDB and S3 segments.
- **Do not mention Instant Access here.** That is Standard tier and a different
  capability with a different shape. Implying it applies invites a correction
  from anyone who knows the product.
- No RTO figures, no duration claims, no "in minutes".

## The line to close on

> Restoring a database to answer a question about one restaurant and one month
> means standing up a second copy of everyone else's financial records to read
> four rows. The question was never "can we get the data back". It was "can we
> answer the question without taking on the risk of having all of it live
> again."

## Tone

The audience is partner solutions engineers who will pick at exact figures.
Every number above is real and reconciles. Do not round them in the deck, and
do not add any that are not here.
