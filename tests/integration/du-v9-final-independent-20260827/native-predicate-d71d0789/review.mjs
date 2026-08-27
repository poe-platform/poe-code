import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const owned = dirname(fileURLToPath(import.meta.url));
export const repository = "/Users/kjopek/Workspace/safe-bash";
export const freeze = "1b2ddea9e38b25cc91134a2f35a318e27f4d7c29";
export const candidate = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
export const overlay = "d71d0789410a907107a8ab75d15cf93ddd8fe0e5";
export const basePath = "tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92";
export const bundlePath = "tests/integration/du-overlay-independent-20260827/v9-native-predicate-overlay-20260827";
export const report = "d53b003b9e7a20a3a593378a9b7a9ed8e896c493";
export const reportPath = "tests/integration/du-v9-final-independent-20260827/lineage-overlay-0bd5a1f3";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export const identity = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes), gitBlob: blob(bytes) });
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const save = (path, value) => writeFile(join(owned, path), typeof value === "string" || Buffer.isBuffer(value) ? value : json(value), { flag: "wx" });
export const git = args => execFileSync("/usr/bin/git", args, { cwd: repository, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
export const gitBytes = (revision, path) => git(["show", `${revision}:${path}`]);
export const sort = records => [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));

export async function inventory(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.notEqual(entry.name, "AGENTS.md");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        assert(entry.isFile());
        records.push(identity(relative(root, path), await readFile(path)));
      }
    }
  }
  await visit(root);
  return sort(records);
}

async function tree(revision, root) {
  const paths = git(["ls-tree", "-r", "--name-only", revision, "--", root]).toString().trim().split("\n");
  const records = paths.map(path => identity(path.slice(root.length + 1), gitBytes(revision, path)));
  assert.deepEqual(await inventory(join(repository, root)), records);
  return { revision, root, records };
}

async function preservedSeal(revision, root, name) {
  const bytes = gitBytes(revision, `${root}/${name}`);
  assert.deepEqual(await readFile(join(repository, root, name)), bytes);
  const manifest = JSON.parse(bytes);
  for (const entry of manifest.files) {
    const actual = identity(entry.path, await readFile(join(repository, root, entry.path)));
    assert.equal(actual.bytes, entry.bytes);
    assert.equal(actual.sha256, entry.sha256);
    if (entry.gitBlob) assert.equal(actual.gitBlob, entry.gitBlob);
  }
  return { revision, root, manifest: identity(name, bytes), filesVerified: manifest.files.length + 1 };
}

export async function authenticate() {
  const oracleConfig = JSON.parse(await readFile(join(repository, basePath, "config/oracle-identity.json")));
  const tools = {};
  for (const [name, requested] of [["node", process.execPath], ["git", "/usr/bin/git"], ["native", oracleConfig.realpath]]) {
    const path = await realpath(requested);
    tools[name] = { requested, path, sha256: hash(await readFile(path)) };
  }
  assert.equal(tools.native.sha256, "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b");
  assert.equal(process.version, "v22.22.2");
  for (const key of ["NODE_OPTIONS", "NODE_PATH"]) assert(!process.env[key], `unexpected ambient ${key}`);
  for (const revision of [freeze, candidate, overlay, report]) assert.equal(git(["rev-parse", `${revision}^{commit}`]).toString().trim(), revision);
  const base = await tree(freeze, basePath);
  const bundle = await tree(overlay, bundlePath);
  assert.equal(base.records.length, 23);
  assert.equal(bundle.records.length, 7);
  const manifestBytes = gitBytes(overlay, `${bundlePath}/manifest.json`);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.base.freezeCommit, freeze);
  assert.equal(manifest.base.candidateCommit, candidate);
  assert.equal(base.records.find(entry => entry.path === "MANIFEST.json").sha256, manifest.base.manifest.sha256);
  assert.equal(manifest.base.manifest.sha256, "474a95bd160636cdbabe03943a0a84aaaeb56d04ab87d25915bb1ac8cbdf9fa2");
  assert.deepEqual(base.records.find(entry => entry.path === "native-env.mjs"), manifest.changedFile.base);
  for (const entry of [...manifest.bundleFiles, manifest.patch]) assert.deepEqual(bundle.records.find(row => row.path === entry.path), entry);
  for (const entry of manifest.unchangedInputs) assert.deepEqual(base.records.find(row => row.path === entry.path), entry);
  for (const key of ["verdict", "rawTable"]) {
    const expected = manifest.captureProvenance[key];
    const bytes = gitBytes(report, expected.path);
    assert.deepEqual(identity(expected.path, bytes), { path: expected.path, bytes: expected.bytes, sha256: expected.sha256, gitBlob: expected.gitBlob });
    assert.deepEqual(await readFile(join(repository, expected.path)), bytes);
  }
  const raw = JSON.parse(gitBytes(report, manifest.captureProvenance.rawTable.path));
  assert.deepEqual(raw.summary, { total: 16, matched: 13, mismatched: 3 });
  for (const binding of manifest.rawCaptureBindings) {
    const row = raw.records.find(entry => entry.id === binding.id);
    assert.deepEqual(row.args, binding.argv);
    assert.deepEqual(row.env, binding.env);
    assert.equal(row.observed.status, 1);
    assert.equal(row.observed.stdout, "");
    const bytes = Buffer.from(row.observed.stderr);
    assert.equal(bytes.length, 40);
    assert.equal(bytes.toString("hex"), manifest.diagnostic.hex);
    assert.equal(hash(bytes), "927dbaaabbcd6f07c69e90d54e68af1d9f353275c4455837191ea77460d77009");
  }
  const baseBytes = gitBytes(freeze, `${basePath}/native-env.mjs`);
  const oldExpression = "/invalid.*block|block.*invalid/iu.test(stderr)";
  const newExpression = 'stderr === "du: invalid -B argument \'invalid-value\'\\n"';
  assert.equal(baseBytes.toString().split(oldExpression).length, 2);
  const patched = Buffer.from(baseBytes.toString().replace(oldExpression, newExpression));
  assert.deepEqual(identity("native-env.mjs", patched), manifest.changedFile.overlay);
  assert.equal(patched.toString().replace(newExpression, oldExpression), baseBytes.toString());
  const patch = gitBytes(overlay, `${bundlePath}/${manifest.patch.path}`).toString();
  const changedLines = patch.split("\n").filter(line => /^[+-]/u.test(line) && !/^[+-]{3}/u.test(line));
  assert.equal(changedLines.length, 2);
  assert.equal(changedLines[0].slice(1).replace(oldExpression, newExpression), changedLines[1].slice(1));
  const preserved = [
    await preservedSeal("b3f45fa796282ef644729af36f9d41fc37693bd8", "tests/integration/du-v9-final-independent-20260827", "EVIDENCE_MANIFEST.json"),
    await preservedSeal(report, reportPath, "EVIDENCE-MANIFEST.json"),
  ];
  const supervisor = base.records.find(entry => entry.path === "harness/process-manager.mjs");
  return { tools, nodeVersion: process.version, base, bundle, manifest, manifestIdentity: identity("manifest.json", manifestBytes), candidate, candidateTree: git(["rev-parse", `${candidate}^{tree}`]).toString().trim(), supervisor, preserved, exactOneExpressionChanged: true, allOtherDriverBytesIdentical: true, patchedBytesSha256: hash(patched), historicalNativeSummary: raw.summary };
}

