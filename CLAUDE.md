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
- `scripts/seed.js` — creates table and bucket, loads tenants, enables PITR.
- `scripts/bad-deploy.js` — corrupts three tenant partitions and writes
  `incident.json` with the exact timestamp and partition keys to feed into
  Backtrack.
- `scripts/s3-incident.js` — deletes menu and settlement objects for the same
  three tenants.
- `scripts/verify.js` — per-tenant audit proving tenants outside the blast
  radius were untouched. This output gets filmed.

The blast radius is three tenants out of eight, defined in `config.js`. The
point of the whole demo is that recovery is *scoped*, so never widen it to all
tenants.

## Conventions

- ES modules throughout, Node 20+.
- UK English in all user-facing copy and comments. Currency is GBP.
- The dashboard polls every four seconds. This is intentional — recovery appears
  on screen without anyone touching the browser, which is the shot worth having.
  Do not replace it with a manual refresh button.
- Missing S3 objects render as `404 — object not found` tiles, not as an error
  banner. That is what a genuinely broken storefront looks like.

## Working preferences

Complete, working artefacts over partial drafts. Content needs to survive
scrutiny from a technically informed audience — this is being shown to partner
solutions engineers who will pick at exact figures. If a number cannot be
verified, leave it out rather than approximating it.
