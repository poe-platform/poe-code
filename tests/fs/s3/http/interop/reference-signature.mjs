import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
export function referenceSignature({ method, host, path, headers = {}, body = Buffer.alloc(0), accessKeyId, secretAccessKey,
  timestamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "") }) {
  const index = path.indexOf("?");
  const pathname = index < 0 ? path : path.slice(0, index);
  const query = index < 0 ? "" : path.slice(index + 1).split("&").map(part => part.includes("=") ? part : part + "=").sort().join("&");
  const signed = Object.fromEntries(Object.entries({ host, ...headers, "x-amz-date": timestamp, "x-amz-content-sha256": digest(body) })
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")]));
  const names = Object.keys(signed).sort();
  const canonical = [method, pathname, query, names.map(name => `${name}:${signed[name]}\n`).join(""), names.join(";"), digest(body)].join("\n");
  const date = timestamp.slice(0, 8), scope = `${date}/us-east-1/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, date), "us-east-1"), "s3"), "aws4_request");
  const signature = hmac(key, `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`).toString("hex");
  return { signature, canonical, headers: { ...signed,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` } };
}

export function verifyOfficialVectors() {
  const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
  const common = { host: "examplebucket.s3.amazonaws.com", timestamp: "20130524T000000Z", ...credentials };
  const get = referenceSignature({ ...common, method: "GET", path: "/test.txt", headers: { range: "bytes=0-9" } });
  const put = referenceSignature({ ...common, method: "PUT", path: "/test%24file.text",
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, body: Buffer.from("Welcome to Amazon S3.") });
  assert.equal(get.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.equal(put.signature, "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  return { source: "https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html",
    cases: [{ name: "official GET object", signature: get.signature }, { name: "official PUT object", signature: put.signature }] };
}