async function prepare() {
  const pre = await authenticate();
  await save("PRE.json", pre);
  await save("PRE-index.data", git(["diff", "--cached", "--binary"]));
  const cleanup = JSON.parse(gitBytes(report, `${reportPath}/CLEANUP.json`));
  const archive = await readFile(join(repository, reportPath, cleanup.archive.path));
  assert.equal(hash(archive), cleanup.archive.sha256);
  const prefix = `replay-once/bootstrap-scratch/extracted/${basePath}/`;
  const archived = gunzipSync(archive).toString().trim().split("\n").map(line => JSON.parse(line)).filter(entry => entry.path.startsWith(prefix));
  assert.equal(archived.length, 23);
  const lineage = JSON.parse(gitBytes(report, `${reportPath}/PRE.json`)).delta.changedFile.overlay;
  const expected = pre.base.records.map(entry => entry.path === lineage.path ? lineage : entry);
  const selected = ["native-env.mjs", "harness/process-manager.mjs", "config/oracle-identity.json", "fixtures/native-env-cases.json"];
  const restored = [];
  for (const entry of archived) {
    const path = entry.path.slice(prefix.length);
    const bytes = Buffer.from(entry.base64, "base64");
    const actual = identity(path, bytes);
    assert.deepEqual(actual, expected.find(row => row.path === path));
    if (!selected.includes(path)) continue;
    const target = join(owned, "runtime", path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    restored.push(actual);
  }
  assert.equal(restored.length, 4);
  await save("RUNTIME-BEFORE-PATCH.json", { sourceArchive: identity(cleanup.archive.path, archive), archivedFixtureFilesVerified: 23, preservedLineageHarness: lineage, selectedRuntimeFiles: sort(restored), excludedTypescriptAndUnneededFamilyFiles: true, nativeBaseVerifiedAgainstOriginalManifest: true });
  const patchPath = join(repository, bundlePath, pre.manifest.patch.path);
  const directory = relative(repository, join(owned, "runtime"));
  const commands = [];
  for (const args of [["apply", "--check", `--directory=${directory}`, patchPath], ["apply", `--directory=${directory}`, patchPath]]) {
    git(args);
    commands.push({ command: "/usr/bin/git", args, status: 0 });
  }
  const after = await inventory(join(owned, "runtime"));
  assert.deepEqual(after, sort(restored.map(entry => entry.path === "native-env.mjs" ? pre.manifest.changedFile.overlay : entry)));
  await save("RUNTIME-AFTER-PATCH.json", { commands, files: after, nativeOverlayCommit: overlay, manifestIdentity: pre.manifestIdentity, baseManifestDoesNotAuthenticatePatchedNative: true });
  await save("patched-native-env.mjs.data", await readFile(join(owned, "runtime/native-env.mjs")));
  const files = [];
  for (const path of ["review.mjs", "run.mjs", "PRE.json", "RUNTIME-BEFORE-PATCH.json", "RUNTIME-AFTER-PATCH.json"]) files.push(identity(path, await readFile(join(owned, path))));
  await save("EXECUTION-PRE.json", { at: new Date().toISOString(), files });
  process.stdout.write("Static accepted: exact one-expression delta; 40-byte captured diagnostic; four authenticated native-only runtime files; no TypeScript or product materialization.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "prepare") await prepare();
  else if (process.argv[2] === "post") {
    const post = await authenticate();
    assert.deepEqual(post, JSON.parse(await readFile(join(owned, "PRE.json"))));
    await save("POST.json", post);
    await save("POST-index.data", git(["diff", "--cached", "--binary"]));
    process.stdout.write("POST matches PRE; immutable fixtures, overlays, tools, captures and both historical evidence seals are unchanged.\n");
  } else throw new Error("usage: review.mjs prepare|post");
}
