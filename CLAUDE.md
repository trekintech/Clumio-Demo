# Kerbside — project context

## What this is

A fake multi-tenant food ordering platform, built to demonstrate Clumio
recovery capabilities on stage at a Commvault partner event. It is not a
product. It is the *customer's* application, used as a backdrop so an audience
can see real business impact when data is corrupted and then recovered.

The app runs locally and reads real AWS services in a sandbox account. Recovery
is performed for real in the Clumio console. Footage of both is recorded and
narrated live on stage.

## Hard constraints

**Never add Commvault or Clumio branding to the app.** No logos, no brand
colours, no product names in the UI. The moment it looks like a vendor demo the
audience stops believing it is a real application. This is deliberate and is not
up for optimisation.

**Keep the UI slightly plain.** Real internal ops dashboards are unglamorous.
Visual roughness buys credibility here. Do not "improve" it into something that
looks like a designed product landing page.

**No credentials in the repo.** Auth comes from the AWS CLI profile only. There
is no `.env` and there should not be one. Never write access keys into any file.

## The narrative the demo serves

Partners currently sell Commvault Cloud to infrastructure teams. Clumio targets
a different persona — the AWS-native builder who owns Lambda, S3, DynamoDB and
Aurora, has never bought a backup appliance, and carries the pager themselves.

The three capabilities being shown:

1. **DynamoDB Backtrack** — restore specific partition keys, to the second, in
   place. Native PITR cannot do partition-level or in-place recovery, and PITR
   backups die with the source table. This is the strongest clip and leads.
2. **S3 recovery** — access protected copies without waiting for a full
   rehydrate of a large bucket.
3. **RDS granular record retrieval** — run SQL against an archived backup and
   download results as CSV.

## Accuracy notes — important

The RDS capability requires the SecureVault **Archive** tier and has a thaw
period of **up to 48 hours**. It is therefore an *audit and compliance* story,
not a fast-recovery story. Do not write copy anywhere in this repo that implies
RDS query is instant.

S3 access mechanics and timings had not been verified against current
documentation at the time this repo was written. Do not add specific RTO numbers
or timing claims to the README, the UI, or anything else without checking the
docs first.

The DynamoDB and Backtrack claims were verified against the Commvault blog post
on Clumio Backtrack for DynamoDB (August 2025).

The S3 overwrite/corruption scenario is narrated as recovering via "Backtrack's
version rollback." That has **not** been verified the way the DynamoDB claim
above was — it has not been checked against documentation, only asserted.
Confirm the correct product name for S3 object-version recovery before this
goes on stage; do not assume the verified DynamoDB claim extends to S3.

## Architecture

- `server.js` — Express on port 5173. Serves `public/` and exposes a small JSON
  API. All AWS calls happen server-side so no credentials ever reach the
  browser.
- `public/` — plain HTML, CSS and vanilla JS. No build step, no framework. Keep
  it that way; a build step is one more thing to fail before a live session.
- `config.js` — tenants, menus, blast radius, resource names. Single source of
  truth for demo data.
- `validation.js` — the rule that decides whether an order is corrupt. Shared
  between the server and the verify script so the dashboard and the terminal
  can never disagree. If pricing logic changes, change this too.
- `scripts/setup.js` — preflight check (Node version, AWS CLI, credentials,
  bucket name) plus `npm install`. Doesn't touch AWS itself.
- `scripts/seed.js` — creates table and bucket, loads tenants, enables PITR.
- `scripts/bad-deploy.js` — corrupts three tenant partitions and writes
  `incident.json` with the exact timestamp and partition keys to feed into
  Backtrack.
- `scripts/s3-delete-incident.js` — hard-deletes menu and settlement objects
  for the same three tenants (availability scenario, CloudFront failover).
- `scripts/s3-corrupt-incident.js` — overwrites menu objects in place with
  visibly corrupted content, same keys (data scenario, version rollback).
- `scripts/verify.js` — per-tenant audit proving tenants outside the blast
  radius were untouched. This output gets filmed.

See `docs/s3-demo-runbook.md` for the full S3 demo procedure.

The blast radius is three tenants, defined in `config.js`. The point of the
whole demo is that recovery is *scoped*, so never widen it to all tenants —
see Scale below for why "all tenants" is now a much bigger number than it
used to be.

## Scale

The stage narrative is "three tenants corrupted, out of four thousand." That
comparison is the whole point of the DynamoDB clip — native full-table
restore versus Backtrack hitting three partitions — and it only works if the
tenant dropdown actually looks like a four-thousand-row estate on camera. Eight
rows in a dropdown does not read as "an estate" to anyone watching.

`config.js` generates `SYNTHETIC_TENANT_COUNT` filler tenants (default 4,119)
in addition to the 8 named ones, for 4,127 total — the number already baked
into `public/index.html` before this section existed. Synthetic tenants exist
for exactly one reason: to make the estate look large. They get a name and
orders and nothing else — no menu rows, no artwork, no S3 objects — because
none of them ever appear on camera and generating real assets for thousands of
fake tenants would be pure waste. `scripts/seed.js` also writes
`SYNTHETIC_ORDERS_PER_TENANT` (default 75) orders per synthetic tenant, which
puts total seeded items at roughly 314,000 — enough to look real, still
trivial to store.

