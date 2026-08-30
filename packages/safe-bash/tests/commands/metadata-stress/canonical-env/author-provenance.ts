import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const authorSnapshotSha256 = "1cb5fdacdb9ef0afa9ad211a92e42bb05f57eb043992b46e6b32f6a633307f8a";

export interface AuthorSnapshot {
  commit: string;
  oracleEvidenceSha256: string;
  files: Record<string, { path: string; blob: string; sha256: string; text: string }>;
}

export function authenticateCapturedAuthors(snapshot: AuthorSnapshot, oracleEvidence: Uint8Array): void {
  const evidence: { initialHead: string; authorFilesSha256: Record<string, string> } = JSON.parse(Buffer.from(oracleEvidence).toString("utf8"));
  assert.equal(createHash("sha256").update(oracleEvidence).digest("hex"), snapshot.oracleEvidenceSha256, "captured oracle evidence identity");
  assert.match(snapshot.commit, /^[0-9a-f]{40}$/u);
  assert.equal(snapshot.commit, evidence.initialHead, "original recorded source commit");
  assert.deepEqual(Object.keys(snapshot.files).sort(), Object.keys(evidence.authorFilesSha256).sort());
  assert.equal(Object.keys(snapshot.files).length, 7);
  for (const [name, expected] of Object.entries(evidence.authorFilesSha256)) {
    const captured = snapshot.files[name]!;
    const bytes = Buffer.from(captured.text, "utf8");
    assert.equal(captured.path, `tests/commands/metadata/${name}`);
    assert.match(expected, /^[0-9a-f]{64}$/u);
    assert.equal(captured.sha256, expected, `${name}: unchanged handoff hash`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `${name}: immutable source bytes`);
    assert.match(captured.blob, /^[0-9a-f]{40}$/u);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), captured.blob, `${name}: Git blob identity`);
  }
}
