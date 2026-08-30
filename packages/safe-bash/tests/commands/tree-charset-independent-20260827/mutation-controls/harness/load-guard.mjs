import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requested = process.env.REQUESTED_LOAD;
const expectedRoot = await realpath(process.env.EXPECTED_PACKAGE_ROOT);
const expectedManifestSha256 = process.env.EXPECTED_MANIFEST_SHA256;
const expectedEntrySha256 = process.env.EXPECTED_ENTRY_SHA256;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const resolvedUrl = import.meta.resolve(requested);
const resolvedPath = fileURLToPath(resolvedUrl);
const actualRoot = resolve(dirname(resolvedPath), "..");
const manifestPath = resolve(actualRoot, "package.json");
const manifestBytes = await readFile(manifestPath);
const entryBytes = await readFile(resolvedPath);
const actual = {
  packageRoot: await realpath(actualRoot),
  manifestUrl: pathToFileURL(manifestPath).href,
  manifestSha256: sha256(manifestBytes),
  entrySha256: sha256(entryBytes),
};
const expected = {
  packageRoot: expectedRoot,
  manifestSha256: expectedManifestSha256,
  entrySha256: expectedEntrySha256,
};
const rejectionReasons = [];
if (actual.packageRoot !== expected.packageRoot) rejectionReasons.push("resolved package root is outside expected installation");
if (actual.manifestSha256 !== expected.manifestSha256) rejectionReasons.push("package manifest hash mismatch");
if (actual.entrySha256 !== expected.entrySha256) rejectionReasons.push("package entry hash mismatch");
const record = {
  schema: 1,
  pid: process.pid,
  requested,
  parentUrl: import.meta.url,
  resolvedUrl,
  expected,
  actual,
  allowed: rejectionReasons.length === 0,
  rejectionReasons,
};
if (record.allowed) {
  const loaded = await import(requested);
  record.loadedExportCount = Object.keys(loaded).length;
  record.loaded = true;
} else {
  record.loaded = false;
  process.exitCode = 77;
}
process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
