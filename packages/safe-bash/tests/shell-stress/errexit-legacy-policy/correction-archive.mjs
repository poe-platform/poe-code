import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isolatedSpawn } from "../process.ts";

const root = process.cwd();
const directory = dirname(fileURLToPath(import.meta.url));
const prefix = relative(root, directory);
const commit = "6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a";
const phase = process.argv[2];
assert.ok(["prepare", "run"].includes(phase));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024 });
const baseline = JSON.parse(readFileSync(resolve(directory, "acceptance-baseline.json")));
const targets = baseline.targets;
const prior = ["README.md", "capture.mjs", "evidence.json", "proposal.json"];
for (const name of prior) assert.deepEqual(readFileSync(resolve(directory, name)), git("show", `76d1dd7:${prefix}/${name}`));
for (const name of ["acceptance-README.md", "acceptance-actor.mjs", "acceptance-run.mjs", "acceptance-baseline.json", "acceptance-stop.json"]) assert.deepEqual(readFileSync(resolve(directory, name)), git("show", `5d59efc:${prefix}/${name}`));
assert.equal(hash(readFileSync(resolve(directory, "evidence.json"))), "064500b8dc1083be32e07f2fc4a67124600899fd37fd8e1abe42cc411d9f5ee8");
const output = resolve(directory, phase === "prepare" ? "correction-preparation.json" : "correction-results.json");
assert.equal(existsSync(output), false, "No overwrite or retry for green");
function publish(value) {
  const patch = `*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(value, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
  execFileSync("apply_patch", [patch], { maxBuffer: 1024 * 1024 });
}
function tree(directoryPath, name = "") {
  return readdirSync(directoryPath).sort().flatMap(entry => {
    const full = resolve(directoryPath, entry);
    const path = name ? `${name}/${entry}` : entry;
    const stat = lstatSync(full);
    return stat.isSymbolicLink() ? [[path, `symlink:${readlinkSync(full)}`]] : stat.isDirectory() ? tree(full, path) : [[path, hash(readFileSync(full))]];
  });
}
if (phase === "prepare") {
  const configPaths = git("ls-tree", "--name-only", commit).toString().trim().split("\n").filter(path => /^tsconfig.*\.json$/u.test(path));
  const paths = ["src", "package.json", "package-lock.json", ...configPaths];
  const entries = git("ls-tree", "-r", commit, "--", ...paths).toString().trim().split("\n").map(line => {
    const [metadata, path] = line.split("\t");
    const [mode, type, blob] = metadata.split(" ");
    assert.equal(type, "blob");
    assert.ok(["100644", "100755"].includes(mode));
    return { path, mode, blob };
  });
  const archive = mkdtempSync(resolve(directory, ".correction-archive-"));
  const tar = git("archive", "--format=tar", commit, "--", ...paths);
  execFileSync("/usr/bin/tar", ["-xf", "-", "-C", archive], { input: tar, timeout: 10000 });
  const committedInputs = Object.fromEntries(entries.map(entry => {
    const bytes = readFileSync(resolve(archive, entry.path));
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(blob, entry.blob, entry.path);
    return [entry.path, { blob, mode: entry.mode, sha256: hash(bytes) }];
  }));
  assert.equal(committedInputs["src/shell/runtime.ts"].sha256, "5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb");
  assert.equal(committedInputs["src/shell/parser.ts"].sha256, "10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e");
  const copiedInputs = {};
  for (const [path, digest] of Object.entries(baseline.guard.before).filter(([path]) => path.startsWith("tests/") && !path.startsWith(prefix + "/"))) {
    assert.ok(!path.includes("errexit-holdout") && !path.includes("errexit-consumer"));
    assert.equal(hash(readFileSync(path)), digest, `Frozen helper/input changed: ${path}`);
    mkdirSync(dirname(resolve(archive, path)), { recursive: true });
    copyFileSync(path, resolve(archive, path));
    copiedInputs[path] = digest;
  }
  const typecheck = `${prefix}/correction-typecheck.mjs`;
  mkdirSync(dirname(resolve(archive, typecheck)), { recursive: true });
  copyFileSync(typecheck, resolve(archive, typecheck));
  copiedInputs[typecheck] = hash(readFileSync(typecheck));
  symlinkSync(resolve(root, "node_modules"), resolve(archive, "node_modules"), "dir");
  const proof = { preparedAt: new Date().toISOString(), commit, archive, archiveTarSha256: hash(tar), committedInputs, copiedInputs, nativeProofSha256: hash(readFileSync(resolve(directory, "evidence.json"))), devtoolLink: { path: resolve(archive, "node_modules"), target: resolve(root, "node_modules"), manifest: Object.fromEntries(tree(resolve(root, "node_modules"))) }, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), node: { executable: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, baselineRole: "Prior live 172/175 and actor22 are preserved provenance, not archive tests or archive denominators." };
  publish(proof);
  console.log(JSON.stringify({ archive, sourceFiles: entries.filter(entry => entry.path.startsWith("src/")).length, copiedInputs: Object.keys(copiedInputs).length, archiveTarSha256: proof.archiveTarSha256 }));
} else {
  const preparation = JSON.parse(readFileSync(resolve(directory, "correction-preparation.json")));
  const archive = preparation.archive;
  assert.equal(hash(readFileSync(fileURLToPath(import.meta.url))), preparation.runnerSha256);
  for (const [path, input] of Object.entries(preparation.committedInputs)) assert.equal(hash(readFileSync(resolve(archive, path))), input.sha256, path);
  for (const [path, digest] of Object.entries(preparation.copiedInputs)) assert.equal(hash(readFileSync(resolve(archive, path))), digest, path);
  assert.deepEqual(Object.fromEntries(tree(resolve(root, "node_modules"))), preparation.devtoolLink.manifest);
  const originalAndCorrected = {};
  for (const path of targets) {
    const original = readFileSync(resolve(archive, path), "utf8");
    const corrected = readFileSync(path, "utf8");
    originalAndCorrected[path] = { original, originalSha256: hash(original), corrected, correctedSha256: hash(corrected) };
    copyFileSync(path, resolve(archive, path));
  }
  const before = Object.fromEntries(tree(archive));
  const runs = [];
  const evidence = { startedAt: new Date().toISOString(), commit, archive, preparationSha256: hash(readFileSync(resolve(directory, "correction-preparation.json"))), originalAndCorrected, before, runs };
  const loader = pathToFileURL(resolve(archive, "tests/shell/invocation-discovery-fixes-imports.mjs")).href;
  for (const [index, file] of targets.entries()) {
    const trace = resolve(archive, `.correction-imports-${index}.jsonl`);
    const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", file];
    const env = { ...process.env, NODE_OPTIONS: `--import=${loader}`, DISCOVERY_FIX_IMPORTS: trace };
    delete env.INVOCATION_EXPECT_BASELINE;
    delete env.NODE_PATH;
    const result = await isolatedSpawn(process.execPath, args, { cwd: archive, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    const imports = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    if (existsSync(trace)) unlinkSync(trace);
    const stdout = result.stdout.toString();
    runs.push({ file, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout, stderr: result.stderr.toString(), imports, counts: Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])) });
    if (result.status !== 0) break;
  }
  if (runs.length === 3 && runs.every(run => run.status === 0)) {
    const args = [`${prefix}/correction-typecheck.mjs`];
    const result = await isolatedSpawn(process.execPath, args, { cwd: archive, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" }, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    evidence.typecheck = { args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }
  const after = Object.fromEntries(tree(archive));
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const imports = runs.flatMap(run => run.imports);
  const mismatches = imports.filter(record => !record.path.startsWith(archive + "/") || before[relative(archive, record.path)] !== record.hash || after[relative(archive, record.path)] !== record.hash);
  const productLoads = imports.filter(record => record.path.startsWith(resolve(archive, "src") + "/"));
  const nonBlobLoads = productLoads.filter(record => preparation.committedInputs[relative(archive, record.path)]?.sha256 !== record.hash);
  const devtoolsUnchanged = JSON.stringify(Object.fromEntries(tree(resolve(root, "node_modules")))) === JSON.stringify(preparation.devtoolLink.manifest);
  const publicIndexLoaded = imports.some(record => record.path === resolve(archive, "src/index.ts"));
  evidence.after = after;
  evidence.guard = { changes, mismatches, nonBlobLoads, actualLoadCount: imports.length, productLoadCount: productLoads.length, publicIndexLoaded, devtoolsUnchanged, valid: changes.length === 0 && mismatches.length === 0 && nonBlobLoads.length === 0 && publicIndexLoaded && devtoolsUnchanged, limitation: "Committed source archive only. Before/load/after observations do not exclude transient mutation; foreign live source is deliberately neither overlaid nor accepted." };
  evidence.finishedAt = new Date().toISOString();
  publish(evidence);
  console.log(JSON.stringify({ runs: runs.map(({ file, status, counts }) => ({ file, status, counts })), typecheck: evidence.typecheck ? { status: evidence.typecheck.status } : null, guard: evidence.guard }, null, 2));
  assert.equal(evidence.guard.valid, true, "Archive provenance mismatch; stop without retry");
  assert.equal(runs.length, 3);
  assert.ok(runs.every(run => run.status === 0), "Unexpected functional failure; stop without retry");
}
