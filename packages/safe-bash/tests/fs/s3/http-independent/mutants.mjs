import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2]);
const setup = JSON.parse(readFileSync(join(directory, "prepare.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const target = mkdtempSync(join(directory, "mutation-source-"));
cpSync(join(setup.source, "src"), join(target, "src"), { recursive: true });
cpSync(join(setup.source, "tests/fs/s3/http-independent"), join(target, "tests/fs/s3/http-independent"), { recursive: true });
cpSync(join(setup.source, "package.json"), join(target, "package.json"));
symlinkSync(join(process.cwd(), "node_modules"), join(target, "node_modules"), "dir");
const mutants = [
  { name: "restore endpoint backslash normalization", file: "transport.ts", before: String.raw`[^\\/?#]`, after: String.raw`[^/?#]`, test: "endpoint origin validation", failed: 2 },
  { name: "accept trailing hyphen XML comments", file: "xml.ts", before: ' || comment.endsWith("-")', after: "", test: "invalid XML comment is rejected", failed: 2 },
  { name: "claim unverified conditional PUT", file: "transport.ts", before: 'boolean(verified?.put, false, "verifiedConditionalOperations.put")', after: 'boolean(verified?.put, true, "verifiedConditionalOperations.put")', test: "conditional capability", failed: 1 },
  { name: "reuse caller-owned upload buffer", file: "transport.ts", before: "const body = new Uint8Array(input.Body);", after: "const body = input.Body;", test: "PUT snapshots", failed: 1 },
  { name: "remove bounded GET quota", file: "transport.ts", before: "Body: limitedBody(response, maxGet, expected)", after: "Body: limitedBody(response, Number.MAX_SAFE_INTEGER, expected)", test: "GET quota", failed: 2 },
];
const results = [];
for (const mutant of mutants) {
  const filename = join(target, "src/fs/s3/http", mutant.file);
  const original = readFileSync(filename, "utf8");
  assert.equal(original.split(mutant.before).length, 2, mutant.name);
  const line = original.split("\n").find(line => line.includes(mutant.before));
  const changed = line.replace(mutant.before, mutant.after);
  const patch = (before, after) => execFileSync("apply_patch", [], { cwd: target, input: `*** Begin Patch\n*** Update File: ${filename}\n@@\n-${before}\n+${after}\n*** End Patch\n`, encoding: "utf8" });
  patch(line, changed);
  try {
    const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-name-pattern", mutant.test, "tests/fs/s3/http-independent/protocol.test.ts", "tests/fs/s3/http-independent/lifecycle.test.ts"];
    const result = spawnSync(process.execPath, args, { cwd: target, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    const row = { ...mutant, args, originalSha256: hash(original), mutatedSha256: hash(readFileSync(filename)), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
    results.push(row); writeFileSync(join(directory, "mutants.json"), JSON.stringify(results, null, 2));
    assert.equal(result.status, 1, mutant.name); assert.match(result.stdout, new RegExp(`# fail ${mutant.failed}\\b`));
  } finally { patch(changed, line); assert.equal(hash(readFileSync(filename)), hash(original)); }
}
for (const [path, expected] of Object.entries(setup.sourceHashes)) assert.equal(hash(readFileSync(join(setup.source, path))), expected);
console.log(JSON.stringify(results.map(row => ({ name: row.name, failed: row.failed, killed: row.status === 1 })), null, 2));
