import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, unlinkSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { isolatedSpawn } from "../process.ts";

const root = process.cwd();
const directory = dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2];
assert.ok(["baseline", "corrected"].includes(phase));
const output = resolve(directory, `acceptance-${phase}.json`);
assert.equal(existsSync(output), false, "Evidence must not be overwritten or retried for green");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const sourceCommit = "6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a";
const targets = ["tests/shell/invocation-modes.test.ts", "tests/shell/unsupported-options.test.ts", "tests/shell/script-entrypoint.test.ts"];
const immutable = ["README.md", "capture.mjs", "evidence.json", "proposal.json"];
const oldEvidence = JSON.parse(readFileSync(resolve(directory, "evidence.json")));
for (const name of immutable) assert.deepEqual(readFileSync(resolve(directory, name)), execFileSync("git", ["show", `76d1dd7:tests/shell-stress/errexit-legacy-policy/${name}`]));
assert.equal(hash(readFileSync("src/shell/runtime.ts")), "5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb");
assert.equal(hash(readFileSync("src/shell/parser.ts")), "10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e");
assert.equal(git("diff", sourceCommit, "--", "src/shell", "src/contracts"), "");
if (phase === "baseline") for (const path of targets) assert.equal(hash(readFileSync(path)), oldEvidence.originals[path].sha256);
const dependencies = new Set();
function dependency(path) {
  if (dependencies.has(path)) return;
  assert.ok(!path.includes("errexit-holdout") && !path.includes("errexit-consumer"), "Hidden fixture access prohibited");
  dependencies.add(path);
  if (!/\.(?:ts|mjs|js)$/u.test(path)) return;
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  function follow(specifier) {
    if (!specifier.startsWith(".")) return;
    const candidate = resolve(dirname(path), specifier);
    const actual = candidate.endsWith(".js") && existsSync(candidate.slice(0, -3) + ".ts") ? candidate.slice(0, -3) + ".ts" : candidate;
    if (existsSync(actual)) dependency(relative(root, actual));
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) follow(node.moduleSpecifier.text);
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0])) follow(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const path of [...targets, "tests/shell/invocation-discovery-fixes-imports.mjs", relative(root, fileURLToPath(import.meta.url)), relative(root, resolve(directory, "acceptance-actor.mjs"))]) dependency(path);
function tree(path) {
  return readdirSync(path).sort().flatMap(name => {
    const file = `${path}/${name}`;
    const stat = lstatSync(file);
    return stat.isSymbolicLink() ? [[file, `symlink:${readlinkSync(file)}`]] : stat.isDirectory() ? tree(file) : [[file, hash(readFileSync(file))]];
  });
}
function snapshot() {
  return Object.fromEntries([...tree("src"), ...tree("node_modules"), ...[...dependencies, "package.json", "package-lock.json", "tsconfig.json", ...immutable.map(name => relative(root, resolve(directory, name)))].map(path => [path, hash(readFileSync(path))]), ["/bin/bash", hash(readFileSync("/bin/bash"))]].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
const before = snapshot();
if (phase === "corrected") {
  const baseline = JSON.parse(readFileSync(resolve(directory, "acceptance-baseline.json")));
  assert.equal(baseline.guard.valid, true);
  for (const [path, digest] of Object.entries(baseline.guard.before).filter(([path]) => path.startsWith("src/"))) assert.equal(before[path], digest, `Source changed between phases: ${path}`);
}
const evidence = { phase, sourceCommit, startedAt: new Date().toISOString(), headBefore: git("rev-parse", "HEAD"), workspaceStatusBefore: git("status", "--short"), nativeProofSha256: hash(readFileSync(resolve(directory, "evidence.json"))), targets, originalInputs: Object.fromEntries(targets.map(path => [path, { sha256: hash(readFileSync(path)), gitBlob: git("hash-object", path), text: readFileSync(path, "utf8") }])), runs: [] };
const loader = pathToFileURL(resolve("tests/shell/invocation-discovery-fixes-imports.mjs")).href;
for (const [index, file] of targets.entries()) {
  const trace = resolve(directory, `.acceptance-${phase}-${index}.jsonl`);
  assert.equal(existsSync(trace), false);
  const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", file];
  const result = await isolatedSpawn(process.execPath, args, { cwd: root, env: { ...process.env, NODE_OPTIONS: `--import=${loader}`, DISCOVERY_FIX_IMPORTS: trace }, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  const imports = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  if (existsSync(trace)) unlinkSync(trace);
  const stdout = result.stdout.toString();
  evidence.runs.push({ file, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout, stderr: result.stderr.toString(), imports, counts: Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])), outcomes: [...stdout.matchAll(/^(ok|not ok) (\d+) - (.+)$/gmu)].map(match => ({ pass: match[1] === "ok", number: Number(match[2]), name: match[3] })) });
}
if (phase === "baseline") {
  const trace = resolve(directory, ".acceptance-actor.jsonl");
  const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", resolve(directory, "acceptance-actor.mjs")], { cwd: root, env: { ...process.env, NODE_OPTIONS: `--import=${loader}`, DISCOVERY_FIX_IMPORTS: trace }, timeout: 10000, maxBuffer: 256 * 1024 });
  const imports = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  if (existsSync(trace)) unlinkSync(trace);
  evidence.actor = { pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, imports, stderr: result.stderr.toString(), observed: result.status === 0 ? JSON.parse(result.stdout.toString()) : result.stdout.toString() };
}
const after = snapshot();
const changed = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]).map(path => [path, { before: before[path] ?? null, after: after[path] ?? null }]));
const records = [...evidence.runs.flatMap(run => run.imports), ...(evidence.actor?.imports ?? [])];
const importMismatches = records.filter(record => {
  const path = record.path.startsWith(root + "/") ? relative(root, record.path) : record.path;
  return before[path] !== record.hash || after[path] !== record.hash;
});
evidence.guard = { before, after, changed, actualLoadCount: records.length, importMismatches, valid: Object.keys(changed).length === 0 && importMismatches.length === 0 && records.some(record => record.path.endsWith("/src/shell/runtime.ts")), limitation: "Before/load/after point observations, not protection against transient write/revert or a clean aggregate claim. Unowned dirty root export state is recorded and never modified by this leaf." };
evidence.finishedAt = new Date().toISOString();
evidence.headAfter = git("rev-parse", "HEAD");
const patch = `*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(evidence, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
const saved = spawnSync("apply_patch", [patch], { encoding: "utf8", maxBuffer: 1024 * 1024 });
assert.equal(saved.status, 0, saved.stderr);
console.log(JSON.stringify({ phase, runs: evidence.runs.map(({ file, counts, status, outcomes }) => ({ file, counts, status, failures: outcomes.filter(row => !row.pass) })), guard: { valid: evidence.guard.valid, changed, actualLoadCount: records.length, importMismatches }, actor: evidence.actor ? { status: evidence.actor.status, rows: evidence.actor.observed.rows?.length } : null }, null, 2));
assert.equal(evidence.guard.valid, true, "STOP: source/input drift or unguarded actual import; no retry for green");
