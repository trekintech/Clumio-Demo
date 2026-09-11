# Kerbside ops — Clumio demo environment

A plain-looking multi-tenant ordering platform, used to show DynamoDB and S3
recovery on stage. It runs locally against real AWS services, so the app's
reaction and the Clumio console footage are both genuine.

**Nothing here is branded.** This is meant to look like the customer's own
application, not a product demo.

## Get the code

Clone it, so you can pull updates:

```
git clone https://github.com/trekintech/Clumio-Demo.git
cd Clumio-Demo
git pull            # later, to pick up changes
```

If you downloaded a ZIP instead, your folder will be called
`Clumio-Demo-main` and it is a **snapshot**. It does not update, and
`git pull` won't work in it. Scripts added after you downloaded simply won't
be there, which shows up as:

```
The argument 'scripts\setup-windows.ps1' to the -File parameter does not exist.
```

If you see that, you have an old snapshot. Download a fresh ZIP, or clone
properly. To check what your copy actually contains:

```powershell
Get-ChildItem scripts        # Windows
```

```bash
ls scripts                   # macOS / Linux
```

You should see `setup.js`, `setup-windows.ps1`, `check-access.js`,
`require-install.js`, `seed.js`, `bad-deploy.js`, `s3-delete-incident.js`,
`s3-corrupt-incident.js`, `verify.js` and `env-syntax.js`. Anything missing
means the snapshot predates it.

Run every command from the repo root, the folder containing `package.json`.

## Prerequisites

Genuinely just:

- **Node 20 or later**
- **An AWS sandbox account** you don't mind corrupting data in, with
  credentials configured somehow (any profile, SSO session, assume-role
  setup, environment variables or instance role will do)
- **A Clumio tenant** connected to that account

The AWS CLI is **optional**. Everything here talks to AWS through the SDK,
which reads your profiles and SSO sessions directly. You only need the CLI if
you want `npm run setup` to create a brand new SSO login or key pair for you.

Then run `npm run setup`, which handles the rest and asks when it needs a
decision. The sections below are reference material for doing any of it by
hand.

### Install the tooling

**Windows.** There's a script for this. From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

If that reports the file "does not exist", you're either not in the repo root
or you have an old ZIP snapshot. See "Get the code" above.

It checks PowerShell, winget, Node, the AWS CLI and git, and prints the exact
`winget` command for anything missing. Add `-Install` to let it install them
for you:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Install
```

Open a **new** terminal afterwards, or freshly installed tools won't be on
`PATH` yet. Once Node exists you can use `npm run setup:windows` instead of
the long form.

Installing by hand, if you prefer:

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
winget install --exact --id Amazon.AWSCLI
winget install --exact --id Git.Git
```

No winget (Windows 10 before 1809)? Use the installers directly:
<https://nodejs.org/en/download> and
<https://awscli.amazonaws.com/AWSCLIV2.msi>.

**macOS.**

```bash
brew install node awscli
```

