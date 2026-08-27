import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = "/Users/kjopek/Workspace/safe-bash";
const phase = process.argv[2];
assert(["PRE", "POST"].includes(phase));
const candidate = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
const freeze = "1b2ddea9e38b25cc91134a2f35a318e27f4d7c29";
const predecessor = "ae0f8b3f4f927b06718fc51e176ca7a54b517364";
const frozenPath = "tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92";
const predecessorPath = frozenPath.replace("approved-v9", "approved-v8");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const commands = [];
function command(executable, args) {
  const stdout = execFileSync(executable, args, { cwd: repository, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  commands.push({ executable, args, status: 0, stdoutSha256: hash(stdout) });
  return stdout;
}
const git = args => command("/usr/bin/git", args);
const gitBytes = (revision, path) => git(["show", `${revision}:${path}`]);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const save = (name, value) => writeFile(join(owned, name), typeof value === "string" || Buffer.isBuffer(value) ? value : json(value), { flag: "wx" });
async function inventory(root, allowInternalLinks = false) {
  const records = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        records.push({ path: relative(root, path), bytes: bytes.length, sha256: hash(bytes), gitBlob: blob(bytes) });
      } else if (allowInternalLinks && entry.isSymbolicLink()) {
        const target = await realpath(path);
        assert(target.startsWith(`${root}/`), `tool link escapes package: ${path}`);
        records.push({ path: relative(root, path), link: await readlink(path), target: relative(root, target), targetSha256: hash(await readFile(target)) });
      } else throw new Error(`unsupported entry: ${path}`);
    }
  }
  await visit(root);
  return records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
async function authenticateTree(revision, path, expectedCount, expectedHash) {
  assert.equal(git(["rev-parse", `${revision}^{commit}`]).toString().trim(), revision);
  const manifestBytes = gitBytes(revision, `${path}/MANIFEST.json`);
  assert.equal(hash(manifestBytes), expectedHash);
  const manifest = JSON.parse(manifestBytes);
  const committed = [...manifest.files, { path: "MANIFEST.json", bytes: manifestBytes.length, sha256: hash(manifestBytes), gitBlob: blob(manifestBytes) }].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const paths = git(["ls-tree", "-r", "--name-only", revision, "--", path]).toString().trim().split("\n");
  assert.equal(paths.length, expectedCount);
  assert.deepEqual(paths, committed.map(record => `${path}/${record.path}`));
  assert(!paths.some(entry => /(^|\/)AGENTS\.md$/u.test(entry)));
  for (const record of committed) {
    const bytes = gitBytes(revision, `${path}/${record.path}`);
    assert.equal(bytes.length, record.bytes);
    assert.equal(hash(bytes), record.sha256);
    assert.equal(blob(bytes), record.gitBlob);
  }
  const live = await inventory(join(repository, path));
  assert.deepEqual(live, committed);
  return { revision, path, tree: git(["rev-parse", `${revision}:${path}`]).toString().trim(), manifestSha256: hash(manifestBytes), count: live.length, exactInventoryIncludingNewEntries: true, records: live };
}

assert.equal(await realpath(repository), repository);
assert.equal(git(["rev-parse", "--show-toplevel"]).toString().trim(), repository);
const beforeStatus = git(["status", "--short"]).toString();
const index = git(["diff", "--cached", "--binary"]);
const v9 = await authenticateTree(freeze, frozenPath, 23, "474a95bd160636cdbabe03943a0a84aaaeb56d04ab87d25915bb1ac8cbdf9fa2");
const v8 = await authenticateTree(predecessor, predecessorPath, 22, "e8f957bd9ea434b0af5388ab0e2ed2d936d5338fcbca5344f3793b08e5e38af7");
const selected = gitBytes(freeze, `${frozenPath}/config/candidate-selected-paths.txt`).toString().trim().split("\n");
assert.equal(selected.length, 249);
assert.deepEqual(git(["ls-tree", "-r", "--name-only", candidate, "--", ...selected]).toString().trim().split("\n"), selected);
const candidateRecords = selected.map(path => {
  const bytes = gitBytes(candidate, path);
  return { path, bytes: bytes.length, sha256: hash(bytes), gitBlob: blob(bytes) };
});
const environment = JSON.parse(gitBytes(freeze, `${frozenPath}/fixtures/native-env-cases.json`));
assert.equal(environment.cases.length, 16);
assert.equal(hash(Buffer.alloc(environment.fixture.length, environment.fixture.fillByte)), environment.fixture.sha256);
const oldVerifier = gitBytes(predecessor, `${predecessorPath}/harness/verify-v5.mjs`).toString();
const newVerifier = gitBytes(freeze, `${frozenPath}/harness/verify-v5.mjs`).toString();
const start = 'await withRealFixture(async ({ root, fs }) => {\n  const file = join(root, "file.bin");';
const end = 'for (const kind of ["non-atime-stat", "byte-change", "entry-change"])';
assert(oldVerifier.includes(start) && newVerifier.includes(start) && oldVerifier.includes(end) && newVerifier.includes(end));
assert.equal(oldVerifier.slice(0, oldVerifier.indexOf(start)), newVerifier.slice(0, newVerifier.indexOf(start)));
assert.equal(oldVerifier.slice(oldVerifier.indexOf(end)), newVerifier.slice(newVerifier.indexOf(end)));
const changes = v8.records.map(previous => {
  const next = v9.records.find(record => record.path === previous.path);
  assert(next);
  return { path: previous.path, changed: previous.sha256 !== next.sha256 };
});
for (const record of changes.filter(record => record.path.endsWith(".mjs") && record.changed && record.path !== "harness/verify-v5.mjs")) {
  const previous = gitBytes(predecessor, `${predecessorPath}/${record.path}`).toString();
  const next = gitBytes(freeze, `${frozenPath}/${record.path}`).toString();
  assert.equal(previous.replaceAll("approved-v8-", "approved-v9-"), next);
}
const diagnosisBlob = git(["cat-file", "blob", "628a4bb60696c63bdab74870895042402d923376"]);
assert.equal(hash(diagnosisBlob), "b2ee65868b1ccd15db17e945fddab7c14546840992ff8bf408b2166bbe2dd9ab");
assert.equal(git(["rev-parse", "a852a471b65b70b8f19e2915d316e3c12847cabb^{tree}"]).toString().trim(), "6cab0827f80ed4af008bed9a3a2e2a3a68cc4f4c");

