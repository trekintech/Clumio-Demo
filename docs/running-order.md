# Running order

Everything is recorded in segments and narrated live from the stage. Nothing
is performed live, so every wait, deploy and seed gets cut in the edit.

Three clips, in this order: DynamoDB, S3 deletion, S3 overwrite. DynamoDB
leads because it's the strongest and the easiest to follow.

---

## Before recording day

- [ ] Seed the full estate (`npm run seed`). The sidebar must read 4,127.
- [ ] Dashboard loads and all eight named tenants are green.
- [ ] Clumio backup taken. **Nothing is recoverable without this.**
- [ ] CloudFront distribution built: single S3 origin, OAC, and the cache
      policy set to `CachingDisabled`. Without that an edge cache can serve the
      deleted objects and the incident appears to do nothing.
- [ ] `IMAGE_BASE_URL` set and the server restarted. Confirm it took: startup
      must print `Menu and artwork via CloudFront: …`. If it says "read
      directly from S3", the variable didn't get set — on PowerShell it's
      `$env:IMAGE_BASE_URL = "..."`, not `export`. The dashboard's menu source
      line should show the CloudFront URL too.
- [ ] Dry run of `npm run bad-deploy` → Backtrack → `npm run verify` on the
      small estate, so nothing about the Clumio console is unfamiliar.
- [ ] Browser at 100% zoom, bookmarks bar hidden, notifications off.
- [ ] Two terminals: one running `npm start`, one for commands.

Re-seed after any rehearsal (`npm run seed`) so you record from a clean state.

---

## Clip 1 — DynamoDB, Backtrack

The argument: three restaurants out of four thousand were corrupted. Native
recovery means restoring the whole table. Backtrack targets just those three,
to the second, in place.

**Commercial framing, for the slide:**

> A bad pricing deploy corrupted three restaurants out of 4,127. Order totals
> now read £0.00, modifiers are stripped, and every invoice and payout
> calculated from those three partitions is wrong. DynamoDB can't restore a
> partition and can't restore in place, so the native fix is to restore all
> 4,127 to a second table and hand-write a merge for the three you wanted.

The platform is still up and still taking orders, so this isn't lost trade.
It's that the money is wrong and nobody can tell which figures to trust.

| | |
|---|---|
| Restaurants affected | 3 of 4,127 |
| Orders corrupted | ~427 of 310,125, so 0.14% |
| Corruption | 95% of orders per partition, tagged `pricing-svc@4.11.2` |

**What the native route actually costs.** Be precise about this, because
someone will ask and the honest answer is better than the dramatic one:

1. `RestoreTableToPointInTime` always creates a **new** table. Nothing rolls
   the live table backwards, so nobody loses 310,000 orders.
2. You can't restore a subset. No partition-key filter, no prefix. All 4,127
   restaurants come back whether you want them or not, and you're now holding
   a second complete copy of the estate.
3. You hand-write a script to pull the three partitions out of the restored
   table and write them over the live one.
4. **That merge is where data loss lives.** Anything legitimately written to
   those three partitions between the restore point and the merge gets
   clobbered by a naive overwrite, so the script has to reconcile rather than
   copy: compare timestamps, keep post-incident writes, replace only what the
   deploy touched. Bespoke code, written under pressure, against live financial
   data.
5. The corruption stays live throughout, and keeps being billed from.

Backtrack does step 1 to 4 as one operation, scoped to the partition keys, to
the second, in place. That's the comparison, and it holds up without
overstating what PITR does.

| Seg | Capture | Doing | Hold for |
|---|---|---|---|
| 1A | Dashboard, healthy | Open the tenant sidebar and scroll it | Long enough that 4,127 registers |
| 1B | Terminal | `npm run bad-deploy` | Until it prints the partition keys |
| 1C | Dashboard, untouched | Nothing. Let the 4s poll do it | Longer than feels comfortable |
| 1D | Screen: broken state | Hover the red rows, the £0.00 totals | A slow pass |
| 1E | Clumio console | Backtrack: paste timestamp + partition keys | Full, unhurried |
| 1F | Dashboard, untouched | Nothing. Let it come back on its own | Until fully green |
| 1G | Terminal | `npm run verify` | Until the verdict line |

