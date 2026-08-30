import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const revision = "eab1d48a90456c1c2cdeb9289b32f1ed62429137";
const fixture = "tests/fs/mount/identity-compatibility-review/compatibility.test.ts";
const helper = "tests/fs/webdav/mock.ts";
const evidence = join(owned, "evidence");
const hash = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const patch = text => execFileSync("apply_patch", [], { cwd: repository, input: text });
const save = (name, value) => writeFile(join(evidence, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const frozen = JSON.parse(git("show", "7a7562fe:tests/fs/authority-trust-review/evidence/session.json"));
const originalManifest = git("show", "7a7562fe:tests/fs/authority-trust-review/MANIFEST.sha256").toString();
const originalFiles = originalManifest.trimEnd().split("\n").map(line => ({ path: line.slice(66), sha256: line.slice(0, 64) }));
originalFiles.push({ path: "tests/fs/authority-trust-review/MANIFEST.sha256", sha256: hash(originalManifest) });
async function immutableOriginal() {
  for (const entry of originalFiles) assert.equal(hash(await readFile(join(repository, entry.path))), entry.sha256, entry.path);
}
async function tree(root, prefix = "") {
  const entries = {};
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = join(prefix, name);
    const stat = await lstat(join(root, path));
    assert.ok(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) Object.assign(entries, await tree(root, path));
    else { assert.ok(stat.isFile()); entries[path] = hash(await readFile(join(root, path))); }
  }
  return entries;
}
await immutableOriginal();
await mkdir(evidence);
const scratch = await mkdtemp("/tmp/safe-bash-helper-control-");
const nativeRoot = await mkdtemp("/tmp/safe-bash-helper-fixtures-");
const results = [];
const state = { revision, scratch, nativeRoot, startedAt: new Date().toISOString(), movingHeadBefore: git("rev-parse", "HEAD").toString().trim(),
  movingStatusBefore: git("status", "--porcelain=v1").toString(), inputs: frozen.inputs, sourceSetSha256: frozen.computedSourceSetSha256, node: process.version, variants: {} };
let currentHelper = frozen.inputs[helper];
async function integrity() {
  const actual = {};
  for (const [path, expected] of Object.entries(frozen.inputs)) {
    assert.equal(await realpath(join(scratch, path)), join(await realpath(scratch), path));
    actual[path] = hash(await readFile(join(scratch, path)));
    assert.equal(actual[path], path === helper ? currentHelper : expected, path);
  }
  return { sourceSetSha256: hash(JSON.stringify(Object.fromEntries(Object.entries(actual).filter(([path]) => path.startsWith("src/"))))),
    helperSha256: actual[helper], fixtureSha256: actual[fixture], inputsChecked: Object.keys(actual).length,
    allOther164InputsUnchanged: true, inputSetSha256: hash(JSON.stringify(actual)), noLiveAliases: true };
}
async function run(name, args) {
  const before = await integrity();
  const env = { ...process.env, TMPDIR: nativeRoot, TMP: nativeRoot, TEMP: nativeRoot };
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "AUDIT_CASE", "DIAGNOSTIC_MUTATION", "MOUNT_IDENTITY_REVIEW_EVIDENCE", "NATIVE_IDENTITY_REVIEW_EVIDENCE", "IDENTITY_EDGE_EVIDENCE"]) delete env[key];
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd: scratch, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false, outputExceeded = false;
  const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, 120000);
  child.stdout.on("data", data => { stdout += data; if (stdout.length > 4 * 1024 * 1024) { outputExceeded = true; kill(); } });
  child.stderr.on("data", data => { stderr += data; if (stderr.length > 4 * 1024 * 1024) { outputExceeded = true; kill(); } });
  const status = await new Promise((accept, reject) => { child.once("error", reject); child.once("close", (code, signal) => accept({ code, signal })); });
  clearTimeout(timer);
  let residualGroup = false;
  try { process.kill(-child.pid, 0); residualGroup = true; kill(); } catch (error) { if (error.code !== "ESRCH") throw error; }
  const cases = stdout.split("\n").filter(line => /^(?:ok|not ok) \d+ - /.test(line)).map(line => ({ name: line.replace(/^(?:ok|not ok) \d+ - /, ""), pass: line.startsWith("ok ") }));
  const originalCases = cases.filter(entry => !entry.name.endsWith(".test.ts"));
  const count = selected => ({ executed: selected.length, pass: selected.filter(entry => entry.pass).length, fail: selected.filter(entry => !entry.pass).length });
  const webdav = originalCases.filter(entry => /webdav/.test(entry.name));
  const result = { name, command: [process.execPath, ...args], cwd: scratch, startedAt, finishedAt: new Date().toISOString(), ...status, timedOut, outputExceeded, residualGroup,
    before, after: await integrity(), rawNodeCounts: Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(stdout)?.[1] ?? -1)])),
    originalCases: count(originalCases), webdavPositives: count(webdav.filter(entry => !entry.name.startsWith("paired "))), webdavControls: count(webdav.filter(entry => entry.name.startsWith("paired "))),
    cases, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  assert.deepEqual(result.before, result.after);
  await save(`${name}.stdout`, stdout); await save(`${name}.stderr`, stderr); await save(`${name}.json`, result);
  results.push(result);
  console.log(JSON.stringify({ name, ...status, originalCases: result.originalCases, webdavPositives: result.webdavPositives, webdavControls: result.webdavControls }));
  assert.ok(!timedOut && !outputExceeded && !residualGroup);
  if (name.startsWith("baseline")) assert.equal(status.code, 0);
}
try {
  for (const [path, expected] of Object.entries(frozen.inputs)) {
    const bytes = git("show", `${revision}:${path}`);
    assert.equal(hash(bytes), expected, path);
    await mkdir(dirname(join(scratch, path)), { recursive: true });
    await writeFile(join(scratch, path), bytes);
  }
  assert.equal(hash(git("show", "cd8b5c8:src/contracts/filesystem.md")), frozen.inputs["src/contracts/filesystem.md"]);
  assert.equal(hash(await readFile(join(repository, "package-lock.json"))), frozen.inputs["package-lock.json"]);
  await cp(join(repository, "node_modules"), join(scratch, "node_modules"), { recursive: true, dereference: true });
  const dependencies = await tree(join(scratch, "node_modules"));
  state.dependencyCopyCount = 1; state.dependencyFiles = Object.keys(dependencies).length; state.dependencySetSha256 = hash(JSON.stringify(dependencies));
  assert.equal(state.dependencySetSha256, frozen.dependencySetSha256, "dependency bytes differ from prior verified snapshot");
  const lock = JSON.parse(await readFile(join(scratch, "package-lock.json")));
  state.dependencyVersions = {};
  for (const path of Object.keys(lock.packages).filter(path => path.startsWith("node_modules/"))) {
    try {
      const installed = JSON.parse(await readFile(join(scratch, path, "package.json")));
      assert.equal(installed.version, lock.packages[path].version); state.dependencyVersions[path] = installed.version;
    } catch (error) { if (error.code !== "ENOENT" || !lock.packages[path].optional) throw error; }
  }
  const config = JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/fs/**/*.ts", "src/contracts/**/*.ts", fixture], exclude: [] }, null, 2) + "\n";
  patch(`*** Begin Patch\n*** Add File: ${join(scratch, "helper-types.json")}\n${config.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
  state.typeConfigSha256 = hash(config);
  for (const variant of ["d799cbb", "a0e598b^", "a0e598b", "b02bbe8", "8c863cd^", "8c863cd", "eab1d48"]) {
    state.variants[variant] = { commit: git("rev-parse", variant).toString().trim(), helperSha256: hash(git("show", `${variant}:${helper}`)), fixtureSha256: hash(git("show", `${variant}:${fixture}`)) };
  }
  assert.equal(state.variants["8c863cd^"].helperSha256, state.variants.b02bbe8.helperSha256);
  assert.equal(state.variants["a0e598b^"].helperSha256, state.variants.d799cbb.helperSha256);
  for (const [name, start, end] of [["identity-introduction", "a0e598b^", "a0e598b"], ["forwarding-change", "8c863cd^", "8c863cd"]]) {
    const diff = git("diff", start, end, "--", helper).toString(); await save(`${name}.diff`, diff);
  }
  state.imports = [...git("show", `${revision}:${fixture}`).toString().matchAll(/from "(\.[^"]+)"/g)].map(match => {
    const path = resolve(scratch, dirname(fixture), match[1]).replace(/\.js$/, ".ts"); assert.ok(path.startsWith(`${scratch}/`)); return path.slice(scratch.length + 1);
  });
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", fixture];
  const typeArgs = ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "helper-types.json"];
  await run("baseline43", testArgs); await run("baseline-types", typeArgs);
  for (const variant of ["b02bbe8", "d799cbb"]) {
    const previous = (await readFile(join(scratch, helper), "utf8")).trimEnd().split("\n");
    const next = git("show", `${variant}:${helper}`).toString();
    patch(`*** Begin Patch\n*** Update File: ${join(scratch, helper)}\n@@\n${previous.map(line => `-${line}`).join("\n")}\n${next.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
    currentHelper = hash(next);
    await run(`${variant}-43`, testArgs); await run(`${variant}-types`, typeArgs);
  }
} finally {
  state.results = results.map(({ cases, ...result }) => result);
  state.dependenciesUnchanged = hash(JSON.stringify(await tree(join(scratch, "node_modules")))) === state.dependencySetSha256;
  await immutableOriginal(); state.original48Unchanged = true;
  state.movingHeadAfter = git("rev-parse", "HEAD").toString().trim(); state.movingStatusAfter = git("status", "--porcelain=v1").toString();
  await rm(scratch, { recursive: true, force: true }); await rm(nativeRoot, { recursive: true, force: true });
  state.scratchRemoved = true; state.finishedAt = new Date().toISOString();
  await save("provenance.json", state);
}
