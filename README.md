# Kerbside ops

A multi-tenant food ordering platform, used as the backdrop for a live demo of
Clumio recovery on DynamoDB and S3. It runs on your laptop but reads real AWS
services, so what happens on screen is genuine rather than staged.

The app carries no Commvault or Clumio branding. It is meant to look like the
customer's application, because the moment it looks like a vendor demo the
audience stops believing it.

## Quick start

```
git clone https://github.com/trekintech/Clumio-Demo.git
cd Clumio-Demo
npm run setup
npm run seed
npm start
```

Then open http://localhost:5173.

`npm run setup` installs dependencies, checks your AWS credentials, picks and
creates an S3 bucket, and verifies the role can do what the demo needs. It
makes its own decisions and tells you what it chose, so it won't sit waiting
on a prompt.

Run every command from the repo root, the folder with `package.json` in it.

## What you need

- Node 20 or later
- An AWS sandbox account you don't mind corrupting data in
- AWS credentials that resolve: any profile, SSO session, assume-role setup,
  environment variables or instance role
- A Clumio tenant connected to that account

The AWS CLI is optional. Everything here reaches AWS through the SDK, which
reads your profiles and SSO sessions itself. You only need the CLI if you want
setup to create a new SSO login or key pair for you.

On Windows there's a script that checks for Node, git and the AWS CLI, and
prints the winget command for anything missing:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Add `-Install` to let it install them. Open a new terminal afterwards or the
new tools won't be on `PATH`.

If you downloaded a ZIP rather than cloning, your folder will be called
`Clumio-Demo-main` and it never updates. Scripts added after you downloaded
won't exist, which usually shows up as "the file does not exist" or
`ERR_MODULE_NOT_FOUND`. Clone instead.

## Running the demo

### Rehearse on a small estate first

Don't let the first run be the 314,000-item one.

```bash
SYNTHETIC_TENANT_COUNT=50 npm run seed
SYNTHETIC_TENANT_COUNT=50 npm start
```

```powershell
$env:SYNTHETIC_TENANT_COUNT = "50"
npm run seed
npm start
```

Use the same count for both commands or the sidebar and the table disagree. On
PowerShell the variable sticks for the rest of the session, so clear it with
`Remove-Item Env:SYNTHETIC_TENANT_COUNT` before seeding properly.

### Seed the full estate

```
npm run seed
```

Creates the table and bucket if they're missing, then loads:

- 8 named tenants with 150 orders each, a published menu document, artwork and
  a settlement CSV. These are the only ones that appear on camera.
- 4,119 filler tenants with a name and orders only, so the sidebar reads as a
  real estate rather than eight rows.

It also enables point-in-time recovery on the table, which gives you the
native comparison if someone challenges you from the floor, and bucket
versioning, which the overwrite scenario needs.

Budget a few minutes. It logs a line per named tenant, then a percentage
roughly every 10% of the filler batches.

DynamoDB returns transient 500s under sustained write load, so batches retry
with backoff. If a seed still dies part way, just run it again. Every write
overwrites by key, so nothing duplicates. If it keeps failing at the same
point, slow it down with `SEED_CONCURRENCY=8`.

### Take a Clumio backup

Do this before you break anything. Nothing below is recoverable otherwise.

### Scenario 1: DynamoDB corruption

The lead story, and the strongest clip.

```
npm run bad-deploy
```

Corrupts about 95% of orders across three tenant partitions and nothing else:
`TENANT#alma-kitchen`, `TENANT#brick-lane-grill`, `TENANT#corner-pantry`.
Totals go to zero or to something absurd, and modifiers are stripped. Within
four seconds the dashboard turns red on those three tenants without you
touching the browser. The other five stay green.

It writes `incident.json` with the timestamp to restore before and the exact
partition keys. Read your Backtrack values out of that file rather than from
memory.

Recover with Backtrack, then:

```
npm run verify
```

That prints a row per named tenant: orders, corrupt count, images, whether the
tenant can still trade, and overall state. After a clean recovery everything
reads healthy. If anything outside the three targets is damaged it says so,
which is the check you want behind you before you stand up.

### Scenario 2: S3 deletion, an availability problem

The storefront renders its menu from a document published to S3 at
`menu/<slug>/menu.json`. The menu is not in DynamoDB. Lose that object and the
restaurant cannot show a menu, so it cannot take orders.

```
npm run s3-delete-incident
```

Deletes everything under `menu/<slug>/` plus the settlement exports for the
same three tenants. S3 returns 403 or 404 for those keys from then on.

