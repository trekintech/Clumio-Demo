# CloudFront for the S3 scenario

## What's automated and what isn't

Nothing in this repo touches CloudFront. No script creates, modifies or
deletes a distribution, and the demo role needs no CloudFront permissions.

| Thing | Who does it |
|---|---|
| DynamoDB table, PITR | `npm run seed` |
| S3 bucket, versioning | `npm run setup` and `npm run seed` |
| CloudFront distribution | you, in the console |
| Origin group and failover criteria | you, in the console |
| Clumio backup and Instant Access | you, in Clumio |
| `IMAGE_BASE_URL` | you, once the distribution exists |

The reason the CloudFront half is manual: the secondary origin is a Clumio
Instant Access access point, which doesn't exist until you've taken a backup
and requested Instant Access on it. There's nothing to point at when setup
runs.

## The shape of the demo

Instant Access gives you a read-only view of the backup at a point in time.
It's a recovery and audit tool, not a permanent second origin. You stand it up
to keep serving while the source is restored, then take it down afterwards.
That shapes the whole scenario.

So the distribution starts with **one origin**, the source bucket. The deletion
is then a genuine outage, and standing up Instant Access as a second origin is
the recovery. The storefront serves from the backup copy while the real restore
runs behind it, then drains back to the source.

That's also the honest claim to make on stage: *recover availability in minutes
by serving from your backup, before restoring a single object.* Not "automatic
failover with no human intervention", which would need the group to already
exist and a permanent secondary origin nobody would actually run.

CloudFront changes take a few minutes to deploy. That's fine here because the
footage is recorded and narrated live, so the wait gets cut.

## Build it

### Before the incident

A distribution with one origin: the source S3 bucket, locked down with Origin
Access Control. The cache behaviour points straight at that origin. No origin
group yet.

Then point the app at it and restart:

**macOS / Linux**

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

**Windows PowerShell**

```powershell
$env:IMAGE_BASE_URL = "https://<distribution-id>.cloudfront.net"
npm start
```

With that set the server stops checking the source bucket and trusts
CloudFront entirely.

### The incident

```
npm run s3-delete-incident
```

S3 returns 403 or 404 for those keys, CloudFront has nothing to fall back to,
and the three blast-radius restaurants go dark. The dashboard says the menu is
unreachable and that they can't take orders.

### The recovery

In Clumio, request Instant Access for the backup. It gives you a read-only S3
access point.

In CloudFront: add that access point as a second origin, again with OAC.
Create an origin group with the source bucket as primary and the access point
as secondary. Set the failover criteria to **403 and 404, both**. Repoint the
cache behaviour at the origin group.

Once it deploys, the restaurants are trading again, served from the backup
copy, with nothing restored yet.

**Both error codes matter.** A deleted object can surface as either, depending
on bucket policy and whether the caller can list the key. Tick only one and
some deletions won't fail over, which looks like the demo is broken with no
clue why.

### Why there's no cutover

CloudFront tries the primary on every request, regardless of what happened on
the previous one. So when you restore the source objects, requests start being
served from primary again the moment each object is back. Failover traffic
drains to zero on its own as the restore progresses.

There's no switch to flip, no moment where you decide it's safe to go back, and
no window where the two origins disagree about which is authoritative. That's
the part to draw out on stage. The transition manages itself.

Once the restore is complete and nothing is reaching the secondary any more,
repoint the behaviour at the bucket origin and release the Instant Access
point. It's a point-in-time copy provisioned for the recovery window, not
something you leave wired in.

In a real deployment, writes continue straight to the source bucket throughout,
because CloudFront is only in the read path. The business keeps trading while
the restore runs. (This demo app has no S3 write path of its own, so that's an
architectural point rather than something on screen.)

## Turn caching off for the demo

CloudFront caches successful responses at the edge. If an object was cached
before you run the deletion, the edge keeps serving it and the deletion appears
to do nothing. This is the most common way the take is wasted.

Fix it once, on the behaviour, rather than invalidating before every run:

**Behaviors → edit → Cache policy → `CachingDisabled`** (a managed policy: min,
default and max TTL all zero).

Every request then goes to the origin, so a deletion shows up immediately and
repeatedly. You lose edge caching, which costs nothing with one viewer, and it
makes the drain back to primary cleaner to demonstrate because every request
genuinely re-tries the primary. Failover is unaffected either way: the origin
group has nothing to do with caching.

If you'd rather keep some caching, build a custom policy with min 0, default 0,
max 1.

The seed also writes `Cache-Control: no-cache, max-age=0` onto the menu objects,
which CloudFront honours within the cache policy's TTL bounds. That's a second
line of defence rather than a substitute, because a cache policy with a
non-zero **minimum** TTL overrides it. Use `MENU_CACHE_CONTROL` if you
deliberately want to demonstrate edge caching.

To clear something already cached, invalidate `/menu/*` in the Invalidations
tab.

## A deleted object returns 403, not 404

Worth knowing before you set the failover criteria. With OAC, CloudFront's
principal normally holds `s3:GetObject` and not `s3:ListBucket`. S3 won't
confirm whether an object ever existed to a caller that can't list the bucket,
so it answers **403 Forbidden** for a deleted object rather than 404.

So in practice deletions arrive as 403. If the origin group only fails over on
404, nothing happens and there's no clue why. That's why both codes are
required.

You can check what the edge is actually seeing:

```
curl -sI https://<distribution-id>.cloudfront.net/menu/alma-kitchen/menu.json
```

`X-Cache: Error from cloudfront` with a 403 means CloudFront reached S3 and S3
denied it, which is the deletion working. `X-Cache: Hit from cloudfront` means
you're looking at a cached copy and the deletion is being masked.

## Getting the "before" shot without CloudFront

Leave `IMAGE_BASE_URL` unset and the app reads S3 directly. The same deletion
takes the restaurants down immediately, with no distribution involved and no
propagation wait. Useful for rehearsing, and for filming the outage on its own.

## What's in the bucket

Three kinds of object, and the differences drive the two scenarios:

- `menu/<slug>/menu.json` is the published menu document the storefront
  renders from. The menu is not in DynamoDB. Lose this and the restaurant
  can't show a menu, so it can't take orders.
- `menu/<slug>/<item>.svg` is artwork. A wrong or missing image looks bad, but
  the restaurant keeps trading.
- `settlement/<slug>/latest.csv` is a finance export, off the critical path.

So deleting the menu document is an outage and corrupting an image isn't.

## The overwrite scenario doesn't use any of this

`npm run s3-corrupt-incident` overwrites images in place. S3 still returns 200,
so failover never fires. There's no error code to trigger on, and the origin
group is irrelevant. Recovery is Backtrack, rolling the object back to its
previous version, which is why the seed enables bucket versioning.

Keep that separate in the narration. Deletion is an availability problem that
CloudFront routes around. Corruption is a data problem that nothing routes
around, because the bytes themselves are wrong.

## Tier constraint

Instant Access is Standard tier only. It isn't supported on SecureVault
Archive.

That matters for the wider three-part story, because the RDS capability sits on
Archive, which is why it's told as an audit and compliance story rather than a
fast-recovery one. Don't imply Instant Access could apply to the RDS scenario.
That one is in
[docs/rds-audit-scenario.md](rds-audit-scenario.md).

