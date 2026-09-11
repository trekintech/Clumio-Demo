# Kerbside ops — Clumio demo environment

A plain-looking multi-tenant ordering platform, used to show DynamoDB and S3
recovery on stage. It runs locally against real AWS services, so the app's
reaction and the Clumio console footage are both genuine.

**Nothing here is branded.** This is meant to look like the customer's own
application, not a product demo.

## Prerequisites

- Node 20 or later
- An AWS sandbox account you don't mind corrupting data in
- AWS CLI, with working credentials
- A Clumio tenant connected to that account

The profile needs:

| Service | Actions |
|---|---|
| DynamoDB | `CreateTable`, `DescribeTable`, `UpdateContinuousBackups`, `BatchWriteItem`, `Query` |
| S3 | `CreateBucket`, `HeadBucket`, `PutBucketVersioning`, `PutObject`, `GetObject`, `ListBucket`, `DeleteObject` |
| STS | `GetCallerIdentity` |

No credentials are read from or written to this repo. The clients are built
with a region and nothing else, so they use the standard AWS SDK credential
chain. An existing role is fine: an assume-role profile, SSO, exported
environment variables, or an instance role all work. `npm run setup` prints
the resolved ARN so you can check you're on the one you meant to use.

If you're using temporary credentials, prefer a profile that lets the SDK
refresh them itself (`role_arn` with `source_profile`, or an SSO profile)
over pasting short-lived `AWS_SESSION_TOKEN` values into your shell. Pasted
session credentials don't refresh, and they expire mid-demo without warning.

## Run it end to end

### 1. Configure

```bash
export AWS_PROFILE=kerbside-demo
export AWS_REGION=eu-west-2
export KERBSIDE_BUCKET=kerbside-demo-assets-<something-unique>
npm run setup
```

Bucket names are globally unique, so pick your own. `npm run setup` installs
dependencies and checks the things that tend to bite during a live session:
Node version, AWS CLI present, credentials actually resolving, and that you
changed the bucket name off the default. It fails loudly with the fix rather
than letting you find out halfway through seeding. It doesn't touch AWS, so
re-run it as often as you like.

### 2. Rehearse with a small estate

Don't make your first run the 314,000-item one.

```bash
SYNTHETIC_TENANT_COUNT=50 npm run seed
SYNTHETIC_TENANT_COUNT=50 npm start
```

Open http://localhost:5173 and click about. Set the same tenant count for
both commands, or the sidebar and the table won't agree.

### 3. Seed the real estate

```bash
npm run seed
npm start
```

This creates the table and bucket if they're missing, then loads two tiers of
tenant:

- 8 named tenants with 150 orders each, a published menu document, artwork
  and a settlement CSV. These are the only ones that appear on camera.
- 4,119 filler tenants with a name and orders only. They exist so the sidebar
  reads as a real estate rather than eight rows. See `CLAUDE.md` → Scale.

It also switches on DynamoDB point-in-time recovery, so you have the native
comparison ready if someone challenges you from the floor, and S3 bucket
versioning, which the corruption scenario needs.

Budget a few minutes. Progress is logged as it goes.

### 4. Take a Clumio backup

Do this before breaking anything. Nothing below is recoverable otherwise.

### 5. Run the DynamoDB scenario

```bash
npm run bad-deploy
```

Corrupts about 95% of orders across three tenant partitions and nothing else:
`TENANT#alma-kitchen`, `TENANT#brick-lane-grill`, `TENANT#corner-pantry`.
Totals go to zero or to something absurd, and modifiers are stripped.

It writes `incident.json` with the timestamp to restore before and the
partition keys to target. Read your Backtrack values from that file rather
than from memory. Getting them exactly right is what makes this convincing.

Recover with Backtrack, then:

```bash
npm run verify
```

You get a row per named tenant: order count, corrupt count, image count,
whether the tenant can still trade, and its overall state. After a clean
recovery everything reads healthy. If anything outside the three targets is
damaged, it says so, which is the check you want behind you before you walk
on stage.

### 6. Run the S3 scenario

