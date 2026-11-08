import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repository = "/Users/kjopek/Workspace/safe-bash";
const evidence = join(repository, "tests/integration/qualified-current-release-review/execution-evidence");
const originDirectory = "/private/tmp/safe-bash-current-webdav-consumer-blocker-stage-lXZn5P";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const patch = execFileSync("/usr/bin/which", ["apply_patch"], { encoding: "utf8" }).trim();
const save = (name, value) => {
  const target = join(evidence, name);
  assert.equal(existsSync(target), false);
  const text = JSON.stringify(value, null, 2);
  execFileSync(patch, [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${target}\n${text.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 4 * 1024 * 1024 });
};
const expected = {
  "v2-baseline-canonical-path.json": "2456c05a349fe5391bb4bcf98018bcdb7c7a9ef2f7b10887346d9ee39b837ddc",
  "v2-protocol-controls.json": "545787c89c5b3a7312741af9127b0b39ee4e57ee782f23f772d24767ccbee201",
  "v2-owned-copy-consumer-diagnostic.json": "6c622dbaba65a3b5325c7bcae8aaa7eb596070264ccbbf5f682de6686ba2b676",
  "baseline.json": null,
  "protocol-controls.json": null,
  "v2-diagnostic-summary.json": null,
};
const provenance = [];
for (const [name, pin] of Object.entries(expected)) {
  const origin = join(originDirectory, name);
  const bytes = readFileSync(origin);
  const sha256 = digest(bytes);
  if (pin) assert.equal(sha256, pin);
  const envelope = { origin, provenance: "Other agent76944 read-only diagnostic on f12141d, not independent current02 execution. Never overlaid or executed here.", bytes: bytes.length, sha256, encoding: "base64", content: bytes.toString("base64") };
  assert.equal(digest(Buffer.from(envelope.content, "base64")), sha256);
  save(`other-agent-webdav/exact-bytes/${name}`, envelope);
  const firstCopy = join(evidence, "other-agent-webdav", name);
  provenance.push({ name, origin, sha256, archivedEnvelope: `other-agent-webdav/exact-bytes/${name}`, firstTextCopySha256: existsSync(firstCopy) ? digest(readFileSync(firstCopy)) : null, expectedSha256: pin });
}
save("other-agent-webdav/provenance.json", { status: "exact-byte-envelopes-verified", provenance, scope: "The first three v2 raw JSON copies also match byte-for-byte. First baseline text copy gained a trailing newline through apply_patch and is retained as an explicitly nonidentical first archive attempt, not used as authenticated raw input. Decode exact-byte envelope content to recover original bytes. Earlier baseline permission-path failure and observer-only consumed-stream failure remain preserved; no new product tests.", correctedHarnessSha256: digest(readFileSync(new URL(import.meta.url))) });
console.log(JSON.stringify({ archived: provenance.length, exactByteRoundtrip: true }));
