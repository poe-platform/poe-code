import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function oracleSign({ method, path, query = "", headers, body = Buffer.alloc(0), credentials, date = new Date().toISOString().replace(/[-:]|\.\d{3}/g, ""), includePayloadHeader = true }) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, " ")]));
  normalized["x-amz-date"] = date;
  if (includePayloadHeader) normalized["x-amz-content-sha256"] = digest(body);
  const names = Object.keys(normalized).sort();
  const canonical = [method, path, query, names.map(name => name + ":" + normalized[name] + "\n").join(""), names.join(";"), digest(body)].join("\n");
  const scope = date.slice(0, 8) + "/us-east-1/s3/aws4_request";
  let key = Buffer.from("AWS4" + credentials.secretAccessKey);
  for (const part of scope.split("/")) key = createHmac("sha256", key).update(part).digest();
  const signature = createHmac("sha256", key).update(["AWS4-HMAC-SHA256", date, scope, digest(canonical)].join("\n")).digest("hex");
  normalized.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { headers: normalized, canonicalHash: digest(canonical), signature };
}

export function verifyOracleVectors() {
  const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
  const vectors = [
    { name: "GET", method: "GET", path: "/test.txt", headers: { range: "bytes=0-9" }, canonicalHash: "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972", signature: "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41" },
    { name: "PUT", method: "PUT", path: "/test%24file.text", body: Buffer.from("Welcome to Amazon S3."), headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, canonicalHash: "9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d", signature: "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd" },
    { name: "lifecycle", method: "GET", path: "/", query: "lifecycle=", headers: {}, canonicalHash: "9766c798316ff2757b517bc739a67f6213b4ab36dd5da2f94eaebf79c77395ca", signature: "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543" },
    { name: "list", method: "GET", path: "/", query: "max-keys=2&prefix=J", headers: {}, canonicalHash: "df57d21db20da04d7fa30298dd4488ba3a2b47ca3a489c74750e0f1e7df1b9b7", signature: "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7" },
  ];
  return vectors.map(vector => {
    const result = oracleSign({ ...vector, headers: { host: "examplebucket.s3.amazonaws.com", ...vector.headers }, credentials, date: "20130524T000000Z" });
    assert.equal(result.canonicalHash, vector.canonicalHash); assert.equal(result.signature, vector.signature);
    return { name: vector.name, canonicalHash: result.canonicalHash, signature: result.signature, passed: true };
  });
}
