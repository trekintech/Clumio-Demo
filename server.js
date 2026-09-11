import express from "express";
import { fileURLToPath } from "node:url";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddb, s3 } from "./aws.js";
import { TABLE, BUCKET, TENANTS, PORT, REGION, IMAGE_BASE_URL } from "./config.js";
import { isCorrupt } from "./validation.js";

const app = express();
// fileURLToPath, not .pathname: on Windows .pathname yields "/C:/Users/..."
// with a leading slash before the drive letter, which isn't a valid path, so
// express.static silently serves nothing and every request 404s.
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

async function queryPartition(slug, prefix) {
  const items = [];
  let last;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": `TENANT#${slug}`, ":sk": prefix },
        ExclusiveStartKey: last
      })
    );
    items.push(...(res.Items || []));
    last = res.LastEvaluatedKey;
  } while (last);
  return items;
}

app.get("/api/tenants", (_req, res) => {
  res.json({ tenants: TENANTS, region: REGION, table: TABLE, bucket: BUCKET });
});

// The storefront's menu is a document published to S3, not a DynamoDB record.
// If it cannot be loaded the tenant genuinely cannot take orders — that is the
// outage the S3 clip demonstrates. See CLAUDE.md "What S3 holds".
async function loadMenuDocument(slug) {
  if (IMAGE_BASE_URL) {
    const base = IMAGE_BASE_URL.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/menu/${slug}/menu.json`, { cache: "no-store" });
      if (!res.ok) return { available: false, items: [] };
      const doc = await res.json();
      return { available: true, items: doc.items || [] };
    } catch {
      return { available: false, items: [] };
    }
  }

  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `menu/${slug}/menu.json` })
    );
    const doc = JSON.parse(await res.Body.transformToString());
    return { available: true, items: doc.items || [] };
  } catch {
    return { available: false, items: [] };
  }
}

async function resolveMenuImages(slug, menu) {
  // CloudFront mode: the app has no business checking the source bucket
  // directly — that's what the origin group is for. Trust the distribution
  // and let a real failure show as a native broken image, which is the
  // honest signal here (see docs/s3-demo-runbook.md).
  if (IMAGE_BASE_URL) {
    const base = IMAGE_BASE_URL.replace(/\/$/, "");
    return menu.map((m) => ({ ...m, imagePresent: true, imageUrl: `${base}/${m.imageKey}` }));
  }

  let assetKeys = [];
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `menu/${slug}/` })
    );
    assetKeys = (listed.Contents || []).map((o) => o.Key);
  } catch {
    assetKeys = [];
  }

  return Promise.all(
    menu.map(async (m) => {
      const present = assetKeys.includes(m.imageKey);
      let url = null;
      if (present) {
        url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: m.imageKey }),
          { expiresIn: 900 }
        );
      }
      return { ...m, imagePresent: present, imageUrl: url };
    })
  );
}

app.get("/api/tenant/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const tenant = TENANTS.find((t) => t.slug === slug);

    // Synthetic filler tenants never had a published menu, so a missing
    // document is expected for them and is not an outage. See CLAUDE.md Scale.
    const [orders, menuDoc] = await Promise.all([
      queryPartition(slug, "ORDER#"),
      tenant?.synthetic
        ? Promise.resolve({ available: true, items: [] })
        : loadMenuDocument(slug)
    ]);

    const withImages = await resolveMenuImages(slug, menuDoc.items);

    orders.sort((a, b) => (a.orderId < b.orderId ? 1 : -1));
    const flagged = orders.map((o) => ({ ...o, corrupt: isCorrupt(o) }));

    res.json({
      slug,
      partitionKey: `TENANT#${slug}`,
      name: tenant?.name || slug,
      orders: flagged.slice(0, 60),
      counts: {
        total: orders.length,
        failing: flagged.filter((o) => o.corrupt).length
      },
      menu: withImages,
      // False means the storefront cannot serve a menu at all — customers
      // cannot order. This is the S3 availability scenario.
      menuAvailable: menuDoc.available,
      // In CloudFront mode "missing" isn't a concept the app can see —
      // that's the point of the origin group. See resolveMenuImages above.
      assetsMissing: IMAGE_BASE_URL ? 0 : withImages.filter((m) => !m.imagePresent).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Kerbside ops running on http://localhost:${PORT}`);
  console.log(`Reading ${TABLE} and ${BUCKET} in ${REGION}`);
});

// Without this, a port clash prints an unhandled 'error' event and a stack
// trace - which is both alarming mid-demo and says nothing about the fix.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error("Another copy of this server is probably still running, possibly an");
    console.error("older one from before a code change, which will serve stale files.\n");
    console.error("Stop it, then start again:");
    if (process.platform === "win32") {
      console.error("  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force");
    } else {
      console.error(`  lsof -ti tcp:${PORT} | xargs kill`);
    }
    console.error("\nOr run this one on a different port:");
    console.error(
      process.platform === "win32"
        ? `  $env:PORT = "${PORT + 1}"; npm start`
        : `  PORT=${PORT + 1} npm start`
    );
  } else if (err.code === "EACCES") {
    console.error(`\nNot allowed to bind port ${PORT}. Try a port above 1024.`);
  } else {
    console.error(`\nServer failed to start: ${err.message}`);
  }
  process.exit(1);
});