What you see depends on whether CloudFront is in front:

- Reading straight from S3, those three restaurants go down. The dashboard
  says "Storefront down — menu unavailable" and states they cannot take
  orders. Historical orders still show, so the loss is future revenue.
- Reading through a CloudFront origin group with Clumio Instant Access as the
  secondary origin, failover serves the menu document from the backup copy and
  nothing visibly happens at all.

Film it both ways. Three restaurants going dark is the before; the same
command doing nothing is the after.

To point the app at CloudFront, set the distribution domain and restart:

```bash
export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net
npm start
```

```powershell
$env:IMAGE_BASE_URL = "https://<distribution-id>.cloudfront.net"
npm start
```

Building the origin group is a one-off job in the CloudFront console. The
steps, including the failover criteria and the cache setting that will
otherwise make this look like nothing happened, are in
[docs/cloudfront-setup.md](docs/cloudfront-setup.md).

Recovery is restoring the source objects. CloudFront tries the primary origin
on every request, so the app goes back to it on its own with no switch to
flip.

### Scenario 3: S3 overwrite, a data problem

```
npm run s3-corrupt-incident
```

Overwrites the menu images in place for the same three tenants. Same keys, new
and visibly wrong content. It leaves `menu.json` alone, so the restaurants
stay up and keep trading.

S3 returns 200 for every one of those keys, so CloudFront failover never
fires. There is no error code to fire on. The gallery renders whatever comes
back, on both the direct and CloudFront paths, which is the visual proof that
failover doesn't help here.

Worth saying out loud on stage: the dashboard still reports these tenants
healthy. Green banner, assets all present, while the customer is looking at
garbage. Every error-code-based check passes. That is exactly why an
availability mechanism cannot fix a data problem.

Recovery is rolling the object back to its previous version, not Instant
Access.

Keep scenarios 2 and 3 separate in the narration. Deletion is an availability
problem that CloudFront routes around. Corruption is a data problem that
nothing routes around, because the bytes themselves are wrong. Blur the two
and the argument collapses.

## Recording

The dashboard polls every four seconds, so recovery appears on screen without
you touching the browser. Talk over the app and let the data come back on its
own.

A capture order that works:

1. Healthy dashboard, sidebar open so the size of the estate is obvious
2. Run the incident script off camera
3. Broken dashboard. Hold on it. Let it sit longer than feels comfortable.
4. Clumio console: set the timestamp, target the partition keys
5. Back to the dashboard, let the poll bring it round
6. Terminal, running `npm run verify`

Record with system audio muted and narrate live. Piping laptop audio into a
venue PA is a risk you don't need.

You'll want two terminals: one running `npm start`, which holds that window
until you stop it, and another for the incident and verify commands.

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

Setup writes the bucket name, region and profile to `.kerbside-local.json`,
which is git-ignored and holds no secrets. Every script reads it, so a new
terminal already knows your settings without you exporting anything.
Environment variables still take precedence.

Tenants, menus and the blast radius live in `config.js`.

## AWS credentials

`npm run setup` handles this. What follows is for doing it by hand, or working
out why setup couldn't.

If you already have a working profile, use it. Nothing here needs a dedicated
one.

```bash
export AWS_PROFILE=your-profile
npm run check-access
```

```powershell
$env:AWS_PROFILE = "your-profile"
npm run check-access
```

If you need to set access up from scratch, pick whichever matches your
account. IAM Identity Center:

```
aws configure sso
aws sso login --profile kerbside-demo
```

Assuming an existing role, via `~/.aws/config` (or
`%USERPROFILE%\.aws\config`):

```ini
[profile kerbside-demo]
role_arn       = arn:aws:iam::123456789012:role/YourExistingRole
source_profile = default
region         = eu-west-2
```

Or access keys, which work but are the least good option:

```
aws configure --profile kerbside-demo
```

If your credentials are temporary, use a profile the SDK can refresh itself
(`role_arn` with `source_profile`, or SSO) rather than pasting
`AWS_SESSION_TOKEN` values into your shell. Pasted session credentials don't
refresh and expire mid-demo without warning.

### Checking permissions

Credentials resolving is not the same as having permission. A role can
authenticate perfectly and still be unable to create a table.

```
npm run check-access
```

This probes each permission and maps any denial to the exact IAM action,
printing a policy you can paste in. Where the table or bucket already exists
it does a real write-and-delete round trip rather than inferring from policy.

