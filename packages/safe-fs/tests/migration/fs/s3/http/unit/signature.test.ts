import assert from "node:assert/strict";
import { test } from "vitest";
import { canonicalQuery,sha256,signRequest,uriEncode } from "../../../../../../src/fs/s3/http/signature.js";

const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const vectors = [
  { name: "GET Object", method: "GET", path: "/test.txt", query: "", body: "", headers: { range: "bytes=0-9" },
    canonicalHash: "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    signature: "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41" },
  { name: "PUT Object", method: "PUT", path: "/test%24file.text", query: "", body: "Welcome to Amazon S3.",
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    canonicalHash: "9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d",
    signature: "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd" },
  { name: "GET Bucket Lifecycle", method: "GET", path: "/", query: "lifecycle=", body: "", headers: {},
    canonicalHash: "9766c798316ff2757b517bc739a67f6213b4ab36dd5da2f94eaebf79c77395ca",
    signature: "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543" },
  { name: "GET Bucket List", method: "GET", path: "/", query: "max-keys=2&prefix=J", body: "", headers: {},
    canonicalHash: "df57d21db20da04d7fa30298dd4488ba3a2b47ca3a489c74750e0f1e7df1b9b7",
    signature: "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7" },
] as const;

for (const vector of vectors) test(`AWS official single-chunk SigV4 vector: ${vector.name}`, () => {
  const actual = signRequest({ ...vector, credentials, region: "us-east-1", date: new Date("2013-05-24T00:00:00Z"),
    body: Buffer.from(vector.body), headers: { host: "examplebucket.s3.amazonaws.com", ...vector.headers } });
  assert.equal(sha256(actual.canonicalRequest), vector.canonicalHash);
  assert.equal(actual.signature, vector.signature);
});

test("UTF-8 URI encoding and query sorting preserve literal key structure", () => {
  assert.equal(uriEncode("a/.././b//雪 +%2E?#!'()*", true), "a/.././b//%E9%9B%AA%20%2B%252E%3F%23%21%27%28%29%2A");
  assert.equal(canonicalQuery([["z", "+ /"], ["雪", "x"], ["a", "z"], ["a", "a"], ["empty", ""]]), "%E9%9B%AA=x&a=a&a=z&empty=&z=%2B%20%2F");
  assert.throws(() => uriEncode("\ud800"), { code: "InvalidArgument" });
});

test("session token and normalized metadata are signed exactly as emitted", () => {
  const signed = signRequest({ method: "GET", path: "/", query: "", body: new Uint8Array(), region: "us-east-1",
    date: new Date("2013-05-24T00:00:00Z"), credentials: { ...credentials, sessionToken: "token/+=" },
    headers: { host: "localhost:1234", "x-amz-meta-note": "  first \t second  " } });
  assert.equal(signed.headers["x-amz-meta-note"], "first second");
  assert.match(signed.canonicalRequest, /x-amz-security-token:token\/\+=/);
  assert.match(signed.headers.authorization!, /x-amz-security-token/);
  assert.throws(() => signRequest({ method: "GET", path: "/", query: "", body: new Uint8Array(), region: "us-east-1",
    date: new Date(), credentials, headers: { host: "host", "x-amz-meta-note": "value\r\ninjected:true" } }), { code: "InvalidArgument" });
});
