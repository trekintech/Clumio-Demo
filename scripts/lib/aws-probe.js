// Credential and permission probing, using only the AWS SDK.
//
// Deliberately no AWS CLI dependency: the SDK resolves profiles, SSO sessions
// and instance roles on its own, and it's the exact credential path server.js
// and the seed take. The CLI is only genuinely needed to *create* an SSO login
// interactively, so it's treated as optional everywhere else.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DynamoDBClient, DescribeTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand
} from "@aws-sdk/client-s3";

export const noCredentials = (err) =>
  err.name === "CredentialsProviderError" ||
  err.name === "CredentialsError" ||
  /credential/i.test(err.message || "");

export const denied = (err) =>
  err.name === "AccessDenied" ||
  err.name === "AccessDeniedException" ||
  err.name === "Forbidden" ||
  err.$metadata?.httpStatusCode === 403;

export const absent = (err) =>
  err.name === "ResourceNotFoundException" ||
  err.name === "NotFound" ||
  err.name === "NoSuchBucket" ||
  err.$metadata?.httpStatusCode === 404;

// Clients are built on demand rather than imported, so switching AWS_PROFILE
// mid-run actually takes effect (credentials resolve lazily per client).
export function clientsFor(region) {
  const raw = new DynamoDBClient({ region });
  return {
    raw,
    doc: DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } }),
    s3: new S3Client({ region })
  };
}

function parseIniSections(file) {
  if (!fs.existsSync(file)) return [];
  const names = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

// Read profiles straight from the AWS config files, so this works with no CLI.
export function listProfiles() {
  const home = os.homedir();
  const configured = parseIniSections(process.env.AWS_CONFIG_FILE || path.join(home, ".aws", "config"))
    .map((s) => (s.startsWith("profile ") ? s.slice(8).trim() : s))
    .filter((s) => s !== "default" || true);
  const creds = parseIniSections(
    process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, ".aws", "credentials")
  );
  return [...new Set([...configured, ...creds])].filter((p) => p && !p.startsWith("sso-session"));
}

// Cheapest call that proves credentials resolve AND are accepted by AWS.
export async function credentialsWork(region) {
  const { raw } = clientsFor(region);
  try {
    await raw.send(new ListTablesCommand({ Limit: 1 }));
    return { ok: true };
  } catch (err) {
    if (noCredentials(err)) return { ok: false, reason: "none" };
    if (denied(err)) return { ok: true, limited: true }; // valid creds, just can't list
    return { ok: false, reason: "error", err };
  }
}

// The IAM actions the demo actually performs, for generating a policy.
export const REQUIRED_ACTIONS = {
  dynamodb: [
    "dynamodb:CreateTable",
    "dynamodb:DescribeTable",
    "dynamodb:UpdateContinuousBackups",
    "dynamodb:BatchWriteItem",
    "dynamodb:Query"
  ],
  s3: [
    "s3:CreateBucket",
    "s3:ListBucket",
    "s3:PutBucketVersioning",
    "s3:PutObject",
    "s3:GetObject",
    "s3:DeleteObject"
  ]
};

export function policyDocument(table, bucket, region, account = "*") {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "KerbsideDemoDynamoDB",
          Effect: "Allow",
          Action: REQUIRED_ACTIONS.dynamodb,
          Resource: `arn:aws:dynamodb:${region}:${account}:table/${table}`
        },
        {
          Sid: "KerbsideDemoS3",
          Effect: "Allow",
          Action: REQUIRED_ACTIONS.s3,
          Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`]
        }
      ]
    },
    null,
    2
  );
}

/**
 * Probes what the current credentials can actually do.
 * Returns { checks: [{label, state, action?, detail?}], blocking: n }
 * state is one of: "ok" | "denied" | "skipped" | "warn"
 */
export async function probeAccess({ region, table, bucket, readOnly = false }) {
  const { raw, doc, s3 } = clientsFor(region);
  const checks = [];
  const add = (label, state, extra = {}) => checks.push({ label, state, ...extra });

  // ---- DynamoDB
  let tableExists = false;
  try {
    await raw.send(new DescribeTableCommand({ TableName: table }));
    tableExists = true;
    add(`DynamoDB DescribeTable (table ${table} exists)`, "ok");
  } catch (err) {
    if (absent(err)) add(`DynamoDB DescribeTable (table not created yet)`, "ok");
    else if (denied(err)) add("DynamoDB DescribeTable", "denied", { action: "dynamodb:DescribeTable" });
    else add(`DynamoDB DescribeTable failed: ${err.name}`, "warn");
  }

  if (tableExists && !readOnly) {
    const key = { pk: "TENANT#__preflight__", sk: "PROBE" };
    try {
      await doc.send(
        new BatchWriteCommand({ RequestItems: { [table]: [{ PutRequest: { Item: { ...key, entity: "preflight" } } }] } })
      );
      await doc.send(new BatchWriteCommand({ RequestItems: { [table]: [{ DeleteRequest: { Key: key } }] } }));
      add("DynamoDB BatchWriteItem (write + cleanup verified)", "ok");
    } catch (err) {
      if (denied(err)) add("DynamoDB BatchWriteItem", "denied", { action: "dynamodb:BatchWriteItem" });
      else add(`DynamoDB write probe failed: ${err.name}`, "warn");
    }
  } else if (!tableExists) {
    add("DynamoDB write permissions", "skipped", { detail: "table doesn't exist yet; seed will exercise them" });
  }

  // ---- S3
  let bucketExists = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    bucketExists = true;
    add(`S3 HeadBucket (bucket ${bucket} reachable)`, "ok");
  } catch (err) {
    if (absent(err)) add("S3 HeadBucket (bucket not created yet)", "ok");
    else if (denied(err))
      add("S3 HeadBucket returned 403", "denied", {
        action: "s3:ListBucket",
        detail: "either the role lacks access, or this globally-unique name belongs to another account"
      });
    else add(`S3 HeadBucket failed: ${err.name}`, "warn");
  }

  if (bucketExists) {
    try {
      await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      add("S3 ListBucket", "ok");
    } catch (err) {
      if (denied(err)) add("S3 ListBucket", "denied", { action: "s3:ListBucket" });
    }

    try {
      const v = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      add(`S3 versioning ${v.Status === "Enabled" ? "enabled" : "not enabled yet (seed turns it on)"}`, "ok");
    } catch (err) {
      if (denied(err)) add("S3 GetBucketVersioning", "warn", { action: "s3:PutBucketVersioning" });
    }

    if (!readOnly) {
      const key = ".kerbside-preflight/probe.txt";
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "preflight" }));
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        add("S3 PutObject + DeleteObject (write + cleanup verified)", "ok");
      } catch (err) {
        if (denied(err)) add("S3 PutObject/DeleteObject", "denied", { action: "s3:PutObject" });
        else add(`S3 write probe failed: ${err.name}`, "warn");
      }
    }
  } else {
    add("S3 object permissions", "skipped", { detail: "bucket doesn't exist yet; seed will exercise them" });
  }

  return { checks, blocking: checks.filter((c) => c.state === "denied").length, tableExists, bucketExists };
}
