import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-C", repository, "-c", "core.fsmonitor=false", ...args],
    { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const binary = "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash";
const binarySha256 = "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c";
const manual = "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/doc/bashref.texi";
const sourcePaths = ["src/shell/runtime.ts", "src/shell/shell.ts", "src/shell/types.ts", "src/shell/parser.ts", "src/shell/cancellation.ts", "src/shell/getopts.ts"];
const fixturePaths = ["cases.json", "FREEZE.md", "run.mjs", "worker.mjs", "guard.mjs"];
const fingerprints = (root, names) => Object.fromEntries(names.map(name => [name, hash(fs.readFileSync(path.join(root, name)))]));
const statIdentity = filename => {
  const bytes = fs.readFileSync(filename);
  const stat = fs.statSync(filename);
  return { filename: fs.realpathSync(filename), sha256: hash(bytes), bytes: bytes.length, mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
};
const sealPath = path.join(own, "FREEZE.json");
if (process.argv[2] === "--seal") {
  assert.equal(fs.existsSync(sealPath), false);
  assert.equal(hash(fs.readFileSync(binary)), binarySha256);
  fs.writeFileSync(sealPath, JSON.stringify({ sealedAt: new Date().toISOString(), inspectedSourceCommit: git("rev-parse", "HEAD").toString().trim(),
    sourceBefore: fingerprints(repository, sourcePaths), fixtures: fingerprints(own, fixturePaths), binary: statIdentity(binary), node: statIdentity(process.execPath),
    primaryManual: { ...statIdentity(manual), sections: ["6.8 The Directory Stack", "6.8.1 Directory Stack Builtins", "5.2 DIRSTACK", "3.5.2 Tilde Expansion"],
      retrieval: "Local primary GNU Bash5.3 distribution manual; online web tool returned no content, curl HEAD timed out after 15 seconds; no copied GPL source or manual text" },
    selectedVirtualOrigin: "fd1daa123298568546d9ea4e95f8c81dde9c52ff",
    selectedVirtualReview: "7ca45f2decea9faab958b15577a55aac2be1c40c", packageSha256: "87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af",
    cases: 34, guestRunsBeforeSeal: 0, capturePolicy: "Observation capture, not guessed semantic acceptance; no retries; new policy requires root approval" }, null, 2) + "\n", { flag: "wx" });
  console.log(sealPath);
  process.exit(0);
}
const seal = JSON.parse(fs.readFileSync(sealPath, "utf8"));
assert.deepEqual(fingerprints(own, fixturePaths), seal.fixtures);
assert.deepEqual(fingerprints(repository, sourcePaths), seal.sourceBefore);
assert.deepEqual(statIdentity(binary), seal.binary);
assert.deepEqual(statIdentity(process.execPath), seal.node);
const freezeCommit = git("log", "-1", "--format=%H", "--", path.relative(repository, sealPath)).toString().trim();
assert.ok(freezeCommit);
assert.equal(hash(git("show", `${freezeCommit}:${path.relative(repository, sealPath)}`)), hash(fs.readFileSync(sealPath)));
const output = path.join(own, "observations-01.json.gz.base64");
assert.equal(fs.existsSync(output), false, "No overwrite or repeat observation run");
const compressed = Buffer.from(git("show", `${seal.selectedVirtualReview}:tests/shell/cancellation-stage2-independent-20260827/review-fd1/focused-02.json.gz.base64`).toString(), "base64");
assert.equal(hash(compressed), "0b8d23c455983c196f95d44334aca0300570150faf28e8cd361c24a44ef06cd1");
const accepted = JSON.parse(gunzipSync(compressed));
const tarball = Buffer.from(accepted.package.base64, "base64");
assert.equal(hash(tarball), seal.packageSha256);
const root = fs.realpathSync(fs.mkdtempSync("/tmp/safe-bash-directory-stack-design-"));
const directories = ["a/child", "b", "c", "home/one", "home-suffix", "with space", "ümlaut", "-dash", "+1"];
const prelude = "cat() { while IFS= read -r line; do printf '%s\\n' \"$line\"; done; }\n";
const capture = { startedAt: new Date().toISOString(), freezeCommit, seal, root, platform: { platform: os.platform(), arch: os.arch(), release: os.release() },
  native: [], virtual: [], identities: [], packageLoads: [], prelude, directChildren: 0 };
const run = (executable, args, cwd, env) => {
  const observed = spawnSync(executable, args, { cwd, env, input: "", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 128 * 1024 });
  capture.directChildren++;
  return { executable, args, cwd, env, status: observed.status, signal: observed.signal, error: observed.error ? { code: observed.error.code, message: observed.error.message } : null,
    stdoutBase64: observed.stdout.toString("base64"), stderrBase64: observed.stderr.toString("base64") };
};
const inventory = directory => {
  const entries = {};
  const walk = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name), key = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(filename);
      if (stat.isDirectory()) walk(filename, key);
      else { assert.ok(stat.isFile(), key); entries[key] = { sha256: hash(fs.readFileSync(filename)), bytes: stat.size }; }
    }
  };
  walk(directory, "");
  return entries;
};
try {
  const consumer = path.join(root, "consumer");
  const packageRoot = path.join(consumer, "node_modules/virtual-bash");
  fs.mkdirSync(packageRoot, { recursive: true });
  const extraction = spawnSync("/usr/bin/tar", ["-xz", "--strip-components=1", "-C", packageRoot], { input: tarball });
  assert.equal(extraction.status, 0, extraction.stderr.toString());
  capture.packageBefore = inventory(packageRoot);
  assert.equal(Object.keys(capture.packageBefore).length, 834);
  for (const [name, entry] of Object.entries(capture.packageBefore)) if (name.startsWith("dist/")) assert.equal(entry.sha256, accepted.emittedInventory[name.slice(5)].sha256);
  for (const name of ["worker.mjs", "guard.mjs"]) fs.copyFileSync(path.join(own, name), path.join(consumer, name));
  const baseEnv = { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root };
  capture.identities.push(run(binary, ["--noprofile", "--norc", "--version"], root, baseEnv));
  capture.identities.push(run(binary, ["--noprofile", "--norc", "-c", "printf '%s\\n' \"$BASH_VERSION\" \"$MACHTYPE\" \"$OSTYPE\"", "directory-stack-identity"], root, baseEnv));
  assert.ok(capture.identities.every(identity => identity.status === 0 && !identity.signal && !identity.error));
  const cases = JSON.parse(fs.readFileSync(path.join(own, "cases.json"), "utf8")).cases;
  assert.equal(cases.length, 34);
  for (const fixture of cases) {
    const fixtureRoot = path.join(root, fixture.id);
    fs.mkdirSync(fixtureRoot);
    for (const directory of directories) fs.mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "file"), "sentinel\n");
    fs.symlinkSync("a", path.join(fixtureRoot, "link"));
    const source = prelude + fixture.source;
    const native = run(binary, ["--noprofile", "--norc", "-c", source, "directory-stack-probe"], fixtureRoot,
      { ...baseEnv, HOME: `${fixtureRoot}/home`, ROOT: fixtureRoot, PWD: fixtureRoot, OLDPWD: fixtureRoot });
    capture.native.push({ id: fixture.id, ...native, stdoutNormalized: Buffer.from(native.stdoutBase64, "base64").toString().replaceAll(fixtureRoot, "/fixture"),
      stderrNormalized: Buffer.from(native.stderrBase64, "base64").toString().replaceAll(fixtureRoot, "/fixture") });
    assert.equal(native.error, null);
    assert.equal(native.signal, null);
    const configPath = path.join(root, `${fixture.id}.json`), guardPath = path.join(root, `${fixture.id}-guard.json`), log = path.join(root, `${fixture.id}-loads.jsonl`);
    fs.writeFileSync(configPath, JSON.stringify({ id: fixture.id, source, directories }));
    const hashes = Object.fromEntries(Object.entries(capture.packageBefore).map(([name, entry]) => [path.join(packageRoot, name), entry.sha256]));
    hashes[path.join(consumer, "worker.mjs")] = seal.fixtures["worker.mjs"];
    fs.writeFileSync(guardPath, JSON.stringify({ hashes, log }));
    const execution = run(process.execPath, ["--unhandled-rejections=strict", "--import", path.join(consumer, "guard.mjs"), path.join(consumer, "worker.mjs"), configPath], consumer,
      { ...baseEnv, DIRSTACK_GUARD: guardPath });
    const record = { id: fixture.id, ...execution };
    capture.virtual.push(record);
    assert.equal(execution.error, null);
    assert.equal(execution.signal, null);
    assert.equal(execution.status, 0, Buffer.from(execution.stderrBase64, "base64").toString());
    record.observed = JSON.parse(Buffer.from(execution.stdoutBase64, "base64").toString());
    assert.equal(record.observed.disposed, true);
    record.loads = fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    for (const entry of record.loads) assert.equal(entry.sha256, hashes[entry.filename]);
    record.productLoads = record.loads.filter(entry => entry.filename.startsWith(packageRoot + "/")).length;
    record.stdout = Buffer.from(record.observed.stdoutBase64 ?? "", "base64").toString();
    record.stderr = Buffer.from(record.observed.stderrBase64 ?? "", "base64").toString();
    record.stdoutAndStatusMatchNative = record.stdout === capture.native.at(-1).stdoutNormalized && record.observed.exitCode === native.status;
    record.stderrExactAfterRootNormalization = record.stderr === capture.native.at(-1).stderrNormalized;
  }
  capture.packageAfter = inventory(packageRoot);
  assert.deepEqual(capture.packageAfter, capture.packageBefore);
  capture.completed = true;
} catch (error) {
  capture.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  capture.sourceAfter = fingerprints(repository, sourcePaths);
  capture.binaryAfter = statIdentity(binary);
  capture.nodeAfter = statIdentity(process.execPath);
  fs.rmSync(root, { recursive: true, force: true });
  capture.temporaryRemoved = !fs.existsSync(root);
  capture.finishedAt = new Date().toISOString();
  capture.sourceUnchanged = JSON.stringify(capture.sourceAfter) === JSON.stringify(seal.sourceBefore);
  capture.binaryUnchanged = JSON.stringify(capture.binaryAfter) === JSON.stringify(seal.binary);
  capture.nodeUnchanged = JSON.stringify(capture.nodeAfter) === JSON.stringify(seal.node);
  const bytes = gzipSync(JSON.stringify(capture), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: capture.completed ?? false, failure: capture.failure,
    nativeCases: capture.native.length, virtualCases: capture.virtual.length, directChildren: capture.directChildren, temporaryRemoved: capture.temporaryRemoved,
    sourceUnchanged: capture.sourceUnchanged, binaryUnchanged: capture.binaryUnchanged }, null, 2));
}
