import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { MockS3Client, S3FileSystem } from "../../../../src/fs/s3/index.js";

const historical = new URL("./historical/", import.meta.url);
const repository = new URL("../../../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", historical), "utf8")) as {
  survivingClassificationReport: { archived: string; sha256: string };
  unavailablePriorRaw: { existsAtSeal: boolean };
  originalFixture: { path: string; archived: string; sha256: string };
};
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

test("historical report and unconditional fixture remain authenticated captured data", () => {
  assert.equal(sha256(readFileSync(new URL(manifest.survivingClassificationReport.archived, historical))), manifest.survivingClassificationReport.sha256);
  assert.equal(sha256(readFileSync(new URL(manifest.originalFixture.archived, historical))), manifest.originalFixture.sha256);
  assert.equal(manifest.originalFixture.sha256, "e8f5e47e15f8e601b08176954533eacff02102c4910d4c6da52547546989f4e5");
  assert.equal(manifest.unavailablePriorRaw.existsAtSeal, false);
});

test("live S3 snapshot removal still fails the unconditional rejection assertion", async () => {
  const bucket = "safe-workflows";
  const mock = new MockS3Client({ buckets: [bucket] });
  const fs = new S3FileSystem({ transport: mock, bucket });
  const nested = "/work/scratch/nested";
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile("/sentinel", new Uint8Array([255, 3]));
  assert.equal(fs.capabilities.snapshotRmdir, true);
  const requestStart = mock.requests.length;
  await assert.rejects(assert.rejects(fs.rmdir(nested), error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "ENOTSUP");
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, nested);
    return true;
  }), { code: "ERR_ASSERTION", message: "Missing expected rejection." });
  assert.deepEqual(mock.requests.slice(requestStart).filter(request =>
    ["putObject", "copyObject", "deleteObject"].includes(request.operation)), [
    { operation: "deleteObject", input: { Bucket: bucket, Key: "work/scratch/nested/" } },
  ]);
  await assert.rejects(fs.stat(nested), { code: "ENOENT" });
  for (const path of ["/work", "/work/scratch"]) assert.equal((await fs.stat(path)).type, "directory");
  assert.deepEqual(await fs.readFile("/sentinel"), new Uint8Array([255, 3]));
});

test("migration preserves original workflow inputs, unrelated cases and exact WebDAV refusal guards", () => {
  const original = readFileSync(new URL(manifest.originalFixture.archived, historical), "utf8");
  const migrated = readFileSync(new URL(manifest.originalFixture.path, repository), "utf8");
  const inputStart = '    const nested = "/work/scratch/nested";';
  const inputEnd = "    assert.deepEqual(await fs.readdir(nested), []);";
  const inputBlock = (source: string): string => source.slice(source.indexOf(inputStart), source.indexOf(inputEnd) + inputEnd.length);
  assert.ok(original.includes(inputStart) && migrated.includes(inputStart));
  assert.ok(original.includes(inputEnd) && migrated.includes(inputEnd));
  assert.equal(inputBlock(migrated), inputBlock(original));
  const unchangedStart = '  test(`${profile.name}: explicitly destructive subtree deletion is distinct from empty-only removal`';
  assert.ok(migrated.includes(unchangedStart));
  assert.equal(migrated.slice(migrated.indexOf(unchangedStart)), original.slice(original.indexOf(unchangedStart)));
  const normalize = (source: string): string => source.split("\n").map(line => line.trim()).join("\n");
  const rejectionStart = "    await assert.rejects(fs.rmdir(nested), error => {";
  const rejectionEnd = '    for (const path of ["/work", "/work/scratch", nested]) assert.equal((await fs.stat(path)).type, "directory");';
  const guards = original.slice(original.indexOf(rejectionStart), original.indexOf(rejectionEnd) + rejectionEnd.length);
  assert.ok(guards.includes('assert.equal(error.code, "ENOTSUP")'));
  assert.ok(normalize(migrated).includes(normalize(guards)));
});
