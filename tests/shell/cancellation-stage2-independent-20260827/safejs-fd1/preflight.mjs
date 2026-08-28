import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const prefix = "tests/integration/owned-output-production-rebase/author-public";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["safejs-execution-v1/private-guard.mjs", "harness/common.mjs", "harness/safejs-binding.mjs", "profiles/REFERENCES.json", "profiles/SAFEJS.json"];
const read = name => readFileSync(path.join(repository, prefix, name));
const inputs = Object.fromEntries(names.map(name => [name, hash(read(name))]));
const frozen = JSON.parse(read("safejs-execution-v1/EXECUTION-INPUTS.json"));
assert.equal(inputs["safejs-execution-v1/private-guard.mjs"], frozen.files.find(entry => entry.path === "private-guard.mjs").sha256);
for (const name of names) {
  const relative = `${prefix}/${name}`;
  const committed = spawnSync("git", ["--no-replace-objects", "show", `HEAD:${relative}`], { cwd: repository, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(committed.status, 0);
  assert.equal(hash(committed.stdout), inputs[name]);
}
const output = path.join(own, "private-preflight-01.json.gz.base64");
assert.equal(existsSync(output), false);
const result = { capturedAt: new Date().toISOString(), source: "fd1daa123298568546d9ea4e95f8c81dde9c52ff exact selected reconstruction", inputs, guestRuns: 0, engineCopies: 0 };
const { privateSnapshot, verifyPrivatePrecondition } = await import(pathToFileURL(path.join(repository, prefix, "safejs-execution-v1/private-guard.mjs")).href);
const { expectedPrivateProfile } = await import(pathToFileURL(path.join(repository, prefix, "harness/safejs-binding.mjs")).href);
try {
  result.expected = expectedPrivateProfile();
  assert.equal(result.expected.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
  result.before = privateSnapshot();
  verifyPrivatePrecondition(result.before);
  result.precondition = "PASS";
} catch (error) {
  result.precondition = "NONPASS_NO_GUEST";
  result.failure = { message: error.message, name: error.name };
  process.exitCode = 1;
} finally {
  try {
    result.after = privateSnapshot();
    assert.deepEqual(result.after, result.before);
    result.privateBeforeAfter = "EXACTLY_UNCHANGED";
    for (const name of names) assert.equal(hash(read(name)), inputs[name]);
  } catch (error) { result.integrityFailure = { message: error.message, name: error.name }; process.exitCode = 1; }
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ precondition: result.precondition, privateBeforeAfter: result.privateBeforeAfter,
    failure: result.failure, integrityFailure: result.integrityFailure, guestRuns: 0, engineCopies: 0,
    output, sha256: hash(bytes) }, null, 2));
}
