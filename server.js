import express from "express";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddb, s3 } from "./aws.js";
import { TABLE, BUCKET, TENANTS, PORT, REGION } from "./config.js";
import { isCorrupt } from "./validation.js";

const app = express();
app.use(express.static(new URL("./public", import.meta.url).pathname));

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

app.get("/api/tenant/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const [orders, menu] = await Promise.all([
      queryPartition(slug, "ORDER#"),
      queryPartition(slug, "MENU#")
    ]);

    let assetKeys = [];
    try {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `menu/${slug}/` })
      );
      assetKeys = (listed.Contents || []).map((o) => o.Key);
    } catch {
      assetKeys = [];
    }

    const withImages = await Promise.all(
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

    orders.sort((a, b) => (a.orderId < b.orderId ? 1 : -1));
    const flagged = orders.map((o) => ({ ...o, corrupt: isCorrupt(o) }));

    res.json({
      slug,
      partitionKey: `TENANT#${slug}`,
      name: TENANTS.find((t) => t.slug === slug)?.name || slug,
      orders: flagged.slice(0, 60),
      counts: {
        total: orders.length,
        failing: flagged.filter((o) => o.corrupt).length
      },
      menu: withImages,
      assetsMissing: withImages.filter((m) => !m.imagePresent).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Kerbside ops running on http://localhost:${PORT}`);
  console.log(`Reading ${TABLE} and ${BUCKET} in ${REGION}`);
});
