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

## Two ways to run this, and the claim each supports

Decide which before you build anything, because they need different setups and
they support different statements on stage.

**A. Group pre-built.** Both origins configured before the incident. You
delete the objects and nothing visibly happens. Supports: *"automatic
failover, no human intervention."* The catch is that the visible outcome is
nothing at all, and Clumio's part is invisible.

**B. Group added as the recovery step.** Start with a single S3 origin. The
deletion takes the restaurants down for real. You then add the Clumio origin
and create the group, and they come back. Supports: *"recover availability in
minutes by serving from your backup, before restoring a single object."*

B shows the mechanism and makes Clumio visibly do something, which is usually
the better fit for a partner audience. The rest of this document assumes B.

Whichever you pick, narrate the claim you're actually demonstrating. If you
build the group live, it isn't automatic failover, and someone will notice you
clicked.

CloudFront changes take a few minutes to deploy. That's fine here because the
footage is recorded and narrated live, so the wait gets cut.

## Build it

### Before the incident

A distribution with one origin: the source S3 bucket, locked down with Origin
Access Control. The cache behaviour points straight at that origin. No origin
group yet.

Then point the app at it and restart:

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

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
unreachable and that they cannot take orders.

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

There is no switch to flip, no moment where you decide it's safe to go back,
and no window where the two origins disagree about which is authoritative.
That is the part worth drawing out on stage: the transition manages itself.

In a real deployment, writes continue straight to the source bucket throughout,
because CloudFront is only in the read path. The business keeps trading while
the restore runs. (This demo app has no S3 write path of its own, so that's an
architectural point rather than something on screen.)

## Watch the cache

This is the one that ruins takes.

CloudFront caches successful responses at the edge. If an object was fetched
and cached before you run the deletion, the edge keeps serving the cached copy
until the TTL expires. The deletion appears to do nothing.

Set a short TTL on the menu path, or invalidate the affected paths, before
running the deletion.

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
group is irrelevant. Recovery is rolling the object back to its previous
version, which is why the seed enables bucket versioning.

Keep that separate in the narration. Deletion is an availability problem that
CloudFront routes around. Corruption is a data problem that nothing routes
around, because the bytes themselves are wrong.

## Tier constraint

Instant Access is Standard tier only. It is not supported on SecureVault
Archive.

That matters for the wider three-part story, because the RDS capability depends
on Archive and its thaw window, which is why it's told as an audit and
compliance story rather than a fast-recovery one. Don't imply Instant Access
could apply to the RDS scenario. (There's no RDS code in this repo.)

## Still unverified

Calling the S3 version rollback "Backtrack" hasn't been checked against
documentation. The DynamoDB Backtrack claim in `CLAUDE.md` was verified against
a specific Commvault blog post; that doesn't carry over to S3. Confirm the
correct product name before you say it on stage.
