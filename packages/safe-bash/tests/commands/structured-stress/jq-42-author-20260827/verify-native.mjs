import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { captureCase, invokeNative, executable, sha256, environment } from "../independent-increment/native.mjs";

const directory = "tests/commands/structured-stress/jq-42-author-20260827";
const captureLegacyFiles = vector => {
  const temporary = mkdtempSync(resolve(directory, ".native-"));
  try {
    for (const [name, hex] of Object.entries(vector.files)) {
      assert.match(name, /^[a-z][a-z0-9.-]*$/u);
      writeFileSync(resolve(temporary, name), Buffer.from(hex, "hex"), { flag: "wx" });
    }
    const result = spawnSync(executable, vector.argv, { cwd: temporary, env: { ...environment, HOME: temporary }, input: Buffer.from(vector.inputHex, "hex"), shell: false, timeout: 2000, maxBuffer: 65536 });
    assert.equal(result.signal, null);
    assert.equal(result.error, undefined);
    return { expected: { status: result.status, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") } };
  } finally { rmSync(temporary, { recursive: true }); }
};
const save = (filename, data) => {
  if (process.argv.includes("--verify")) return;
  const path = `${directory}/${filename}`;
  assert.equal(existsSync(path), false);
  const content = JSON.stringify(data, null, 2);
  assert.equal(spawnSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${path}\n${content.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 1024 * 1024 }).status, 0);
};
const before = JSON.parse(readFileSync(`${directory}/native-before.json`, "utf8"));
const followup = JSON.parse(readFileSync(`${directory}/native-followup.json`, "utf8"));
const legacy = JSON.parse(readFileSync(`${directory}/legacy-current.json`, "utf8"));
const version = await invokeNative(["--version"]);
const build = await invokeNative(["--build-configuration"]);
assert.equal(sha256(readFileSync(executable)), before.executableSha256);
assert.equal(Buffer.from(version.stdoutHex, "hex").toString().trim(), before.version);
const cohorts = [{ name: "whole frozen cohorts", vectors: before.cases }, { name: "author controls", vectors: before.regressions }, { name: "followup controls", vectors: followup.cases }, ...legacy.cohorts.map(cohort => ({ name: cohort.filename, vectors: cohort.rows.map(row => row.vector) }))];
const results = [];
for (const cohort of cohorts) {
  let invocations = 0;
  for (const vector of cohort.vectors) {
    const specification = vector.stages ? { ...vector, stages: vector.stages.map(stage => stage.argv) } : vector;
    const actual = vector.files && Object.keys(vector.files).some(name => !/^[a-z]+\.txt$/u.test(name)) ? captureLegacyFiles(vector) : await captureCase(specification);
    for (const field of ["status", "stdoutHex", "stderrHex"]) assert.equal(actual.expected[field], vector.expected[field], `${cohort.name}:${vector.id}:${field}`);
    invocations += vector.stages?.length ?? 1;
  }
  results.push({ name: cohort.name, cases: cohort.vectors.length, invocations, exact: cohort.vectors.length });
}
save("native-reverification.json", { at: new Date().toISOString(), executable, executableSha256: sha256(readFileSync(executable)), version, build, cohorts: results, metadataInvocations: 2, note: "Cohorts overlap; do not sum as unique coverage. Oracle expectations are compared, never replaced." });
const references = [];
for (const resource of ["https://jqlang.org/manual/v1.7/", ...["builtin.c", "builtin.jq", "jv_unicode.c", "jv_parse.c", "main.c", "util.c"].map(file => `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/${file}`)]) {
  const response = await fetch(resource);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  references.push({ resource, status: response.status, bytes: bytes.length, sha256: sha256(bytes) });
}
save("primary-references.json", { at: new Date().toISOString(), references, purpose: "Primary jq 1.7 manual and tagged source investigation of literal decimal preservation, join, UTF8 replacement grouping, JSON string validation, per-input status aggregation, line metadata and NUL boundaries. Apple native bytes remain the exact oracle." });
const { createStructuredCommands, MemoryFileSystem, toByteSource } = await import("../../../../dist/index.js");
const selected = ["recover-following-json", "raw-surrogate", "raw-file-utf8-boundary", "json-low-surrogate-escape", "conversion-large-token", "preserve-through-copy"];
const runtime = Object.fromEntries(readdirSync("src/commands/structured").sort().map(name => [name, sha256(readFileSync(`src/commands/structured/${name}`))]));
const built = [];
for (const id of selected) {
  const vector = before.cases.find(vector => vector.id === id);
  assert.ok(vector);
  const fs = new MemoryFileSystem();
  for (const [path, hex] of Object.entries(vector.files ?? {})) await fs.writeFile(`/${path}`, Buffer.from(hex, "hex"));
  const chunks = { stdout: [], stderr: [] };
  const sink = name => ({ async write(bytes) { chunks[name].push(Buffer.from(bytes)); assert.ok(Buffer.concat(chunks[name]).length < 65536); } });
  const result = await createStructuredCommands()[0].execute({ command: "jq", args: vector.argv, stdin: toByteSource(Buffer.from(vector.inputHex, "hex")), stdinIsDefault: false, stdout: sink("stdout"), stderr: sink("stderr"), fs, cwd: "/", env: {}, signal: AbortSignal.timeout(2000) });
  const actual = { status: result.exitCode, stdoutHex: Buffer.concat(chunks.stdout).toString("hex"), stderrHex: Buffer.concat(chunks.stderr).toString("hex") };
  for (const field of ["status", "stdoutHex", "stderrHex"]) assert.equal(actual[field], vector.expected[field], `${id}:${field}`);
  built.push({ id, actual });
}
save("built-checks.json", { at: new Date().toISOString(), sourceHashes: runtime, cases: built, pass: built.length });
console.log({ native: results, built: built.length, primaryReferences: references.length });
