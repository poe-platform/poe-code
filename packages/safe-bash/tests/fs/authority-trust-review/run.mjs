import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../..");
const revision = "eab1d48a90456c1c2cdeb9289b32f1ed62429137";
const evidenceRevision = "1b0cbb96bebadb915809014207999799f4e9aa0c";
const authorDirectory = "tests/fs/mount/identity-compatibility-review/evidence/author-integration-eab1d48";
const fixture = "tests/fs/mount/identity-compatibility-review/compatibility.test.ts";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const save = (path, value) => writeFile(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
const statePath = join(owned, "evidence", "session.json");
await mkdir(join(owned, "evidence"), { recursive: true });
const mode = process.argv[2] ?? "original";
let state;

async function files(root, prefix = "") {
  const result = {};
  for (const entry of (await readdir(join(root, prefix))).sort()) {
    const path = join(prefix, entry);
    const stat = await lstat(join(root, path));
    assert.ok(!stat.isSymbolicLink(), `no live alias: ${path}`);
    if (stat.isDirectory()) Object.assign(result, await files(root, path));
    else result[path] = hash(await readFile(join(root, path)));
  }
  return result;
}

if (mode === "original") {
  const manifest = JSON.parse(git("show", `${evidenceRevision}:${authorDirectory}/manifest-before.json`));
  const after = JSON.parse(git("show", `${evidenceRevision}:${authorDirectory}/manifest-after.json`));
  assert.deepEqual(manifest.inputHashes, after.inputHashes);
  assert.equal(manifest.revision, revision);
  for (const ancestor of manifest.requiredAncestors) git("merge-base", "--is-ancestor", ancestor, revision);
  const scratch = await mkdtemp("/tmp/safe-bash-authority-fixed-");
  state = { revision, evidenceRevision, scratch, startedAt: new Date().toISOString(), node: process.version,
    movingHeadBefore: git("rev-parse", "HEAD").toString().trim(), movingStatusBefore: git("status", "--porcelain=v1").toString(),
    authorRecordedMovingHead: manifest.observedMovingHead, authorRecordedDirty: manifest.sourceWorktreeStatus,
    dirtyInputDelta: [], inputs: manifest.inputHashes, authorSourceSetSha256: manifest.sourceSetSha256 };
  for (const [path, expected] of Object.entries(manifest.inputHashes)) {
    const bytes = git("show", `${revision}:${path}`);
    assert.equal(hash(bytes), expected, `author closure mismatch: ${path}`);
    await mkdir(dirname(join(scratch, path)), { recursive: true });
    await writeFile(join(scratch, path), bytes);
  }
  const baselinePaths = [fixture, "tests/fs/webdav/mock.ts"];
  state.prequalification = Object.fromEntries(baselinePaths.map(path => {
    const before = git("show", `d799cbb:${path}`);
    const current = git("show", `${revision}:${path}`);
    return [path, { baselineRevision: "d799cbb", baselineSha256: hash(before), frozenSha256: hash(current), unchanged: before.equals(current) }];
  }));
  const lock = JSON.parse(await readFile(join(scratch, "package-lock.json"), "utf8"));
  assert.equal(hash(await readFile(join(repository, "package-lock.json"))), manifest.inputHashes["package-lock.json"]);
  await cp(join(repository, "node_modules"), join(scratch, "node_modules"), { recursive: true, dereference: true });
  state.dependencies = {};
  for (const path of Object.keys(lock.packages).filter(path => path.startsWith("node_modules/"))) {
    try {
      const installed = JSON.parse(await readFile(join(scratch, path, "package.json"), "utf8"));
      assert.equal(installed.version, lock.packages[path].version, path);
      state.dependencies[path] = installed.version;
    } catch (error) {
      if (error.code !== "ENOENT" || !lock.packages[path].optional) throw error;
    }
  }
  const dependencyFiles = await files(join(scratch, "node_modules"));
  state.dependencyFilesCount = Object.keys(dependencyFiles).length;
  state.dependencySetSha256 = hash(JSON.stringify(dependencyFiles));
  state.dependencyCopyCount = 1;
  state.noLiveSourceOrDependencySymlinks = true;
  state.fixtureImports = [...git("show", `${revision}:${fixture}`).toString().matchAll(/from "(\.[^"]+)"/g)].map(match => {
    const path = resolve(scratch, dirname(fixture), match[1]).replace(/\.js$/, ".ts");
    assert.ok(path.startsWith(`${scratch}/`));
    return path.slice(scratch.length + 1);
  });
  await save(statePath, state);
} else state = JSON.parse(await readFile(statePath, "utf8"));