**Narration beats**

- 1A: "Four thousand one hundred and twenty-seven restaurants. Each one a
  partition in a single DynamoDB table."
- 1B: "A pricing service deploy goes wrong. It touches three of them."
- 1C: **Say nothing for a beat.** Let the screen turn red on its own. Then:
  "Nobody touched the browser. That's the dashboard polling, and the data
  underneath it has changed."
- 1D: "Totals at zero, modifiers stripped, 95% of orders in those three
  partitions. The other four thousand are untouched — which is the problem,
  because native recovery doesn't know that."
- 1E: "Backtrack takes the partition keys and a timestamp. Not the table.
  These three, to the second, restored in place." Read the values from
  `incident.json`, on screen — don't recite them from memory.
- 1F: "Again, nobody touched anything."
- 1G: "And here's the check that matters: the five tenants outside the blast
  radius were never modified."

**Traps**

- Don't say the table was restored. It wasn't. Three partitions were.
- The PITR comparison is worth making, but be precise. Native PITR can't do
  partition-level or in-place recovery, and a PITR backup dies with its table.
  Don't say the table gets rewound or that the other restaurants lose data:
  a restore goes to a new table, so what it actually costs is a second full
  copy plus a hand-written merge. See the commercial framing above.

**Files on screen:** `incident.json` gives you `recoverToBefore` and
`partitionKeys`. Have it open in 1E.

---

## Clip 2 — S3 deletion, Instant Access

The argument: the storefront serves its menu from S3. Delete it and the
restaurant can't trade. Instant Access gets it serving again from the backup
before anything is restored.

**Commercial framing, for the slide:**

> Three restaurants can't serve a menu, so they can't take a single order.
> That's roughly £430 a day of trade stopped dead, and it keeps accruing until
> someone fixes it, while their order history sits there perfectly intact.

The opposite shape to clip 1. Nothing is wrong with the data, there just isn't
any new data. Prospective revenue rather than corrupted revenue, which is why
Instant Access is the right answer here: you restart the revenue before you
restore the data.

| Restaurant | Typical week | Orders/week |
|---|---|---|
| Alma Kitchen | £1,445.18 | 44.9 |
| Brick Lane Grill | £1,188.67 | 43.6 |
| Corner Pantry | £383.28 | 20.8 |
| Combined | £3,017.13 | ~109 |

Averaged across normal trading weeks with the incident week excluded, from the
finance ledger in `sql/`. £3,017 a week is £431 a day. Note the ledger holds
250 restaurants while the app shows 4,127: the three here exist in both with
the same slugs, and if anyone cross-references the counts, the ledger is one
trading entity's settlements rather than the whole estate.

| Seg | Capture | Doing | Hold for |
|---|---|---|---|
| 2A | Dashboard, healthy | Point out the S3 path above the menu | A beat on the path |
| 2B | Terminal | `npm run s3-delete-incident` | Until the object counts print |
| 2C | Dashboard, untouched | Nothing | Until "Storefront down" appears |
| 2D | Clumio console | Request Instant Access on the backup | Full |
| 2E | CloudFront console | Add origin (OAC), create origin group, 403 **and** 404, repoint behaviour | Full. **Cut the deploy wait** |
| 2F | Dashboard | Storefront trading again | Until clearly back |
| 2G | *(optional)* Clumio | Restore source objects | Cut the wait |

**Narration beats**

- 2A: "The menu isn't in the database. It's a document published to S3, and
  the storefront renders from it. That path, there."
- 2B: "Someone deletes the prefix."
- 2C: "That's not a broken image. That restaurant cannot show a menu, so it
  cannot take an order. Existing orders are still there — what's gone is
  everything they'd have taken from here on."
- 2D: "Instant Access gives me a read-only view of the backup, at a point in
  time. I'm not restoring anything yet."
- 2E: "I add it as a second origin behind CloudFront, and fail over on 403 and
  404." Say *both codes* out loud — it's the detail an engineer will check.