**Linux (Debian/Ubuntu).** The distro Node is usually too old, so use
NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install
```

Check both, on any platform:

```
node -v          # want v20 or higher
aws --version    # want aws-cli/2.x
```

### Give the AWS CLI credentials

**`npm run setup`, further down, can do everything in this section for you**
interactively — it detects what's missing and offers to run it. Read on if
you'd rather do it by hand first, or you're troubleshooting something it
couldn't resolve on its own.

**If you already have a working profile or role, use it.** Nothing here needs
a dedicated one. Check what you've already got:

```
aws configure list-profiles
aws sts get-caller-identity
```

If that second command prints an account and an ARN, you're already
authenticated and can skip to the permission check below. To use a specific
existing profile:

```bash
export AWS_PROFILE=<existing-profile>     # macOS / Linux
```

```powershell
$env:AWS_PROFILE = "<existing-profile>"   # Windows PowerShell
```

The sections below are only for setting up access you don't already have.
Pick whichever matches how your account works.

**IAM Identity Center / SSO** (most common for role-based access):

```
aws configure sso
aws sso login --profile kerbside-demo
```

**Assume an existing role.** Add a profile to your AWS config file
(`~/.aws/config`, or `%USERPROFILE%\.aws\config` on Windows):

```ini
[profile kerbside-demo]
role_arn       = arn:aws:iam::123456789012:role/YourExistingRole
source_profile = default
region         = eu-west-2
```

**Static keys** (simplest, least good):

```
aws configure --profile kerbside-demo
```

Then select the profile for your session and confirm it resolves:

```bash
export AWS_PROFILE=kerbside-demo         # macOS / Linux
aws sts get-caller-identity
```

```powershell
$env:AWS_PROFILE = "kerbside-demo"       # Windows PowerShell
aws sts get-caller-identity
```

That last command must print an account and an ARN. If it does, the demo
will authenticate, because nothing in this repo handles credentials itself.
The SDK clients are built with a region and nothing else, so an existing
role is fine, whether that's an assume-role profile, SSO, environment
variables, or an instance role. `npm run setup` echoes the resolved ARN so
you can confirm you're on the role you intended.

If your credentials are temporary, prefer a profile the SDK can refresh on
its own (`role_arn` with `source_profile`, or an SSO profile) over pasting
short-lived `AWS_SESSION_TOKEN` values into your shell. Pasted session
credentials don't refresh, and they expire mid-demo without warning.

### Check the role can actually do the work

`npm run setup` does this as step 4. To re-run it on its own later:

```
npm run check-access
```

Credentials resolving is not the same as having permission: a role can
authenticate perfectly and still be unable to create a table or write an
object. This probes each permission the demo needs and maps any denial to the
exact IAM action, printing a policy you can paste straight in. Where the
table or bucket already exists it does a real write-and-delete round trip, so
the answer isn't inferred from policy. Add `-- --read-only` to skip the write
probes.

It goes through the AWS SDK rather than the CLI on purpose: that's the same
credential path `server.js` and the seed take, and the two can resolve
differently.

Permissions needed:

| Service | Actions |
|---|---|
| DynamoDB | `CreateTable`, `DescribeTable`, `UpdateContinuousBackups`, `BatchWriteItem`, `Query` |
| S3 | `CreateBucket`, `HeadBucket`, `PutBucketVersioning`, `PutObject`, `GetObject`, `ListBucket`, `DeleteObject` |
| STS | `GetCallerIdentity` |

Before the table and bucket exist, the create and write actions can't be
probed. `check-access` says so rather than implying a clean bill of health.
Those are exercised in the first seconds of `npm run seed`, which fails fast
and harmlessly if any are denied.

### A note on shell syntax

Commands below are shown for bash. On Windows PowerShell, environment
variables are set differently, and the inline `FOO=bar command` form doesn't
exist at all:

| | bash / zsh | PowerShell |
|---|---|---|
| Set for the session | `export FOO=bar` | `$env:FOO = "bar"` |
| Set for one command | `FOO=bar npm run seed` | `$env:FOO = "bar"; npm run seed` |

Everything else (`npm run ...`) is identical on both.

## Run it end to end

### 1. Setup

```
npm run setup
```

That's the whole thing. It never stops to ask you for something it can work
out on its own, and it says what it's doing at each step:

1. **Dependencies** — installed quietly.
2. **Credentials** — checks yours resolve. If they don't, it stops and tells
   you how; it doesn't guess.
3. **Bucket** — if you're still on the shared default (which is guaranteed to
   collide, since S3 names are global) it picks a unique name for you, then
   **creates the bucket**. It tells you the name it chose.
4. **Permissions** — probes what the role can genuinely do, writing and
   deleting a test object rather than inferring from policy. Anything denied
   gets a ready-to-paste IAM policy naming the exact actions.
5. **Seed** — offers to load the data immediately.

**Your choices are remembered.** Setup writes the bucket name, region and
profile to `.kerbside-local.json` (git-ignored, no secrets), and every script
reads it. So you don't have to export anything in new terminals — open a
fresh one, run `npm start`, and it already knows. Environment variables still
win if you set them, so nothing is taken out of your hands:

```bash
export KERBSIDE_BUCKET=my-own-bucket-name
npm run setup
```

```powershell
$env:KERBSIDE_BUCKET = "my-own-bucket-name"
npm run setup
```

**Prompts are optional.** Run through `npm run` and it works automatically,
choosing defaults and reporting them — npm pipes its output, so questions
aren't possible there. If you'd rather be asked before it picks a bucket name
or seeds, run it directly instead:

```
node scripts/setup.js
```

Either way it never blocks waiting for input.

To re-check permissions later without the full flow:

```
npm run check-access
```

Both are safe to re-run. Neither writes anything to AWS beyond a probe object
it deletes immediately.

### 2. Rehearse with a small estate

Don't make your first run the 314,000-item one.

```bash
SYNTHETIC_TENANT_COUNT=50 npm run seed
SYNTHETIC_TENANT_COUNT=50 npm start
```

```powershell
$env:SYNTHETIC_TENANT_COUNT = "50"
npm run seed
npm start
```

On PowerShell the variable stays set for the rest of the session, so clear it
with `Remove-Item Env:SYNTHETIC_TENANT_COUNT` before seeding the full estate.

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

```powershell
$env:IMAGE_BASE_URL = "https://<distribution-id>.cloudfront.net"
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

The terminal commands hold to the same standard. Every script that talks to
AWS (`start`, `seed`, `bad-deploy`, both S3 incidents, `verify`,
`check-access`) checks dependencies are installed before it does anything
else, and fails with a one-line fix rather than Node's raw
`ERR_MODULE_NOT_FOUND`. If you see that error anyway, you're running an old
copy from before this check existed — see "Get the code" above.

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