async function checkInputs() {
  for (const [path, expected] of Object.entries(state.inputs)) {
    assert.equal(await realpath(join(state.scratch, path)), join(await realpath(state.scratch), path));
    assert.equal(hash(await readFile(join(state.scratch, path))), expected, path);
  }
}

async function run(name, args) {
  await checkInputs();
  const hashesOfTests = async () => Object.fromEntries(await Promise.all(args.filter(path => path.endsWith(".test.ts")).map(async path => [path, hash(await readFile(join(state.scratch, path)))])));
  const testHashesBefore = await hashesOfTests();
  const temporary = await mkdtemp("/tmp/safe-bash-authority-fixtures-");
  const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary };
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "AUDIT_CASE", "DIAGNOSTIC_MUTATION", "MOUNT_IDENTITY_REVIEW_EVIDENCE", "NATIVE_IDENTITY_REVIEW_EVIDENCE", "IDENTITY_EDGE_EVIDENCE"]) delete env[key];
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd: state.scratch, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false, outputExceeded = false;
  const stop = () => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 120000);
  child.stdout.on("data", data => { stdout += data; if (stdout.length > 4 * 1024 * 1024) { outputExceeded = true; stop(); } });
  child.stderr.on("data", data => { stderr += data; if (stderr.length > 4 * 1024 * 1024) { outputExceeded = true; stop(); } });
  const status = await new Promise((resolveStatus, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolveStatus({ code, signal })); });
  clearTimeout(timer);
  let residualGroup = false;
  try { process.kill(-child.pid, 0); residualGroup = true; stop(); } catch (error) { if (error.code !== "ESRCH") throw error; }
  await checkInputs();
  const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(stdout)?.[1] ?? -1)]));
  const executedTestHashes = await hashesOfTests();
  assert.deepEqual(executedTestHashes, testHashesBefore);
  const result = { name, command: [process.execPath, ...args], cwd: state.scratch, startedAt, finishedAt: new Date().toISOString(), ...status, executedTestHashes,
    counts, timedOut, outputExceeded, residualGroup, unchangedInputs: true, stdoutSha256: hash(stdout), stderrSha256: hash(stderr),
    tests: stdout.split("\n").filter(line => /^(?:ok|not ok) \d+ /.test(line)), temporaryFixturesRemoved: temporary };
  for (const extension of ["stdout", "stderr", "json"]) {
    const path = join(owned, "evidence", `${name}.${extension}`);
    try {
      const prior = await readFile(path);
      const retained = join(owned, "evidence", `${name}.prior-${hash(prior).slice(0, 12)}.${extension}`);
      await writeFile(retained, prior, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await save(join(owned, "evidence", `${name}.stdout`), stdout);
  await save(join(owned, "evidence", `${name}.stderr`), stderr);
  await rm(temporary, { recursive: true, force: true });
  await save(join(owned, "evidence", `${name}.json`), result);
  console.log(JSON.stringify(result));
  if (status.code !== 0 || timedOut || outputExceeded || residualGroup) process.exitCode = 1;
  return { result, stdout };
}

const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap"];
if (mode === "original" || mode === "original-run") {
  const { result, stdout } = await run("original43", [...testArgs, fixture]);
  const observations = stdout.split("\n").filter(line => line.startsWith('# {"case":')).map(line => JSON.parse(line.slice(2)));
  assert.equal(observations.filter(entry => entry.outcome?.status === "success").length, 38);
  await save("/tmp/safe-bash-authority-review-checkpoint.txt", `Independent first-fixed review, ${new Date().toISOString()}\nSource ${revision}; all 165 author input hashes match tracked commit, no dirty bytes consumed.\nAuthor dirty archive files excluded, not a clean live checkout. Dependencies copied once, no live aliases.\nOriginal43: ${JSON.stringify(result.counts)}; unchanged original38 positives and5 controls; no qualification delta.\nPrequalification fixture/helper comparison: ${JSON.stringify(state.prequalification)}\nNext: bounded12 compliant cases +2 separately counted boundary characterizations; no future public callback source, no tar/broad suites.\nDirect owner conversation unavailable; root handoff via this artifact.\n`);
} else if (mode === "review") {
  const target = join(state.scratch, "tests/fs/authority-trust-review");
  await mkdir(target, { recursive: true });
  for (const file of ["authority.test.ts", "boundary.test.ts"]) await cp(join(owned, file), join(target, file));
  await run("independent12", [...testArgs, "tests/fs/authority-trust-review/authority.test.ts"]);
  await run("boundary2", [...testArgs, "tests/fs/authority-trust-review/boundary.test.ts"]);
} else if (mode === "types") {
  await cp(join(owned, "tsconfig.json"), join(state.scratch, "authority-types.json"));
  await run("scoped-types", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "authority-types.json"]);
} else if (mode === "guards") {
  await run("original4", [...testArgs, "tests/fs/mount/copy-identity.test.ts"]);
  await run("required49", [...testArgs, "tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/overlay/copy-identity.test.ts"]);
} else if (mode === "build") {
  const configuration = git("show", `${revision}:tsconfig.build.json`);
  await writeFile(join(state.scratch, "tsconfig.build.json"), configuration);
  state.supplementalBuildInput = { revision, path: "tsconfig.build.json", sha256: hash(configuration) };
  await save(statePath, state);
  await run("source-build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]);
} else if (mode === "provenance") {
  await checkInputs();
  const references = [fixture, "tests/fs/webdav/mock.ts"];
  state.prequalificationLatest = Object.fromEntries(references.map(path => {
    const before = git("show", `b02bbe8:${path}`);
    const current = git("show", `${revision}:${path}`);
    return [path, { baselineRevision: "b02bbe8", baselineSha256: hash(before), frozenSha256: hash(current), unchanged: before.equals(current),
      deltaSha256: hash(git("diff", "b02bbe8", revision, "--", path)) }];
  }));
  assert.equal(state.prequalificationLatest[fixture].unchanged, true);
  assert.equal(state.prequalificationLatest["tests/fs/webdav/mock.ts"].unchanged, false);
  state.computedSourceSetSha256 = hash(JSON.stringify(Object.fromEntries(Object.entries(state.inputs).filter(([path]) => path.startsWith("src/")))));
  assert.equal(state.computedSourceSetSha256, state.authorSourceSetSha256);
  state.retainedAuthorEvidence = Object.fromEntries(["manifest-before.json", "manifest-after.json", "REPORT.md", "cleanup.json"].map(file => [file, hash(git("show", `${evidenceRevision}:${authorDirectory}/${file}`))]));
  await save(statePath, state);
} else if (mode === "cleanup") {
  await checkInputs();
  state.dependencySetUnchanged = hash(JSON.stringify(await files(join(state.scratch, "node_modules")))) === state.dependencySetSha256;
  assert.equal(state.dependencySetUnchanged, true);
  state.movingHeadAfter = git("rev-parse", "HEAD").toString().trim();
  state.movingStatusAfter = git("status", "--porcelain=v1").toString();
  state.movingSourceDifferences = {};
  for (const [path, expected] of Object.entries(state.inputs).filter(([path]) => path.startsWith("src/"))) {
    const current = hash(await readFile(join(repository, path)));
    if (current !== expected) state.movingSourceDifferences[path] = { fixed: expected, moving: current, classification: "not executed or accepted in this review" };
  }
  await rm(state.scratch, { recursive: true, force: true });
  state.scratchRemovedAt = new Date().toISOString();
  await save(statePath, state);
} else if (mode === "seal") {
  assert.ok(state.scratchRemovedAt, "clean up before sealing evidence");
  const manifest = await files(owned);
  delete manifest["MANIFEST.sha256"];
  await save(join(owned, "MANIFEST.sha256"), Object.entries(manifest).map(([path, digest]) => `${digest}  tests/fs/authority-trust-review/${path}`).join("\n") + "\n");
} else throw new Error(`Unknown mode ${mode}`);
