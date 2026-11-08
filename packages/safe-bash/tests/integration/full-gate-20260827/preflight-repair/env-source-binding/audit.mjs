import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const output = resolve(process.argv[2] ?? ""); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const scope = "tests/integration/full-gate-20260827/combined-b494675c";
const before = "b494675c34dc289f4ad4b10a9201e1211eb0a7d8", after = "84ab66ca717e0dff21abf57051b41cb553f3c7f3";
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const source = (revision, path) => {
  const listed = git("ls-tree", revision, "--", path).toString().trim();
  if (!listed) return { path, present: false };
  return { path, present: true, blob: git("rev-parse", `${revision}:${path}`).toString().trim(), sha256: sha256(git("show", `${revision}:${path}`)) };
};
assert.equal(git("rev-parse", `${after}^`).toString().trim(), before);
const sources = [before, after].map(revision => ({ revision, files: ["src/commands/execution.ts", "src/commands/env-split.ts"].map(path => source(revision, path)) }));
assert.equal(sources[0].files[1].present, false); assert.equal(sources[1].files[1].present, true);
const expected = sources[0].files[0].sha256;
const manifestPath = `${scope}/EVIDENCE_MANIFEST.json`, manifest = JSON.parse(readFileSync(join(root, manifestPath)));
const captures = [], processes = [];
for (const entry of manifest.captures.filter(entry => entry.key.startsWith("canonical/imports/test/"))) {
  const stored = readFileSync(join(root, scope, entry.path)); assert.equal(sha256(stored), entry.storedSha256);
  const raw = entry.encoding === "identity" ? stored : gunzipSync(Buffer.from(stored.toString().trim(), "base64"));
  assert.equal(raw.length, entry.originalBytes); assert.equal(sha256(raw), entry.originalSha256);
  captures.push({ key: entry.key, storedSha256: entry.storedSha256, originalSha256: entry.originalSha256 });
  const rows = raw.toString().trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const inputs = rows.filter(row => /\/tests\/(?:shell\/env-split-(?:native|host)\.test\.ts|shell-stress\/env-split-author\/resume-host\.ts)$/u.test(row.resolved));
  if (!inputs.length) continue;
  assert.equal(inputs.length, 1);
  const input = inputs[0], sourceRoot = input.resolved.slice(0, input.resolved.indexOf("/tests/"));
  const relative = input.resolved.slice(sourceRoot.length + 1);
  assert.equal(input.sha256, source(before, relative).sha256);
  const kind = relative.endsWith("resume-host.ts") ? "host-leaf" : relative.endsWith("native.test.ts") ? "native-test" : "host-wrapper";
  const critical = rows.filter(row => /\/(?:src|dist)\/commands\/(?:execution|env-split)\.(?:ts|js)$/u.test(row.resolved));
  assert.equal(critical.length, kind === "host-wrapper" ? 0 : 1);
  for (const record of critical) {
    assert.equal(record.resolved, `${sourceRoot}/src/commands/execution.ts`);
    assert.equal(record.sha256, expected);
  }
  processes.push({ capture: entry.key, kind, input, critical });
}
assert.equal(captures.length, 716); assert.equal(processes.length, 27);
for (const [kind, count] of [["host-leaf", 25], ["native-test", 1], ["host-wrapper", 1]]) assert.equal(processes.filter(entry => entry.kind === kind).length, count);
const importGuardPath = `${scope}/import-guard.mjs`, guard = readFileSync(join(root, importGuardPath), "utf8");
assert.match(guard, /registerHooks\(\{ resolve\(/u); assert.doesNotMatch(guard, /\bload\s*\(/u);
const delta = git("diff", "--name-only", before, after, "--", "src").toString().trim().split("\n");
assert.deepEqual(delta, ["src/commands/env-split.ts", "src/commands/execution.ts"]);
const oldSource = git("show", `${before}:src/commands/execution.ts`).toString();
assert.ok(oldSource.includes('options(args, "iu:0C:"'));
const report = { date: new Date().toISOString(), scope: "Read-only forensic audit of own frozen gate; no product/native execution or new independent acceptance.", sources, implementationParent: before, sourceDelta: delta,
  oldCapability: "env option parser accepts iu:0C:, not S; env-split.ts is absent", importManifest: { path: manifestPath, sha256: sha256(readFileSync(join(root, manifestPath))) },
  loader: { path: importGuardPath, sha256: sha256(guard), stage: "resolve-only", loadStageRecorded: false }, authenticatedCaptures: captures, envProcesses: processes,
  conclusions: { mismatchedResolvedExecutionBytes: 0, resolvedOldExecutionCount: 26, envParserResolutions: 0, hostWrapperProductResolutions: 0,
    limitation: "Resolution-time raw-byte hashes match b494; these are not returned-loader/transformed-byte hashes. No retroactive load-stage proof claimed." }, filesChanged: 0, productTests: 0 };
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ authenticatedImportCaptures: captures.length, envProcesses: processes.length, oldExecutionMatches: 26, sourceSelection: "implementation immediate parent", loadStageRecorded: false, output }));
