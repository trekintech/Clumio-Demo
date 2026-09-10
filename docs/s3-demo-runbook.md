# S3 demo runbook — deletion vs corruption

Two distinct S3 failure modes, two distinct recovery paths. They must stay
separate on stage and in the app. Conflating them collapses the argument:
deletion is an *availability* problem (CloudFront routes around it
automatically), corruption is a *data* problem (nothing routes around wrong
content — you have to recover the actual bytes). See `CLAUDE.md` → "S3
failover design" for the narrative framing.

## Scenario 1 — deletion (availability)

```bash
npm run s3-delete-incident
```

Hard-deletes the menu artwork and settlement CSV for the three blast-radius
tenants (`alma-kitchen`, `brick-lane-grill`, `corner-pantry`). S3 responds
403 or 404 for those keys from then on.

- If the app is reading direct presigned S3 URLs (`IMAGE_BASE_URL` unset),
  the gallery shows the existing `404 — object not found` tiles. This is the
  local/no-CloudFront path — see "Local testing" below.
- If the app is reading through the CloudFront origin group, CloudFront's
  origin failover should mean the gallery keeps rendering normally, served
  from the Clumio Instant Access origin, with no visible change and no one
  touching anything. That's the clip.

**Recovery:** nothing to do in Clumio during the outage — Instant Access is
already serving reads. The actual recovery step is restoring the source
bucket's objects. Because the origin group routes every request to the
primary first, regardless of any prior failover, the app returns to the
primary automatically the moment those objects reappear — there is no
"switch back" step to perform or film.

## Scenario 2 — overwrite / corruption (data)

```bash
npm run s3-corrupt-incident
```

Overwrites every menu SVG for the same three tenants **in place** — same
key, new (visibly wrong) content. S3 keeps returning 200 for every one of
those keys.

- CloudFront origin failover does **not** fire. There is no 403/404 to
  trigger on — as far as CloudFront and the origin group are concerned,
  nothing is wrong.
- The gallery renders whatever comes back, which is the corrupted artwork,
  on both the direct-S3 path and the CloudFront path. This is intentional:
  it's the visual proof that failover doesn't help here.

**Recovery:** roll back the object to the version that existed before the
overwrite. This repo enables S3 bucket versioning at seed time
(`scripts/seed.js`) specifically so a previous version exists to restore.
The user framed this on-stage as **"Backtrack's version rollback"** — flag:
that phrasing has *not* been verified the way the DynamoDB Backtrack claim
in `CLAUDE.md` was (that one was checked against a specific Commvault blog
post). Confirm the correct product name for S3 object-version recovery
before this goes on stage; don't assume "Backtrack" covers S3 just because
it covers DynamoDB.

## CloudFront origin group (built in the console, not in code)

This repo deliberately does not create the distribution or the origin
group — build it by hand in the CloudFront console:

- **Origin 1 (primary):** the source S3 bucket (`KERBSIDE_BUCKET`).
- **Origin 2 (secondary):** the Clumio Instant Access endpoint for that
  bucket's protected copy.
- **Origin group failover criteria: 403 *and* 404, both.** Not just one —
  a delete can surface as either depending on bucket policy and whether the
  caller can even list the key, so the origin group has to treat both as
  failover triggers or some deletes won't fail over.
- Failover is one-directional per request, not a sticky switch: CloudFront
  tries the primary on every request regardless of what happened on the
  previous one. That's what makes recovery automatic — there is no manual
  "point back at primary" step once the source bucket is restored.

## Cache TTL warning

CloudFront caches successful responses at the edge. If an object was
fetched and cached *before* you run the deletion script, the cached copy
keeps being served straight from the edge, unchanged, until its TTL
expires — deletion produces **no visible effect** until then, and it will
look like the demo did nothing.

For the demo: set a short TTL on the menu-asset path (or invalidate the
affected paths explicitly) before running `npm run s3-delete-incident`, so
the next request actually reaches the origin group and you get to show the
failover instead of a stale cache hit.

## Tier constraint

Instant Access is available on **Standard tier only**. It is not supported
on SecureVault **Archive**. The RDS granular-retrieval capability in this
repo uses Archive and its ~48 hour thaw window (see `CLAUDE.md` → Accuracy
notes) — that's a separate tier with a separate recovery shape, which is
why RDS cannot use this failover pattern and is told as an audit/compliance
story instead of a fast-recovery one.

## Local testing without CloudFront

Leave `IMAGE_BASE_URL` unset. The server falls back to presigned S3 URLs
read directly from the bucket, checks object existence itself, and the app
renders the existing 404 tiles for anything missing. This lets you rehearse
both incident scripts and watch `assetsMissing` change in the dashboard
without the distribution existing yet.

Once the origin group is live in the console, point the app at it:

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

In this mode the server does not check the source bucket at all — it trusts
CloudFront completely, `assetsMissing` always reads 0, and there is no
custom 404 tile. A genuine failure (both origins down) would show up as the
browser's own broken-image icon, which is the honest signal in this mode —
dressing it up would misrepresent what CloudFront is actually doing.

## Filming the Instant Access phase

There is deliberately no "degraded" or read-only indicator in the app for
this phase. Instant Access being read-only is a property of the backup copy
CloudFront is failing over to, not of this app: DynamoDB (where order data
lives) is untouched by the S3 incident, and the app has no S3-write path in
its own UI to begin with. What you're actually filming is the dashboard
looking completely normal — menu images, order counts, the health banner —
while the deletion has already happened behind it. The absence of any
visible change *is* the shot; narrate that live rather than adding UI to
announce it.
