import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as root from "virtual-bash";
import * as s3 from "virtual-bash/fs/s3";
import * as http from "virtual-bash/fs/s3/http";

const entries = ["virtual-bash", "virtual-bash/fs/s3", "virtual-bash/fs/s3/http"].map(specifier => {
  const url = import.meta.resolve(specifier);
  assert.ok(url.startsWith(process.env.INDEPENDENT_PACKAGE_URL));
  return { specifier, url, sha256: createHash("sha256").update(readFileSync(fileURLToPath(url))).digest("hex") };
});
assert.equal(root.S3FileSystem, s3.S3FileSystem);
assert.equal(root.createS3HttpTransport, http.createS3HttpTransport);
writeFileSync(process.env.INDEPENDENT_PROBE, JSON.stringify({ entries, factoryIdentity: true }, null, 2) + "\n");
