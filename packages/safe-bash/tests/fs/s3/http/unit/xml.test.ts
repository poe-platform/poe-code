import assert from "node:assert/strict";
import test from "node:test";

import { serverFor } from "./helpers.js";

for (const [name, body] of [
  ["malformed", "<ListBucketResult>"],
  ["DTD", "<!DOCTYPE ListBucketResult><ListBucketResult/>"],
  ["duplicate state", "<ListBucketResult><IsTruncated>false</IsTruncated><IsTruncated>true</IsTruncated></ListBucketResult>"],
  ["missing token", "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"],
  ["bad escaping", "<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>%xx</Prefix></CommonPrefixes></ListBucketResult>"],
] as const) test(`HTTP 200 LIST ${name} is not successful metadata`, async context => {
  const fixture = await serverFor(context, (_request, response) => { response.end(body); });
  await assert.rejects(fixture.transport().listObjectsV2({ Bucket: "testbucket" }), { code: "InvalidResponse" });
});
