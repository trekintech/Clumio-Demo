# Kerbside ops — Clumio demo environment

A deliberately ordinary-looking multi-tenant ordering platform, used to make
DynamoDB and S3 recovery visible on stage. The app runs locally and reads real
AWS services, so the Clumio console footage and the application response are
both genuine.

**Nothing here is branded.** That is intentional. This is the customer's
application, not a product demo.

## Prerequisites

- Node 20 or later
- An AWS sandbox account you are willing to corrupt data in
- AWS CLI configured with a named profile
- A Clumio tenant connected to that AWS account

## Setup

```bash
npm install
export AWS_PROFILE=kerbside-demo
export AWS_REGION=eu-west-2
export KERBSIDE_BUCKET=kerbside-demo-assets-<something-unique>
npm run seed
npm start
```

Bucket names are globally unique, so change `KERBSIDE_BUCKET` to something that
is yours. Then open http://localhost:5173.

`npm run seed` creates the DynamoDB table and the S3 bucket if they do not
exist, loads eight tenants with 150 orders each, uploads menu artwork and a
settlement CSV per tenant, and enables DynamoDB point-in-time recovery so you
have the native comparison available if challenged from the floor.

No credentials are read from or written to this repo. Everything comes from
your AWS CLI profile.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AWS_REGION` | `eu-west-2` | Region for both services |
| `KERBSIDE_TABLE` | `kerbside-app` | DynamoDB table name |
| `KERBSIDE_BUCKET` | `kerbside-demo-assets` | S3 bucket name |
| `ORDERS_PER_TENANT` | `150` | Orders generated per tenant at seed time |
| `PORT` | `5173` | Local web server port |

Tenants, menus and the blast radius are defined in `config.js`.

## Demo run order

**Before anything else, take a Clumio backup.** Nothing below is recoverable
otherwise.

### DynamoDB scenario

```bash
npm run bad-deploy
```

Corrupts roughly 95% of orders across three tenant partitions only:
`TENANT#alma-kitchen`, `TENANT#brick-lane-grill`, `TENANT#corner-pantry`.
Totals go to zero or to an absurd value, and modifiers are stripped.

It writes `incident.json` with the exact timestamp to restore before, and the
partition keys to target. Read your Backtrack values from that file rather than
from memory — precision is what makes this credible.

Recover with Backtrack, then:

```bash
npm run verify
```

This prints every tenant with its order count, corrupt count and asset count.
After a correct recovery it reports that all tenants are healthy. If tenants
outside the blast radius are degraded, it says so — which is exactly the check
you want to have run before you stand up in front of partners.

### S3 scenario

```bash
npm run s3-incident
```

Deletes menu artwork and settlement exports for the same three tenants. The
gallery renders `404 — object not found` tiles rather than an error banner,
because that is what a real broken storefront looks like.

Recover from Clumio, then refresh.

## Recording

The dashboard polls every four seconds, so recovery appears on screen without
you touching the browser. That is the shot worth having: talk over the app while
the data comes back on its own.

Suggested capture order:

1. Healthy dashboard, tenant selector open to show the scale of the estate
2. Run the incident script off camera
3. Broken dashboard — hold on it, let it sit
4. Clumio console: target the partition keys, set the timestamp
5. Cut back to the dashboard and let the poll bring it back
6. Terminal running `npm run verify`

Record with system audio muted and narrate live on stage. Laptop audio into a
venue PA is a needless risk.

## When something goes wrong

The dashboard never shows a raw stack trace. Any AWS failure is caught and
rendered as a named diagnostic panel with the specific fix, so if something
breaks while you are connected to a projector it still looks like a competent
application rather than a broken demo.

Recognised conditions: missing or expired credentials, table not found, bucket
not found, access denied, DynamoDB throttling, and the local server dying. Each
one names the environment variable or command that resolves it.

A heartbeat in the top right shows how fresh the data is — green when live,
amber past ten seconds, red past twenty. If AWS stops responding mid-recording
you will see it before the audience does.

Unrecognised errors fall back to a generic panel and point you at the terminal.

## Reset

```bash
npm run seed      # re-seeds over the top, restoring a clean state
```

To remove the table and bucket entirely, delete them from the console — the
repo deliberately ships no destructive teardown script.

## Known caveats

- `verify.js` flags an order as corrupt using the same rule the dashboard uses.
  If you change pricing logic in `config.js`, change the rule in
  `validation.js` too or the two will disagree.
- The seed enables PITR on the table. That is useful for the native comparison
  but does add cost; disable it after the event.
- Menu artwork is generated SVG, not photography. It records well enough at
  1080p, but swap in real images if you want the gallery to look richer.