Full procedure, CloudFront console steps and the cache-TTL warning are in
`docs/s3-demo-runbook.md`. Read that before filming.

The short version: the storefront renders its menu from a document published
to S3 at `menu/<slug>/menu.json`. The menu is not in DynamoDB. Lose that
object and the restaurant can't show a menu, so it can't take orders.

```bash
npm run s3-delete-incident    # deletes objects. Restaurants go dark.
npm run s3-corrupt-incident   # overwrites images. Restaurants stay up, looking wrong.
```

`s3-delete-incident` removes everything under `menu/<slug>/` plus the
settlement exports for the same three tenants. Read straight from S3, those
three go down and the dashboard says so. Put the CloudFront origin group in
front, with Clumio Instant Access as the secondary origin, and the same
deletion does nothing visible at all. Worth filming both ways round.

To point the app at CloudFront, set the distribution domain and restart:

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

`s3-corrupt-incident` overwrites the menu images in place and leaves
`menu.json` alone, so the restaurants keep trading while the artwork turns to
garbage. S3 still returns 200, so CloudFront failover never fires and the
dashboard still reports everything healthy. That gap between "all checks
green" and "the customer is looking at nonsense" is the point of the
scenario. Recovery here is the previous object version, not Instant Access.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AWS_REGION` | `eu-west-2` | Region for both services |
| `KERBSIDE_TABLE` | `kerbside-app` | DynamoDB table name |
| `KERBSIDE_BUCKET` | `kerbside-demo-assets` | S3 bucket name |
| `ORDERS_PER_TENANT` | `150` | Orders per named tenant at seed time |
| `SYNTHETIC_TENANT_COUNT` | `4119` | Filler tenants on top of the 8 named ones |
| `SYNTHETIC_ORDERS_PER_TENANT` | `75` | Orders per filler tenant |
| `SEED_CONCURRENCY` | `24` | Concurrent batched writes while seeding |
| `PORT` | `5173` | Local web server port |
| `IMAGE_BASE_URL` | unset | CloudFront domain for the menu document and artwork. Unset reads from S3 directly. |

Tenants, menus and the blast radius live in `config.js`.

## Recording

The dashboard polls every four seconds, so recovery turns up on screen
without you touching the browser. Talk over the app and let the data come
back on its own.

A reasonable capture order:

1. Healthy dashboard, sidebar open so the size of the estate is obvious
2. Run the incident script off camera
3. Broken dashboard. Hold on it. Let it sit longer than feels comfortable.
4. Clumio console: target the partition keys, set the timestamp
5. Back to the dashboard, let the poll bring it round
6. Terminal, running `npm run verify`

Record with system audio muted and narrate live. Piping laptop audio into a
venue PA is a risk you don't need.

## When something goes wrong

The dashboard never shows a raw stack trace. AWS failures are caught and
rendered as a named panel with the fix, so if something breaks while you're
on a projector it still looks like a working application.

It recognises missing or expired credentials, table not found, bucket not
found, access denied, DynamoDB throttling, and the local server dying. Each
one names the variable or command that sorts it. Anything unrecognised falls
back to a generic panel and points you at the terminal.

The heartbeat top right shows how fresh the data is: green when live, amber
past ten seconds, red past twenty. If AWS stops answering mid-recording,
you'll spot it before the audience does.

## Reset

```bash
npm run seed      # re-seeds over the top and restores a clean state
```

To remove the table and bucket entirely, delete them from the console. There
is no teardown script here on purpose.

## Known caveats

- `verify.js` decides an order is corrupt using the same rule as the
  dashboard. Change pricing logic in `config.js` and you must change
  `validation.js` too, or the terminal and the screen will contradict each
  other.
- PITR adds cost for as long as it's on. Turn it off after the event.
- Bucket versioning keeps old copies of overwritten objects until you clear
  them out.
- Menu artwork is generated SVG, hand-drawn per dish, not photography. See
  `DISH_ICONS` in `scripts/seed.js`. It holds up at 1080p, but swap in real
  photography if you want the gallery to look richer.
