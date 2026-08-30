import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { namespace, oracle, oracleRoot, sha256, suiteRoot } from "./helpers.js";
import { authenticateCapturedAuthors, authorSnapshotSha256, type AuthorSnapshot } from "./canonical-env/author-provenance.js";

const oracleEvidenceBytes = await readFile(new URL("./oracle-evidence.json", import.meta.url));
const parsed: unknown = JSON.parse(oracleEvidenceBytes.toString("utf8"));
assert.ok(typeof parsed === "object" && parsed !== null);
assert.ok("binaries" in parsed && "authorFilesSha256" in parsed && "archiveSha256" in parsed && "nativeSources" in parsed);
assert.equal(typeof parsed.archiveSha256, "string");

function hashes(value: unknown): Record<string, string> {
  assert.ok(typeof value === "object" && value !== null);
  const output: Record<string, string> = {};
  for (const [name, hash] of Object.entries(value)) {
    assert.equal(typeof hash, "string");
    output[name] = hash;
  }
  return output;
}

const evidence = { binaries: hashes(parsed.binaries), authorFilesSha256: hashes(parsed.authorFilesSha256), archiveSha256: parsed.archiveSha256, nativeSources: hashes(parsed.nativeSources) };

test("GNU native source identities are complete SHA256 hashes matching the pinned source", async () => {
  for (const [name, expected] of Object.entries(evidence.nativeSources)) {
    assert.match(expected, /^[0-9a-f]{64}$/u, name);
    assert.equal(await sha256(join(oracleRoot, name)), expected, name);
  }
});

test("GNU oracle binaries/archive match the independently captured exact identities", async context => {
  assert.equal(await sha256(join(oracleRoot, "../coreutils-9.7.tar.xz")), evidence.archiveSha256);
  const root = await namespace(context);
  for (const command of ["chmod", "stat", "mktemp"] as const) {
    assert.equal(await sha256(join(oracleRoot, "src", command)), evidence.binaries[command]);
    const version = oracle(command, ["--version"], root);
    assert.equal(version.exitCode, 0, version.stderr);
    assert.equal(version.stdout.toString().split("\n")[0], `${command} (GNU coreutils) 9.7`);
  }
});

test("all seven captured author artifacts authenticate immutable handoff source and oracle", async context => {
  const snapshotPath = join(suiteRoot, "canonical-env/author-snapshot.json");
  assert.equal(await sha256(snapshotPath), authorSnapshotSha256, "immutable snapshot identity");
  const snapshot: AuthorSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  authenticateCapturedAuthors(snapshot, oracleEvidenceBytes);
  const current = [];
  for (const [name, capturedSha256] of Object.entries(evidence.authorFilesSha256)) {
    const currentSha256 = await sha256(join(suiteRoot, "../metadata", name));
    current.push({ name, capturedSha256, currentSha256, unchangedSinceCapture: currentSha256 === capturedSha256 });
  }
  context.diagnostic(JSON.stringify({ capturedCommit: snapshot.commit, authenticatedArtifacts: current.length, currentAuthorState: current, note: "Current author edits are reported, not mistaken for corruption of immutable captured source." }));
});
