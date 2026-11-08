import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { isolatedSpawn } from "../process.ts";

const root = process.cwd();
const owned = "tests/shell-stress/canonical-profile-migration";
const commit = "6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a";
const targets = ["tests/shell/invocation-discovery-fixes.test.ts", "tests/shell-stress/differential.test.ts", "tests/shell-stress/current-gaps/compatibility.test.ts", "tests/shell-stress/invocation-closure/holdout.test.ts"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024 });
function publish(name, value) {
  const output = `${owned}/${name}`;
  assert.equal(existsSync(output), false, "Evidence must not be overwritten");
  execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(value, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`], { maxBuffer: 1024 * 1024 });
}
function tree(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap(name => {
    const path = resolve(directory, name);
    const key = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    return stat.isSymbolicLink() ? [[key, `symlink:${readlinkSync(path)}`]] : stat.isDirectory() ? tree(path, key) : [[key, hash(readFileSync(path))]];
  });
}
const report = JSON.parse(readFileSync("tests/integration/full-gate-20260827/evidence/classification.json"));
const failures = report.failures.filter(row => targets.includes(row.path));
assert.equal(failures.length, 27);
const inputs = new Set();
function dependency(path) {
  if (inputs.has(path)) return;
  assert.ok(!/canonical-profile-review|errexit-holdout|errexit-consumer/u.test(path), "Hidden controls prohibited");
  inputs.add(path);
  if (!/\.(?:ts|mjs|js)$/u.test(path)) return;
  const parsed = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".")) {
      const candidate = resolve(dirname(path), node.moduleSpecifier.text);
      const actual = candidate.endsWith(".js") && existsSync(candidate.slice(0, -3) + ".ts") ? candidate.slice(0, -3) + ".ts" : candidate;
      const child = relative(root, actual);
      if (!child.startsWith("src/")) dependency(child);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}
for (const path of [...targets, "tests/shell-stress/virtual-child.ts", "tests/shell-stress/invocation-closure/probe.ts", "tests/shell-stress/invocation-modes/trace.mjs", "tests/shell/invocation-discovery-fixes-imports.mjs", "tests/shell/invocation-discovery-fixes-native.json", "tests/shell-stress/invocation-closure/native-preparation.json", "tests/fixtures/shell-cases.json"]) dependency(path);
const originals = {};
for (const path of inputs) {
  const bytes = readFileSync(path);
  assert.deepEqual(bytes, git("show", `${commit}:${path}`), `Input changed since source checkpoint: ${path}`);
  originals[path] = { sha256: hash(bytes), blob: git("hash-object", path).toString().trim(), text: bytes.toString() };
}
const archive = mkdtempSync(resolve(owned, ".source-6e-"));
const archivePaths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
const tar = git("archive", "--format=tar", commit, "--", ...archivePaths);
execFileSync("/usr/bin/tar", ["-xf", "-", "-C", archive], { input: tar, timeout: 10000 });
const source = {};
for (const line of git("ls-tree", "-r", commit, "--", ...archivePaths).toString().trim().split("\n")) {
  const [metadata, path] = line.split("\t");
  const [mode, type, blob] = metadata.split(" ");
  assert.equal(type, "blob");
  const bytes = readFileSync(resolve(archive, path));
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), blob);
  source[path] = { mode, blob, sha256: hash(bytes) };
}
for (const path of [...inputs, `${owned}/product-cohort.mjs`]) {
  mkdirSync(dirname(resolve(archive, path)), { recursive: true });
  copyFileSync(path, resolve(archive, path));
}
symlinkSync(resolve(root, "node_modules"), resolve(archive, "node_modules"), "dir");
const profiles = [
  { id: "GNU5.3-primary", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", sha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { id: "Bash3.2-historical", executable: "/bin/bash", sha256: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
];
for (const profile of profiles) assert.equal(hash(readFileSync(profile.executable)), profile.sha256);
const manifest = { preparedAt: new Date().toISOString(), sourceCommit: commit, archive, archiveTarSha256: hash(tar), source, originals, failures, routingCount: { quoted: "27 canonical historicalprofile failures +2truthfulclassification assertions", enumerated: { discovery: 16, strictNative: 9, truthfulRegistry: 2, total: 27, historicalOnly: 25 }, reconciliation: "The category table contains 27 total, not 29. No two additional rows exist in the named categories." }, profiles, devtools: Object.fromEntries(tree(resolve(root, "node_modules"))), node: { version: process.version, executable: process.execPath, sha256: hash(readFileSync(process.execPath)) }, gitHead: git("rev-parse", "HEAD").toString().trim(), nativeUtilities: Object.fromEntries(["/bin/cat", "/usr/bin/head"].filter(existsSync).map(path => [path, hash(readFileSync(path))])) };
publish("inputs.json", manifest);
const before = Object.fromEntries(tree(archive));
const { differentialCases, syntaxCases } = await import(pathToFileURL(resolve(archive, "tests/shell-stress/cases.ts")));
const { additionalCases } = await import(pathToFileURL(resolve(archive, "tests/shell-stress/current-gaps/cases.ts")));
const cohorts = [["differential", differentialCases], ["syntax", syntaxCases], ["current-gaps", additionalCases]];
const native = { startedAt: new Date().toISOString(), profiles, parentUmask: process.umask(), protocols: { original: "--noprofile --norc -c EXACT_SCRIPT shell-stress", proposed: "--noprofile --norc -c EXACT_SCRIPT shell" }, rows: [] };
function snapshot(directory, prefix = "") {
  const files = {};
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    const key = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert.ok(stat.isFile() || stat.isDirectory());
    files[key] = { type: stat.isDirectory() ? "directory" : "file", mode: stat.mode, ...(stat.isFile() ? { hex: readFileSync(path).toString("hex") } : {}) };
    if (stat.isDirectory()) Object.assign(files, snapshot(path, key));
  }
  return files;
}
for (const profile of profiles) {
  const version = await isolatedSpawn(profile.executable, ["--version"], { cwd: archive, env: { LC_ALL: "C", LANG: "C", PATH: "/usr/bin:/bin" }, timeout: 1500, maxBuffer: 65536 });
  profile.version = version.stdout.toString();
  for (const invocationName of ["shell-stress", "shell"]) for (const [cohort, fixtures] of cohorts) for (const fixture of fixtures) {
    const directory = mkdtempSync(resolve(owned, ".native-"));
    try {
      for (const [name, contents] of Object.entries(fixture.initialFiles ?? {})) {
        const path = resolve(directory, name);
        assert.ok(path.startsWith(directory + "/"));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
      }
      const initial = snapshot(directory);
      const env = { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C", LC_ALL: "C", TZ: "UTC", ...fixture.env };
      const args = ["--noprofile", "--norc", "-c", fixture.script, invocationName];
      const result = await isolatedSpawn(profile.executable, args, { cwd: directory, env, input: fixture.stdin ?? "", timeout: 1500, maxBuffer: 65536 });
      native.rows.push({ profile: profile.id, cohort, name: fixture.name, invocationName, source: fixture.script, sourceSha256: hash(fixture.script), inputHex: Buffer.from(fixture.stdin ?? "").toString("hex"), args, cwd: directory, env, before: initial, after: snapshot(directory), status: result.status, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex"), pid: result.pid, signal: result.signal, error: result.error?.message ?? null });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  assert.equal(hash(readFileSync(profile.executable)), profile.sha256);
}
native.finishedAt = new Date().toISOString();
publish("native.json", native);
const loader = pathToFileURL(resolve(archive, "tests/shell/invocation-discovery-fixes-imports.mjs")).href;
async function child(label, args, timeout) {
  const trace = resolve(archive, `.profile-${label}.jsonl`);
  const result = await isolatedSpawn(process.execPath, args, { cwd: archive, env: { ...process.env, NODE_OPTIONS: `--import=${loader}`, DISCOVERY_FIX_IMPORTS: trace }, timeout, maxBuffer: 4 * 1024 * 1024 });
  const imports = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  if (existsSync(trace)) unlinkSync(trace);
  return { label, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, pid: result.pid, stdout: result.stdout.toString(), stderr: result.stderr.toString(), imports };
}
const product = await child("product-cohort", ["--import", "tsx", `${owned}/product-cohort.mjs`], 60000);
const runs = [];
for (const [index, path] of targets.entries()) {
  const result = await child(`test-${index}`, ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", path], 60000);
  runs.push({ path, ...result, counts: Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])) });
}
const after = Object.fromEntries(tree(archive));
const imports = [product, ...runs].flatMap(run => run.imports);
const mismatches = imports.filter(row => !row.path.startsWith(archive + "/") || before[relative(archive, row.path)] !== row.hash || after[relative(archive, row.path)] !== row.hash);
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
const guard = { changed, mismatches, actualLoadCount: imports.length, actualRootIndexLoads: imports.filter(row => row.path === resolve(archive, "src/index.ts")).length, devtoolsUnchanged: JSON.stringify(manifest.devtools) === JSON.stringify(Object.fromEntries(tree(resolve(root, "node_modules")))), originalInputsUnchanged: [...inputs].every(path => hash(readFileSync(path)) === originals[path].sha256), qualification: "Archive before/load/after checks. Some unchanged legacy child harnesses scrub NODE_OPTIONS; actual tracing is complete for the new all-input product actor, not claimed for every legacy child. No live source accepted." };
publish("product.json", { completedAt: new Date().toISOString(), archive, before, after, product, runs, guard });
console.log(JSON.stringify({ nativeRows: native.rows.length, nativeErrors: native.rows.filter(row => row.error || row.signal).length, productStatus: product.status, runs: runs.map(({ path, counts }) => ({ path, counts })), guard }, null, 2));
