# S3 demo runbook: deletion vs corruption

Two failure modes, two recovery paths, and they must not be muddled on
stage. Deletion is an availability problem and CloudFront routes around it
on its own. Corruption is a data problem and nothing routes around wrong
content, because the bytes themselves are wrong. See `CLAUDE.md` → "S3
failover design" for the framing.

## What's in the bucket

Three kinds of object, and the difference between them drives the whole
demo:

- `menu/<slug>/menu.json` is the published menu document the storefront
  renders from. The menu is not in DynamoDB. Lose this and the restaurant
  can't show a menu, so it can't take orders.
- `menu/<slug>/<item>.svg` is artwork. A missing or wrong image looks bad,
  but the restaurant keeps trading.
- `settlement/<slug>/latest.csv` is a finance export and isn't on the
  critical path.

So deleting the menu document is an outage and corrupting an image isn't.
That asymmetry is the reason there are two scenarios.

## Build the origin group first

This repo doesn't create the distribution or the origin group. Build it by
hand in the CloudFront console before you film:

- **Primary origin:** the source S3 bucket (`KERBSIDE_BUCKET`).
- **Secondary origin:** the Clumio Instant Access endpoint for that bucket's
  protected copy.
- **Failover criteria: 403 and 404, both.** Not one or the other. A delete
  can surface as either, depending on bucket policy and whether the caller
  can even list the key, so if you only tick one some deletions won't fail
  over and the demo will look broken.

Failover isn't a sticky switch. CloudFront tries the primary on every
request regardless of what happened last time, which is what makes the
recovery automatic. Once the source objects are back, the app goes back to
the primary with no manual step to perform or film.

Then point the app at it and restart:

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

On Windows PowerShell:

```powershell
$env:IMAGE_BASE_URL = "https://<distribution-id>.cloudfront.net"
npm start
```

With that set, the server stops checking the source bucket and trusts
CloudFront completely. If both origins were genuinely down you'd get the
browser's own broken-image icon, which is the honest signal. Dressing that
up would misrepresent what CloudFront is doing.

## Watch the cache

CloudFront caches successful responses at the edge. If an object was fetched
and cached before you run the deletion script, the edge keeps serving the
cached copy until the TTL expires. The deletion will appear to do nothing
and the demo will fall flat.

Set a short TTL on the menu path, or invalidate the affected paths
explicitly, before running the deletion. You want the next request to
actually reach the origin group.

## Scenario 1: deletion

```bash
npm run s3-delete-incident
```

Deletes everything under `menu/<slug>/`, including `menu.json`, plus the
settlement CSV, for the three blast-radius tenants (`alma-kitchen`,
`brick-lane-grill`, `corner-pantry`). S3 returns 403 or 404 for those keys
from then on.

Read straight from S3, with `IMAGE_BASE_URL` unset, those three restaurants
go down. The dashboard says "Storefront down — menu unavailable" and spells
out that they can't take orders. Read through the origin group, Instant
Access serves the menu document instead, and nothing visibly happens at all.

Film it both ways. Three restaurants going dark is the "before". The same
command doing nothing is the "after".

**Recovery.** There's nothing to do in Clumio while the outage is running,
because Instant Access is already serving reads. The actual recovery is
restoring the source objects, and the app returns to the primary on its own
once they're back.

## Scenario 2: overwrite

```bash
npm run s3-corrupt-incident
```

Overwrites the menu images in place, same keys, visibly wrong content. It
leaves `menu.json` alone on purpose, so the restaurants stay up and keep
trading. S3 returns 200 for every key.

Failover doesn't fire, because there's no error code to fire on. As far as
CloudFront is concerned nothing is wrong. The gallery renders whatever comes
back, on both the direct path and through CloudFront, which is the visual
proof that failover doesn't help here.

Worth saying out loud: the dashboard still reports these tenants healthy.
Green banner, assets all present, while the customer is looking at garbage.
Every error-code-based check passes. That's precisely why an availability
mechanism can't catch a data problem.

**Recovery.** Roll the object back to the version from before the overwrite.
The seed switches on bucket versioning so that version exists.

One caveat before you narrate this: calling it "Backtrack's version
rollback" hasn't been checked against documentation. The DynamoDB Backtrack
claim in `CLAUDE.md` was verified against a specific Commvault blog post,
but that verification doesn't carry over to S3. Confirm the correct product
name for S3 object-version recovery before you say it on stage.

## Tier constraint

Instant Access is Standard tier only. It isn't supported on SecureVault
Archive.

That matters for the wider narrative, because the RDS capability in the
three-part story depends on Archive and its thaw window, which is why it's
told as an audit and compliance story rather than a fast-recovery one. The
two sit on different tiers with different recovery shapes, so don't imply
Instant Access could apply to the RDS scenario. (Note there's no RDS code in
this repo yet.)

## Rehearsing without CloudFront

Leave `IMAGE_BASE_URL` unset. The server reads from the bucket directly and
presigns image URLs itself, so you can run both incident scripts and watch
the dashboard react without the distribution existing.

This is genuinely useful, not just a fallback. It's how you film the "before"
half of scenario 1.

## Filming the Instant Access phase

There's no "degraded" or read-only indicator in the app for this phase, by
design. Instant Access being read-only is a property of the backup copy
CloudFront fails over to, not of this application. Order data lives in
DynamoDB and the S3 incident doesn't touch it, and the app has no S3 write
path in its UI anyway.

What you're filming is a dashboard that looks entirely normal while the
deletion has already happened behind it. The absence of any visible change
is the shot. Narrate that rather than adding UI to announce it.