**Do not "optimise" the default tenant count back down.** A small default
would make local testing marginally faster but would silently break the stage
argument the next time someone seeds before a recording without noticing the
dropdown is thin. If you need a fast local loop, override the environment
variable for that session — `SYNTHETIC_TENANT_COUNT=50 npm run seed` — rather
than changing the default.

Both `npm run seed` and `npm start` read `SYNTHETIC_TENANT_COUNT` from the
environment independently. Export it once per shell session before running
either, the same way `KERBSIDE_BUCKET` already works — otherwise the table and
the dropdown will disagree on how many tenants exist.

`scripts/verify.js` only audits the 8 named tenants (the blast radius plus
five controls). It deliberately does not loop over the synthetic filler —
that script is run live and filmed immediately after recovery, and scanning
four thousand-plus partitions and S3 prefixes on stage would turn an instant
check into a multi-minute one for tenants that were never touched anyway.

## Cost and cleanup

The table is on-demand (`PAY_PER_REQUEST`) and `scripts/seed.js` enables
point-in-time recovery on it. Both are trivial at this scale — on-demand
write cost for ~314,000 small items is well under a dollar one-off, and the
table itself is only tens of MB — but PITR's continuous backup storage bills
against table size for as long as it stays enabled. Disable it from the
DynamoDB console after the event rather than leaving it on indefinitely.

The dashboard polls every four seconds by design (see Conventions) — that's
what makes recovery appear on screen unattended, and it's fine for the length
of a demo session. It is not a reason to leave `npm start` running for days
afterwards. Stop the local server once you're done recording.

## S3 failover design

The S3 clip uses a CloudFront origin group in front of the source bucket, not
a manual origin flip: source bucket as primary, a Clumio Instant Access
endpoint as secondary, failover criteria set to **403 and 404, both**. The
distribution and origin group are built by hand in the CloudFront console —
deliberately not created in code, the same way the RDS and DynamoDB Clumio
configuration isn't — see `docs/s3-demo-runbook.md` for the exact console
steps, the cache-TTL warning, and the tier constraint.

**The distinction that must never blur: 200 versus an error code.**

- Deletion → S3 returns 403/404 → CloudFront's origin group fails over
  automatically → the storefront keeps working with no human intervention.
  This is an *availability* problem, and it's the one CloudFront failover can
  actually solve. `scripts/s3-delete-incident.js` produces it.
- Overwrite → S3 still returns 200, just with corrupted content → failover
  never fires, because there is no error code to trigger on. This is a *data*
  problem — the bytes are wrong, not missing — and needs the previous object
  version restored, not a different origin. `scripts/s3-corrupt-incident.js`
  produces it.

These two scenarios must stay in separate scripts and separate narration.
Conflating them ("recovery fixed it" without saying which failure mode) is
exactly the mistake that destroys the argument: it implies CloudFront
failover is a general-purpose fix, when it only ever masks *availability*
failures. A partner engineer who asks "what if the object is still there but
wrong?" needs to hear "different mechanism, different scenario," not silence.

**Tier constraint:** Instant Access is Standard tier only and is not
supported on SecureVault Archive. That's a separate, harder constraint from
the RDS Archive/48-hour-thaw note above — the two capabilities sit on
different tiers with different recovery shapes, so don't imply Instant
Access could ever apply to the RDS scenario or vice versa.

**Instant Access being read-only does not need — and must not get — a UI
banner.** This app has no order-placement or S3-write path in its own UI to
begin with, and the DynamoDB order data is completely unaffected by the S3
incident, so nothing is actually unavailable during the Instant Access phase.
A "temporarily unavailable" banner during that phase would be false *and*
would undercut the entire clip, which is that nothing visibly changes when
CloudFront fails over. (An earlier version of this app had exactly this
banner, gated on `DEGRADED_MODE`; it was removed once rendered and reviewed
against the actual failover mechanics — don't re-add it.)

## Conventions

- ES modules throughout, Node 20+.
- UK English in all user-facing copy and comments. Currency is GBP.
- The dashboard polls every four seconds. This is intentional — recovery appears
  on screen without anyone touching the browser, which is the shot worth having.
  Do not replace it with a manual refresh button.
- Missing S3 objects render as `404 — object not found` tiles, not as an error
  banner, when the app is reading direct presigned S3 URLs (`IMAGE_BASE_URL`
  unset). That is what a genuinely broken storefront looks like. When
  `IMAGE_BASE_URL` points at the CloudFront distribution, the app trusts it
  completely and does not check the bucket itself — see S3 failover design.

## Working preferences

Complete, working artefacts over partial drafts. Content needs to survive
scrutiny from a technically informed audience — this is being shown to partner
solutions engineers who will pick at exact figures. If a number cannot be
verified, leave it out rather than approximating it.
