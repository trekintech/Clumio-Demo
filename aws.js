import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { REGION } from "./config.js";

// Seeding drives sustained concurrent writes, which is exactly when DynamoDB
// returns transient 500s and throttling. The SDK default of 3 attempts isn't
// enough for that; adaptive mode also backs off client-side when it sees
// throttling rather than hammering through it.
const retryConfig = { maxAttempts: 10, retryMode: "adaptive" };

const base = new DynamoDBClient({ region: REGION, ...retryConfig });

export const ddb = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true }
});

export const rawDdb = base;
export const s3 = new S3Client({ region: REGION, ...retryConfig });
