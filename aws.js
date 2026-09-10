import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { REGION } from "./config.js";

const base = new DynamoDBClient({ region: REGION });

export const ddb = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true }
});

export const rawDdb = base;
export const s3 = new S3Client({ region: REGION });
