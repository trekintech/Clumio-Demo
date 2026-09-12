# Building the CloudFront origin group

A one-off job in the CloudFront console, done once before you film the S3
clip. The demo itself is in the [README](../README.md); this only covers
building the infrastructure it needs.

Nothing in this repo creates the distribution. That's deliberate, the same way
the Clumio configuration isn't in code either.

## What you're building

CloudFront in front of the S3 bucket, with two origins:

- **Primary:** the source S3 bucket (`KERBSIDE_BUCKET`).
- **Secondary:** the Clumio Instant Access endpoint for that bucket's
  protected copy.

Group them into an **origin group** and set the failover criteria to **403 and
404, both**. Not one or the other. A deleted object can surface as either,
depending on bucket policy and whether the caller can list the key, so ticking
only one means some deletions won't fail over and the demo will look broken.

Failover is not a sticky switch. CloudFront tries the primary on every
request, whatever happened last time. That's what makes the recovery
automatic: once the source objects are back, the app returns to the primary
with nothing to flip.

## Point the app at it

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

```powershell
$env:IMAGE_BASE_URL = "https://<distribution-id>.cloudfront.net"
npm start
```

With that set, the server stops checking the source bucket and trusts
CloudFront. If both origins were genuinely down you'd get the browser's own
broken-image icon, which is the honest signal. Dressing that up would
misrepresent what CloudFront is doing.

Leave `IMAGE_BASE_URL` unset to read straight from S3. That's how you film the
"before" half, where the same deletion takes three restaurants down.

## Watch the cache

This is the one that ruins takes.

CloudFront caches successful responses at the edge. If an object was fetched
and cached before you run the deletion, the edge keeps serving the cached copy
until the TTL expires. The deletion appears to do nothing and the demo falls
flat.

Set a short TTL on the menu path, or invalidate the affected paths, before
running the deletion. You want the next request to actually reach the origin
group.

## What's in the bucket

Three kinds of object, and the differences drive the two scenarios:

- `menu/<slug>/menu.json` is the published menu document the storefront
  renders from. The menu is not in DynamoDB. Lose this and the restaurant
  can't show a menu, so it can't take orders.
- `menu/<slug>/<item>.svg` is artwork. A wrong or missing image looks bad, but
  the restaurant keeps trading.
- `settlement/<slug>/latest.csv` is a finance export, off the critical path.

So deleting the menu document is an outage and corrupting an image isn't. That
asymmetry is why there are two scenarios rather than one.

## Tier constraint

Instant Access is Standard tier only. It is not supported on SecureVault
Archive.

That matters for the wider three-part story, because the RDS capability
depends on Archive and its thaw window, which is why it's told as an audit and
compliance story rather than a fast-recovery one. Different tiers, different
recovery shapes. Don't imply Instant Access could apply to the RDS scenario.
(There's no RDS code in this repo.)

## Before you narrate the overwrite scenario

Recovering an overwritten object means rolling it back to its previous
version, which the seed enables bucket versioning for.

Calling that "Backtrack's version rollback" has not been checked against
documentation. The DynamoDB Backtrack claim in `CLAUDE.md` was verified
against a specific Commvault blog post, but that verification doesn't carry
over to S3. Confirm the correct product name for S3 object-version recovery
before you say it on stage.
