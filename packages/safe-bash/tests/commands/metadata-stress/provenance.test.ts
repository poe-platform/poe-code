import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

test("all seven captured author artifacts authenticate immutable handoff source and oracle", async context => {
  const snapshotBytes = await readFile(new URL("./canonical-env/author-snapshot.json", import.meta.url));
  assert.equal(createHash("sha256").update(snapshotBytes).digest("hex"), authorSnapshotSha256, "immutable snapshot identity");
  const snapshot: AuthorSnapshot = JSON.parse(snapshotBytes.toString("utf8"));
  authenticateCapturedAuthors(snapshot, oracleEvidenceBytes);
  const current = [];
  for (const [name, capturedSha256] of Object.entries(evidence.authorFilesSha256)) {
    const currentSha256 = createHash("sha256").update(await readFile(new URL(join("../metadata", name), import.meta.url))).digest("hex");
    current.push({ name, capturedSha256, currentSha256, unchangedSinceCapture: currentSha256 === capturedSha256 });
  }
  context.diagnostic(JSON.stringify({ capturedCommit: snapshot.commit, authenticatedArtifacts: current.length, currentAuthorState: current, note: "Current author edits are reported, not mistaken for corruption of immutable captured source." }));
});
