import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const historical = new URL("./historical/", import.meta.url);
const repository = new URL("../../../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", historical), "utf8")) as {
  survivingClassificationReport: { archived: string; sha256: string };
  unavailablePriorRaw: { existsAtSeal: boolean };
  originalFixture: { path: string; archived: string; sha256: string };
  originalFailure: {
    raw: { path: string; storedSha256: string; decodedSha256: string; lineStart: number; lineEnd: number; excerptSha256: string };
    repositoryManifest: { path: string; sha256: string };
    routing: { path: string; sha256: string; id: string; name: string; error: string; assertionPath: string };
  };
};
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

test("historical report and unconditional fixture remain authenticated captured data", () => {
  assert.equal(sha256(readFileSync(new URL(manifest.survivingClassificationReport.archived, historical))), manifest.survivingClassificationReport.sha256);
  assert.equal(sha256(readFileSync(new URL(manifest.originalFixture.archived, historical))), manifest.originalFixture.sha256);
  assert.equal(manifest.originalFixture.sha256, "e8f5e47e15f8e601b08176954533eacff02102c4910d4c6da52547546989f4e5");
  assert.equal(manifest.unavailablePriorRaw.existsAtSeal, false);
});

test("original frozen raw rejection failure remains authenticated and failing", () => {
  const { raw, routing, repositoryManifest } = manifest.originalFailure;
  const stored = readFileSync(new URL(raw.path, repository));
  assert.equal(sha256(stored), raw.storedSha256);
  const decoded = gunzipSync(Buffer.from(stored.toString().trim(), "base64"));
  assert.equal(sha256(decoded), raw.decodedSha256);
  const excerpt = decoded.toString().split("\n").slice(raw.lineStart - 1, raw.lineEnd).join("\n") + "\n";
  assert.equal(sha256(excerpt), raw.excerptSha256);
  assert.ok(excerpt.includes(`not ok 16491 - ${routing.name}`));
  assert.ok(excerpt.includes(`error: '${routing.error}'`));
  assert.ok(excerpt.includes(routing.assertionPath));
  const routingBytes = readFileSync(new URL(routing.path, repository));
  assert.equal(sha256(routingBytes), routing.sha256);
  const failures = (JSON.parse(routingBytes.toString()) as { failures: { id: string; status: string; error: string }[] }).failures;
  assert.deepEqual(failures.filter(failure => failure.id === routing.id).map(failure => [failure.status, failure.error]), [["fail", "Missing expected rejection."]]);
  assert.equal(sha256(readFileSync(new URL(repositoryManifest.path, repository))), repositoryManifest.sha256);
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