const tools = {};
for (const [name, requested] of Object.entries({ node: process.execPath, npm: command("/usr/bin/which", ["npm"]).toString().trim(), git: "/usr/bin/git", tar: "/usr/bin/tar", which: "/usr/bin/which", tsc: join(repository, "node_modules/.bin/tsc") })) {
  const path = await realpath(requested);
  tools[name] = { requested, path, sha256: hash(await readFile(path)) };
}
const npmRoot = dirname(dirname(tools.npm.path));
const toolPackages = {};
for (const [name, path] of Object.entries({ npm: npmRoot, typescript: join(repository, "node_modules/typescript"), tsx: join(repository, "node_modules/tsx"), esbuild: join(repository, "node_modules/esbuild"), esbuildPlatform: join(repository, `node_modules/@esbuild/${process.platform}-${process.arch}`), nodeTypes: join(repository, "node_modules/@types/node"), undiciTypes: join(repository, "node_modules/undici-types") })) {
  const records = await inventory(path, true);
  toolPackages[name] = { path, count: records.length, inventorySha256: hash(Buffer.from(json(records))), version: JSON.parse(await readFile(join(path, "package.json"))).version };
}
const versions = { node: command(tools.node.path, ["--version"]).toString().trim(), npm: command(tools.node.path, [tools.npm.path, "--version"]).toString().trim(), typescript: command(tools.node.path, [tools.tsc.path, "--version"]).toString().trim().replace("Version ", "") };
const declaredTools = JSON.parse(gitBytes(freeze, `${frozenPath}/config/static-tooling.json`));
for (const key of ["node", "npm", "typescript"]) assert.equal(versions[key], declaredTools[key]);
const oracle = JSON.parse(gitBytes(freeze, `${frozenPath}/config/oracle-identity.json`));
assert.equal(await realpath(oracle.requestedPath), oracle.realpath);
assert.equal(hash(await readFile(oracle.realpath)), oracle.sha256);
const oracleVersion = command(oracle.realpath, ["--version"]).toString();
assert.equal(oracleVersion.split("\n")[0], oracle.versionFirstLine);
for (const key of ["NODE_OPTIONS", "NODE_PATH", "TSX_TSCONFIG_PATH", "ESBUILD_BINARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH"]) assert(!process.env[key], `undeclared loader/tool override ${key}`);
const reviewerFiles = {};
for (const name of ["audit.mjs", "run-once.mjs", "CORRECTION_REVIEW.md"]) reviewerFiles[name] = hash(await readFile(join(owned, name)));
const result = { reviewer: "V9-Final-Independent-20260827", phase, at: new Date().toISOString(), repository, liveHead: git(["rev-parse", "HEAD"]).toString().trim(), indexSha256: hash(index), v9, v8, candidate: { commit: candidate, tree: git(["rev-parse", `${candidate}^{tree}`]).toString().trim(), count: selected.length, records: candidateRecords }, environmentRows: environment.cases.length, changes, tools, toolPackages, versions, oracle: { ...oracle, observedVersion: oracleVersion }, reviewerFiles, platform: { platform: process.platform, arch: process.arch }, noProductOrNativeSemanticCasesInAudit: true };
if (phase === "POST") {
  const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
  for (const key of ["indexSha256", "v9", "v8", "candidate", "environmentRows", "changes", "tools", "toolPackages", "versions", "oracle", "reviewerFiles"]) assert.deepEqual(result[key], pre[key], `POST differs: ${key}`);
  result.matchesPre = true;
}
if (phase === "PRE") {
  await save("v8-to-v9-controls.diff.data", git(["diff", `${predecessor}:${predecessorPath}/harness/verify-v5.mjs`, `${freeze}:${frozenPath}/harness/verify-v5.mjs`]));
  await save("static-freeze.stdout.data", command(tools.node.path, [join(repository, frozenPath, "verify-freeze.mjs"), freeze]));
}
await save(`${phase}-status.data`, beforeStatus);
await save(`${phase}-commands.json`, commands);
await save(`${phase}.json`, result);
process.stdout.write(`${phase}: authenticated 23 V9 files, 22 V8 files, 249 candidate paths, 16 environment rows, tool trees and oracle.\n`);