- 2F: "Trading again. Nothing has been restored. We're serving the backup
  while the real recovery runs behind it."
- 2G: "And because CloudFront retries the primary on every request, as objects
  come back the traffic drains to the source on its own. No cutover, no moment
  of deciding it's safe to switch. Then Instant Access gets released — it's a
  recovery tool, not a second origin you leave running."

**Traps**

- **Do not say "automatic failover, no human intervention."** You built the
  origin group on camera. The claim is *recovering availability in minutes by
  serving from the backup*.
- Writes continuing against the source during recovery is true of a real
  deployment, not of this app — it has no S3 write path. Say "in a real
  deployment", don't gesture at the screen.
- Instant Access is Standard tier only. Not SecureVault Archive.

---

## Clip 3 — S3 overwrite, Backtrack

The argument: failover fires on error codes. Corrupted content returns 200, so
nothing routes around it. This is the one that separates availability from
data.

| Seg | Capture | Doing | Hold for |
|---|---|---|---|
| 3A | Terminal | `npm run s3-corrupt-incident` | Until counts print |
| 3B | Dashboard | Garbage tiles, **green banner**, "all present" | Slow pan across both |
| 3C | Clumio console | Backtrack the object versions | Full |
| 3D | Dashboard | Artwork back | Until clean |

**Narration beats**

- 3A: "Same three restaurants. This time the objects aren't deleted, they're
  overwritten."
- 3B: This is the whole clip. Slow down. "S3 returns 200. The object is there.
  CloudFront has nothing to fail over on, because nothing is failing. Look at
  the dashboard — every check is green, assets all present. And look at what
  the customer sees." Let both be on screen together.
- 3C: "Backtrack rolls the object back to its previous version. Instant Access
  wouldn't help here: it solves missing, not wrong."
- 3D: Brief. The recovery isn't the point of this clip; the contrast is.

**Trap**

- Keep clips 2 and 3 distinct. Deletion is an availability problem CloudFront
  routes around. Corruption is a data problem nothing routes around, because
  the bytes are wrong. Blur them and the argument collapses.

---

## The three clips side by side

Worth being explicit, because it's the spine of the set.

| Clip | What's broken | Commercial shape |
|---|---|---|
| DynamoDB | Data is wrong, platform is up | Wrong money. Every downstream figure is untrustworthy |
| S3 delete | Data is missing, platform is down | No money. £431/day, accruing |
| S3 overwrite | Data is wrong, every check says green | Wrong money, and nothing alerts on it |
| RDS | Data is gone by design, nothing is broken | No answer. An unanswerable audit question |

---

## Editing

Cut every wait: seeding, CloudFront deploys, Clumio restore progress. Keep the
4-second poll doing its work — in 1C, 1F and 2C the fact that nothing was
touched is the point, so don't speed those up or the audience will assume a
refresh.

Sequence on stage: 1 → 2 → 3. If time is short, drop clip 3 and keep 1 and 2.
Clip 3 is the most technically interesting and the least visually dramatic,
so it's the one that survives being told rather than shown.

---

## RDS

Recorded separately, against your own PostgreSQL RDS instance. Load the data
and take the Clumio backup before the session rather than on camera.

Six segments, three of them queries: what was paid, why it was short, and
proof the evidence is real. Each query runs because the one before left a
question open, so the order isn't negotiable.

Full step-by-step, shot list and SQL are in
[rds-audit-scenario.md](rds-audit-scenario.md). The story in prose, and the
figures written out for slides, are in
[rds-slide-brief.md](rds-slide-brief.md).

It's an audit and compliance story rather than a recovery-speed one, and
that's a feature of the set. Three different shapes of problem beats three
claims of speed.

---

## If something breaks mid-recording

- Dashboard shows a diagnostic panel: it names the fix. Stop, fix, re-record
  the segment.
- Heartbeat top right amber or red: AWS stopped answering. Don't keep filming.
- Deletion appears to do nothing: CloudFront is serving a cached copy.
  Invalidate the path, re-record.
- Anything unexpected in `npm run verify`: re-seed and start the clip again
  rather than recording around it.
