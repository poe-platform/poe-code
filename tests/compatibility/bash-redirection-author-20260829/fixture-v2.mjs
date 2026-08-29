import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const captured = JSON.parse(fs.readFileSync(path.join(own, "PREPARATION-ROOT.json"))).root;
fs.writeFileSync(path.join(captured, "fixture-v2-start.json"), JSON.stringify({ role: "SOURCE_DATA_FIXTURE_CORRECTION_ONLY", executions: 0 }), { flag: "wx" });
try {
  assert.deepEqual(process.argv.slice(2), ["--prepare-unexecuted"]);
  const source = fs.readFileSync(path.join(own, "redirections.mjs"), "utf8");
  const executor = JSON.parse(fs.readFileSync(path.join(own, "EXECUTOR.json")));
  const hash = text => createHash("sha256").update(text).digest("hex");
  assert.equal(hash(source), executor.files.find(row => row.path.endsWith("bash-redirection-author-20260829/redirections.mjs")).sha256);
  const corrections = [
    ["assert.deepEqual((await memory.readdir(\"/\")).sort(), Object.keys(row.files ?? {}).sort());", "assert.deepEqual((await memory.readdir(\"/\")).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))), Object.keys(row.files ?? {}).sort().map(name => ({ name, type: \"file\" })));"] ,
    ["assert.deepEqual(await memory.readdir(\"/\"), [\"first\"]);", "assert.deepEqual(await memory.readdir(\"/\"), [{ name: \"first\", type: \"file\" }]);"]
  ];
  let revised = source;
  for (const [before, after] of corrections) { assert.equal(revised.split(before).length, 2); revised = revised.replace(before, after); }
  let reverted = revised; for (const [before, after] of corrections) reverted = reverted.replace(after, before); assert.equal(reverted, source);
  const patch = `*** Begin Patch\n*** Add File: ${path.join(own, "redirections-v2.mjs")}\n${revised.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch`;
  const result = spawnSync("apply_patch", [patch], { encoding: "utf8", maxBuffer: 1048576, timeout: 10000 });
  fs.writeFileSync(path.join(captured, "fixture-v2-edit.json"), JSON.stringify({ code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }), { flag: "wx" });
  assert.equal(result.status, 0); assert.equal(result.signal, null);
  const receipt = { role: "UNEXECUTED_TEST_ONLY_V2_REQUIRES_DIFFERENT_REVIEW", originalSha256: hash(source), revisedSha256: hash(revised), originalBytes: Buffer.byteLength(source), revisedBytes: Buffer.byteLength(revised), corrections, allOtherBytesIdenticalAfterReversion: true, productTree: "ed0e0d09cf71bed7f4aee075750b60a30df4ef52", packageSha256: "e0e63b0319f0b7b77e68a6e6284021bd747c60ce9f93291a5090048fa835e296", productChanges: 0, executions: 0 };
  fs.writeFileSync(path.join(own, "FIXTURE-v2.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(captured, "fixture-v2-result.json"), JSON.stringify(receipt, null, 2), { flag: "wx" }); console.log(JSON.stringify(receipt));
} catch (error) { fs.writeFileSync(path.join(captured, "fixture-v2-error.json"), JSON.stringify({ error: String(error), stack: error.stack }), { flag: "wx" }); throw error; }