| Service | Actions |
|---|---|
| DynamoDB | `CreateTable`, `DescribeTable`, `UpdateContinuousBackups`, `BatchWriteItem`, `Query` |
| S3 | `CreateBucket`, `HeadBucket`, `PutBucketVersioning`, `PutObject`, `GetObject`, `ListBucket`, `DeleteObject` |
| STS | `GetCallerIdentity` (only if you use the AWS CLI) |

Before the table and bucket exist, the create and write actions can't be
probed. `check-access` says so rather than implying a clean bill of health.

## Windows and shell notes

Environment variables are set differently, and the inline `FOO=bar command`
form doesn't exist in PowerShell:

| | bash / zsh | PowerShell |
|---|---|---|
| For the session | `export FOO=bar` | `$env:FOO = "bar"` |
| For one command | `FOO=bar npm run seed` | `$env:FOO = "bar"; npm run seed` |

`npm run something -- --flag` often drops the flag on PowerShell and forwards
only what follows it. Where a command takes options, call the script directly:

```
node scripts/check-access.js --read-only
node scripts/setup.js --interactive
```

`npm run teardown -- <bucket-name>` is unaffected, because it looks for the
bucket name rather than a flag.

## Troubleshooting

The dashboard never shows a stack trace. AWS failures are caught and rendered
as a named panel naming the fix, so if something breaks while you're on a
projector it still looks like a working application. It recognises missing or
expired credentials, table or bucket not found, access denied, throttling, and
the server dying.

The heartbeat in the top right shows how fresh the data is: green when live,
amber past ten seconds, red past twenty. If AWS stops answering mid-recording
you'll see it before the audience does.

**`Cannot GET /`** — you're on an old copy from before that was fixed, or an
older server process is still running and serving stale files. Stop it and
start again.

**`Port 5173 is already in use`** — an earlier `npm start` is still running.
It keeps serving the files it started with, so after pulling a change you can
be looking at the old version and think the fix didn't work.

```bash
lsof -ti tcp:5173 | xargs kill
```

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

That PowerShell line stops every Node process, which is the quick option. Or
leave it and use `PORT=5174 npm start`.

**`ERR_MODULE_NOT_FOUND`** — dependencies aren't installed. Run `npm run
setup`. If you see it from `npm run setup` itself, you're on an old copy;
`npm install` then try again.

**Orders never change on their own.** That's correct. Nothing generates
orders after seeding and the server only reads. The four-second poll exists so
that when you break or recover something, the dashboard reflects it unattended.

## Resetting and tearing down

Re-seeding is the quickest way back to a clean state between rehearsals. You
don't need to tear anything down to run the demo again.

```
npm run seed
```

To remove the AWS resources:

```
npm run teardown
```

That shows what exists and deletes nothing. To actually delete, pass the
bucket name back:

```
npm run teardown -- your-bucket-name
```

Typing the exact name is the safety catch. Anything else stays a dry run.
`--keep-table` and `--keep-bucket` spare either one. It empties the bucket
properly, including every object version and delete marker, and disables PITR
before deleting the table so backup charges stop straight away.

It does not touch your CloudFront distribution or your Clumio backups, since
it didn't create either. Remove those in their own consoles.

### What actually costs anything

Not much between demos. The table holds a few hundred thousand small items, so
it's tens of megabytes, and storage and PITR are priced per GB. The S3 content
is smaller still.

Worth thinking about, in order:

1. CloudFront, if you leave a distribution deployed. It bills while deployed
   regardless of traffic, and it's the one people forget.
2. Write volume when seeding. Each full seed writes around 314,000 items, so
   repeatedly re-seeding costs more than leaving the data in place.
3. PITR, which bills against table size for as long as it's on. Teardown turns
   it off; if you keep the table, turn it off yourself after the event.

If you're coming back to this in a few days, leaving the table and bucket
alone is usually cheaper than tearing down and re-seeding.

## Caveats

- `verify.js` decides an order is corrupt using the same rule as the
  dashboard. Change pricing logic in `config.js` and you must change
  `validation.js` too, or the terminal and the screen will contradict each
  other.
- Bucket versioning keeps old copies of overwritten objects until you clear
  them out.
- Menu artwork is generated SVG, hand-drawn per dish, not photography. See
  `DISH_ICONS` in `scripts/seed.js`. It holds up at 1080p, but swap in real
  photography if you want the gallery to look richer.
- There is no RDS scenario in this repo. The third capability in the wider
  story (SQL against an archived backup) has no code here.
