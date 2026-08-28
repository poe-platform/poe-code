import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const baseline = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const baselineTree = "48e5ae39ce98e1c8e416bae77da40d88b75e1db5";
const originalModuleCommit = "9ed9a0f14d12758713a8dc42be1ff75f0c87a36f";
const repairFreezeCommit = "72a109971d6c82f783ae91de62f7c15e2af21d8b";
const repairSourceCommit = "a23867d6a42e1cb2f2e7278cf22061737a4bea9d";
const originalAuthorCommit = "c332a17f09dfe17fd8fa29252a48db729c83c67d";
const oldSourceArchiveSha256 = "1a7f280f4f309af3dcc8f3a7ec629b95dddbc65d180bc45c9911ff64523d6ded";
const oldPackageSha256 = "32e2bef5eafbb00e9b6704e2765f55e36514eda0da0fe84ea78367813c756630";
const repository = process.cwd();
const scope = resolve(repository, "tests/commands/timeout-author-20260828/repair-f22-v1");
const requested = process.argv[2];
if (!requested) throw new Error("A unique repair evidence directory is required");
const output = resolve(repository, requested);
if (dirname(output) !== scope || !output.startsWith(scope + sep) || existsSync(output)) {
  throw new Error("Evidence path must be a new direct child of the F22 repair scope");
}
mkdirSync(output);
mkdirSync(join(output, "runs"));
mkdirSync(join(output, "package"));

const sha256 = value => createHash("sha256").update(value).digest("hex");
const commandRuns = [];
let temporary;

function spawn(executable, args, cwd = repository) {
  return spawnSync(executable, args, {
    cwd,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(args, encoding = "utf8") {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: repository,
    ...(encoding === "buffer" ? {} : { encoding }),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr)}`);
  return result.stdout;
}

function safeRelative(path) {
  if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`unsafe path: ${path}`);
  }
  if (path.split("/").includes("AGENTS.md")) throw new Error(`forbidden instruction input: ${path}`);
}

function treeEntries(commit, paths) {
  const raw = git(["ls-tree", "-rz", "-l", commit, "--", ...paths], "buffer");
  return raw.toString("utf8").split("\0").filter(Boolean).map(record => {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\s+(\d+)\t(.+)$/u.exec(record);
    if (!match) throw new Error(`unrecognized tree record: ${record}`);
    const [, mode, type, oid, sizeText, path] = match;
    safeRelative(path);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) throw new Error(`non-regular Git input: ${path}`);
    const bytes = git(["cat-file", "blob", oid], "buffer");
    if (bytes.byteLength !== Number(sizeText)) throw new Error(`Git blob size mismatch: ${path}`);
    return { path, mode, oid, bytes, sha256: sha256(bytes), length: bytes.byteLength, commit };
  });
}

function oneTreeEntry(commit, path) {
  const entries = treeEntries(commit, [path]);
  assert.equal(entries.length, 1, `expected one Git input for ${path}`);
  assert.equal(entries[0].path, path);
  return entries[0];
}

function sourceEntries() {
  const entries = new Map(treeEntries(baseline, ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"])
    .map(entry => [entry.path, entry]));
  const moduleEntries = [
    oneTreeEntry(originalModuleCommit, "src/commands/timeout/README.md"),
    oneTreeEntry(originalModuleCommit, "src/commands/timeout/duration.ts"),
    oneTreeEntry(originalModuleCommit, "src/commands/timeout/index.ts"),
    oneTreeEntry(repairSourceCommit, "src/commands/timeout/scheduler.ts"),
  ];
  for (const entry of moduleEntries) {
    if (entries.has(entry.path)) throw new Error(`timeout path unexpectedly exists in coherent baseline: ${entry.path}`);
    entries.set(entry.path, entry);
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function octal(value, width) {
  const text = value.toString(8);
  if (text.length > width - 1) throw new Error(`tar field overflow: ${value}`);
  return `${"0".repeat(width - 1 - text.length)}${text}\0`;
}

function field(buffer, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) throw new Error(`tar field too long: ${value}`);
  bytes.copy(buffer, offset);
}

function tarName(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`tar path cannot be represented: ${path}`);
}

function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const names = tarName(entry.path);
    field(header, 0, 100, names.name);
    field(header, 100, 8, octal(entry.mode === "100755" ? 0o755 : 0o644, 8));
    field(header, 108, 8, octal(0, 8));
    field(header, 116, 8, octal(0, 8));
    field(header, 124, 12, octal(entry.length, 12));
    field(header, 136, 12, octal(0, 12));
    header.fill(32, 148, 156);
    header[156] = 48;
    field(header, 257, 6, "ustar\0");
    field(header, 263, 2, "00");
    field(header, 265, 32, "root");
    field(header, 297, 32, "root");
    field(header, 329, 8, octal(0, 8));
    field(header, 337, 8, octal(0, 8));
    field(header, 345, 155, names.prefix);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    field(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, entry.bytes);
    const remainder = entry.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function writeEntry(root, entry) {
  const target = join(root, entry.path);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) throw new Error(`refusing to overwrite reconstruction input: ${entry.path}`);
  writeFileSync(target, entry.bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`materialized input is not regular: ${entry.path}`);
  if (sha256(readFileSync(target)) !== entry.sha256) throw new Error(`materialized input hash mismatch: ${entry.path}`);
}

function manifest(entries) {
  return entries.map(({ path, mode, oid, sha256: hash, length, commit }) => ({ path, mode, bytes: length, sha256: hash, blob: oid, commit }));
}

function allRegularFiles(root, prefix = "") {
  const result = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    safeRelative(path);
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`non-regular entry: ${path}`);
    if (stat.isDirectory()) result.push(...allRegularFiles(root, path));
    else result.push(path);
  }
  return result;
}

function verifySource(work, entries) {
  for (const entry of entries) {
    const target = join(work, entry.path);
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || sha256(readFileSync(target)) !== entry.sha256) {
      throw new Error(`post-run candidate input mutation: ${entry.path}`);
    }
  }
  const actual = allRegularFiles(join(work, "src")).map(path => `src/${path}`).sort();
  const expected = entries.filter(entry => entry.path.startsWith("src/")).map(entry => entry.path).sort();
  assert.deepEqual(actual, expected, "post-run source tree has a new or missing entry");
}

function recordRun(name, executable, args, cwd, expected) {
  const result = spawn(executable, args, cwd);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  writeFileSync(join(output, "runs", `${name}.stdout.txt`), stdout);
  writeFileSync(join(output, "runs", `${name}.stderr.txt`), stderr);
  const record = {
    name,
    executable,
    args,
    cwdRole: cwd === repository ? "repository" : cwd.endsWith("consumer-moved") ? "moved-consumer" : cwd.endsWith("consumer-installed") ? "installed-consumer" : "reconstruction",
    exitCode: result.status,
    signal: result.signal,
    error: result.error === undefined ? null : { name: result.error.name, message: result.error.message, code: result.error.code },
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  };
  commandRuns.push(record);
  const accepted = typeof expected === "function" ? expected(record) : record.exitCode === expected;
  if (!accepted) throw new Error(`unexpected result for ${name}: ${record.exitCode}`);
  return { result, record };
}

function tapCount(stdout, expected) {
  const match = /^# tests (\d+)$/mu.exec(stdout);
  assert.ok(match, "TAP test count absent");
  assert.equal(Number(match[1]), expected);
  assert.match(stdout, new RegExp(`^# pass ${expected}$`, "mu"));
  assert.match(stdout, /^# fail 0$/mu);
}

function requireHash(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

function removeOwnedTree(root) {
  const normalized = resolve(root);
  const requiredPrefix = resolve(tmpdir()) + sep;
  if (!normalized.startsWith(requiredPrefix) || !normalized.includes("virtual-bash-timeout-f22-")) {
    throw new Error(`refusing cleanup outside owned temporary root: ${normalized}`);
  }
  const remove = path => {
    const stat = lstatSync(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of readdirSync(path)) remove(join(path, name));
      rmdirSync(path);
    } else if (stat.isFile() || stat.isSymbolicLink()) unlinkSync(path);
    else throw new Error(`refusing non-file temporary cleanup: ${path}`);
  };
  remove(normalized);
}

try {
  assert.equal(git(["rev-parse", `${baseline}^{tree}`]).trim(), baselineTree);
  const entries = sourceEntries();
  assert.equal(entries.length, 268);
  const moduleEntries = entries.filter(entry => entry.path.startsWith("src/commands/timeout/"));
  assert.deepEqual(moduleEntries.map(entry => entry.path), [
    "src/commands/timeout/duration.ts",
    "src/commands/timeout/index.ts",
    "src/commands/timeout/README.md",
    "src/commands/timeout/scheduler.ts",
  ]);
  assert.equal(moduleEntries.filter(entry => entry.commit === originalModuleCommit).length, 3);
  assert.equal(moduleEntries.filter(entry => entry.commit === repairSourceCommit).length, 1);

  const archive = createTar(entries);
  const archivePath = join(output, "SOURCE.tar");
  writeFileSync(archivePath, archive);
  const archiveHashBefore = sha256(archive);
  assert.notEqual(archiveHashBefore, oldSourceArchiveSha256);
  writeFileSync(join(output, "SOURCE-MANIFEST.json"), `${JSON.stringify({
    schema: "timeout-f22-repaired-source/1",
    baseline,
    baselineTree,
    originalModuleCommit,
    repairSourceCommit,
    entries: manifest(entries),
  }, null, 2)}\n`);
  const tarListRun = recordRun("source-tar-list", "/usr/bin/tar", ["-tf", archivePath], repository, 0);
  const tarList = tarListRun.result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(tarList.length, entries.length);
  assert.deepEqual(tarList, entries.map(entry => entry.path));
  assert.equal(tarList.some(path => path.split("/").includes("AGENTS.md")), false);

  temporary = mkdtempSync(join(tmpdir(), "virtual-bash-timeout-f22-"));
  const work = join(temporary, "work");
  mkdirSync(work);
  for (const entry of entries) writeEntry(work, entry);

  const harnessSpecifications = [
    [originalAuthorCommit, "tests/commands/timeout-author-20260828/fixtures.ts"],
    [originalAuthorCommit, "tests/commands/timeout-author-20260828/timeout.test.ts"],
    [repairFreezeCommit, "tests/commands/timeout-author-20260828/repair-f22-v1/timeout-f22.test.ts"],
    [repairFreezeCommit, "tests/commands/timeout-author-20260828/repair-f22-v1/types-positive.mts"],
    [baseline, "tests/commands/time-env/helpers.ts"],
    [baseline, "tests/commands/time-env/sleep.test.ts"],
    [baseline, "tests/shell/helpers.ts"],
    [baseline, "tests/shell/invocation-cleanup-lifecycle.test.ts"],
    [baseline, "tests/shell/invocation-cleanup-pipeline.test.ts"],
  ];
  const harnessEntries = harnessSpecifications.map(([commit, path]) => oneTreeEntry(commit, path));
  for (const entry of harnessEntries) writeEntry(work, entry);
  writeFileSync(join(output, "TEST-HARNESS.json"), `${JSON.stringify({
    schema: "timeout-f22-repair-harness/1",
    repairFreezeCommit,
    originalAuthorCommit,
    entries: manifest(harnessEntries),
  }, null, 2)}\n`);

  const node = process.execPath;
  const tsc = join(repository, "node_modules/typescript/bin/tsc");
  const tsx = join(repository, "node_modules/tsx/dist/loader.mjs");
  const npm = join(dirname(node), "npm");
  const typeRoot = join(repository, "node_modules/@types");
  const toolPaths = [node, tsc, tsx, npm, "/usr/bin/git", "/usr/bin/tar"];
  const tools = toolPaths.map(requestedPath => {
    const actual = realpathSync(requestedPath);
    const stat = lstatSync(actual);
    return { requested: requestedPath, realpath: actual, mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(readFileSync(actual)) };
  });
  const nodeTypeFiles = allRegularFiles(join(typeRoot, "node"));
  const nodeTypeManifest = nodeTypeFiles.map(path => ({ path, sha256: sha256(readFileSync(join(typeRoot, "node", path))) }));
  const driverBytes = readFileSync(new URL(import.meta.url));
  writeFileSync(join(output, "TOOLS.json"), `${JSON.stringify({
    schema: "timeout-f22-repair-tools/1",
    driver: { bytes: driverBytes.byteLength, sha256: sha256(driverBytes) },
    tools,
    nodeTypes: {
      files: nodeTypeManifest.length,
      manifestSha256: sha256(JSON.stringify(nodeTypeManifest)),
      packageJsonSha256: sha256(readFileSync(join(typeRoot, "node/package.json"))),
      version: JSON.parse(readFileSync(join(typeRoot, "node/package.json"), "utf8")).version,
    },
  }, null, 2)}\n`);

  recordRun("build", node, [tsc, "-p", "tsconfig.build.json", "--typeRoots", typeRoot], work, 0);
  const repairRun = recordRun("repair-runtime", node, ["--import", tsx, "--test", "tests/commands/timeout-author-20260828/repair-f22-v1/timeout-f22.test.ts"], work, 0);
  tapCount(repairRun.result.stdout, 2);
  const authorRun = recordRun("original-author-runtime", node, ["--import", tsx, "--test", "tests/commands/timeout-author-20260828/timeout.test.ts"], work, 0);
  tapCount(authorRun.result.stdout, 14);
  const sleepRun = recordRun("sleep-neighbor", node, ["--import", tsx, "--test", "tests/commands/time-env/sleep.test.ts"], work, 0);
  tapCount(sleepRun.result.stdout, 27);
  const cleanupRun = recordRun("cleanup-neighbors", node, ["--import", tsx, "--test", "tests/shell/invocation-cleanup-lifecycle.test.ts", "tests/shell/invocation-cleanup-pipeline.test.ts"], work, 0);
  tapCount(cleanupRun.result.stdout, 38);
  recordRun("source-and-selected-harness-types", node, [tsc, "--noEmit", "-p", "tsconfig.json", "--typeRoots", typeRoot], work, 0);
  recordRun("repair-positive-types", node, [tsc, "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", "--typeRoots", typeRoot, "tests/commands/timeout-author-20260828/repair-f22-v1/types-positive.mts"], work, 0);

  const packageRun = recordRun("npm-pack", npm, ["pack", "--json", "--pack-destination", join(output, "package")], work, 0);
  const pack = JSON.parse(packageRun.result.stdout);
  assert.equal(Array.isArray(pack), true);
  assert.equal(pack.length, 1);
  const tarball = join(output, "package", pack[0].filename);
  const packageHash = sha256(readFileSync(tarball));
  assert.notEqual(packageHash, oldPackageSha256);
  const packageListRun = recordRun("package-list", "/usr/bin/tar", ["-tzf", tarball], repository, 0);
  const packageFiles = packageListRun.result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(packageFiles.some(path => path.split("/").includes("AGENTS.md")), false);
  for (const path of [
    "package/dist/commands/timeout/index.js",
    "package/dist/commands/timeout/index.d.ts",
    "package/dist/commands/timeout/scheduler.js",
  ]) assert.equal(packageFiles.includes(path), true, path);

  const consumerInstalled = join(temporary, "consumer-installed");
  const consumerMoved = join(temporary, "consumer-moved");
  mkdirSync(consumerInstalled);
  const consumerPackage = `${JSON.stringify({ private: true, type: "module", dependencies: { "virtual-bash": `file:${tarball}` } }, null, 2)}\n`;
  const runtimeConsumer = `import assert from "node:assert/strict";
import * as root from "virtual-bash";
const internalUrl = new URL("./node_modules/virtual-bash/dist/commands/timeout/index.js", import.meta.url);
const internal = await import(internalUrl.href);
let subpathCode = null;
try { await import("virtual-bash/commands/timeout"); } catch (error) { subpathCode = error.code; }
assert.deepEqual(Object.keys(internal).sort(), ["createTimeoutCommand", "createTimeoutCommands", "timeoutCommands"]);
assert.equal(Object.hasOwn(root, "createTimeoutCommand"), false);
assert.equal(root.createAgentCommands().length, 77);
assert.equal(root.createAgentCommands().some(command => command.name === "timeout"), false);
assert.equal(subpathCode, "ERR_PACKAGE_PATH_NOT_EXPORTED");
const defaultCommands = new root.CommandRegistry([internal.createTimeoutCommand(), { name: "child-seven", execute: () => ({ exitCode: 7 }) }]);
const defaultShell = new root.Shell({ fs: root.createMemoryFileSystem(), commands: defaultCommands });
let defaultResult;
try { defaultResult = await defaultShell.exec("timeout 1 child-seven"); } finally { await defaultShell.dispose(); }
assert.equal(defaultResult.exitCode, 7); assert.equal(defaultResult.stdout, ""); assert.equal(defaultResult.stderr, "");
class ManualScheduler {
  nowValue = 0; setCalls = []; clearCalls = []; receivers = []; pending = undefined;
  now() { this.receivers.push(this); return this.nowValue; }
  setTimeout(callback, milliseconds) { this.receivers.push(this); assert.equal(this.pending, undefined); this.setCalls.push(milliseconds); this.pending = { callback, handle: 0 }; return 0; }
  clearTimeout(handle) { this.receivers.push(this); assert.equal(handle, this.pending.handle); this.clearCalls.push(handle); this.pending = undefined; }
  fire(elapsed) { const pending = this.pending; assert.ok(pending); this.nowValue += elapsed; pending.callback(); }
}
const scheduler = new ManualScheduler(); let admit; const admitted = new Promise(resolve => { admit = resolve; }); let release; const childClose = new Promise(resolve => { release = resolve; }); let observed;
const cleanups = []; const stdout = []; const stderr = [];
const context = { command: "timeout", args: [".001", "blocking-child"], stdin: { async *[Symbol.asyncIterator]() {} }, stdinIsDefault: true, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }, cwd: "/", env: {}, fs: root.createMemoryFileSystem(), signal: new AbortController().signal, registerCleanup(cleanup) { cleanups.push(cleanup); }, async invoke(_command, _args, options) { admit(); const signal = options.signal; await new Promise(resolve => signal.addEventListener("abort", () => { observed = signal.reason; resolve(); }, { once: true })); await childClose; throw signal.reason; } };
const custom = internal.createTimeoutCommand({ scheduler, maxTimerMilliseconds: 1 });
scheduler.now = () => { throw new Error("replacement now called"); }; scheduler.setTimeout = () => { throw new Error("replacement setTimeout called"); }; scheduler.clearTimeout = () => { throw new Error("replacement clearTimeout called"); };
let settled = false; const pending = Promise.resolve(custom.execute(context)).finally(() => { settled = true; }); await admitted; assert.deepEqual(scheduler.setCalls, [1]); scheduler.fire(1); await new Promise(resolve => setImmediate(resolve)); assert.notEqual(observed, undefined); assert.equal(settled, false); assert.notEqual(scheduler.pending, undefined); release(); const customResult = await pending; assert.deepEqual(customResult, { exitCode: 124 }); assert.equal(scheduler.pending, undefined); assert.deepEqual(scheduler.clearCalls, [0]); assert.equal(cleanups.length, 1); assert.deepEqual(await Promise.allSettled(cleanups.map(cleanup => cleanup())), [{ status: "fulfilled", value: undefined }]); assert.ok(scheduler.receivers.every(receiver => receiver === scheduler)); assert.equal(Buffer.concat(stdout).length, 0); assert.equal(Buffer.concat(stderr).length, 0);
console.log(JSON.stringify({ root: import.meta.resolve("virtual-bash"), internal: internalUrl.href, defaultClockStatus: defaultResult.exitCode, customCancellationStatus: customResult.exitCode, cleanupRegistrations: cleanups.length, customReceiverExact: true, defaults: 77, timeoutDefault: false, rootTimeout: false, subpathCode }));
`;
  const positiveConsumer = `import { createTimeoutCommand, createTimeoutCommands, timeoutCommands, type TimeoutCommandOptions, type TimeoutCommandsOptions, type TimeoutScheduler } from "./node_modules/virtual-bash/dist/commands/timeout/index.js";
const scheduler: TimeoutScheduler = { now: () => 0, setTimeout: () => undefined, clearTimeout: () => undefined };
const one: TimeoutCommandOptions = { invoke: undefined, scheduler, maxTimerMilliseconds: undefined };
const many: TimeoutCommandsOptions = { ...one, replace: undefined };
createTimeoutCommand(one); createTimeoutCommands(many); timeoutCommands(many);
`;
  const consumerFiles = {
    "package.json": consumerPackage,
    "runtime.mjs": runtimeConsumer,
    "positive.mts": positiveConsumer,
  };
  for (const [path, bytes] of Object.entries(consumerFiles)) writeFileSync(join(consumerInstalled, path), bytes);
  writeFileSync(join(output, "CONSUMER-HARNESS.json"), `${JSON.stringify({
    schema: "timeout-f22-moved-consumer-harness/1",
    files: Object.entries(consumerFiles).map(([path, bytes]) => ({ path, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes), content: bytes })),
  }, null, 2)}\n`);
  recordRun("consumer-install", npm, ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], consumerInstalled, 0);
  const typeArguments = [tsc, "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", "--typeRoots", typeRoot];
  recordRun("consumer-runtime-installed", node, ["runtime.mjs"], consumerInstalled, 0);
  recordRun("consumer-types-installed", node, [...typeArguments, "positive.mts"], consumerInstalled, 0);

  const installedPackageRoot = join(consumerInstalled, "node_modules/virtual-bash");
  const installedPaths = [
    "dist/commands/timeout/index.js",
    "dist/commands/timeout/index.d.ts",
    "dist/commands/timeout/scheduler.js",
    "dist/commands/timeout/scheduler.d.ts",
  ];
  const installedBefore = installedPaths.map(path => ({ path, bytes: lstatSync(join(installedPackageRoot, path)).size, sha256: sha256(readFileSync(join(installedPackageRoot, path))) }));
  for (const entry of installedBefore) assert.equal(entry.sha256, sha256(readFileSync(join(work, entry.path))));
  renameSync(consumerInstalled, consumerMoved);
  recordRun("consumer-runtime-moved", node, ["runtime.mjs"], consumerMoved, 0);
  recordRun("consumer-types-moved", node, [...typeArguments, "positive.mts"], consumerMoved, 0);
  const movedPackageRoot = join(consumerMoved, "node_modules/virtual-bash");
  const installedAfter = installedPaths.map(path => ({ path, bytes: lstatSync(join(movedPackageRoot, path)).size, sha256: sha256(readFileSync(join(movedPackageRoot, path))) }));
  assert.deepEqual(installedAfter, installedBefore);

  const oldScheduler = oneTreeEntry(originalModuleCommit, "src/commands/timeout/scheduler.ts");
  const repairedScheduler = oneTreeEntry(repairSourceCommit, "src/commands/timeout/scheduler.ts");
  assert.notEqual(oldScheduler.sha256, repairedScheduler.sha256);
  assert.throws(() => requireHash(repairedScheduler.sha256, oldScheduler.sha256, "wrong scheduler binding"), /wrong scheduler binding/u);
  assert.throws(() => requireHash(packageHash, oldPackageSha256, "wrong package binding"), /wrong package binding/u);
  writeFileSync(join(output, "NEGATIVE-BINDINGS.json"), `${JSON.stringify({
    schema: "timeout-f22-wrong-binding-controls/1",
    oldCandidateScheduler: { commit: originalModuleCommit, blob: oldScheduler.oid, sha256: oldScheduler.sha256 },
    repairedScheduler: { commit: repairSourceCommit, blob: repairedScheduler.oid, sha256: repairedScheduler.sha256 },
    oldSchedulerRejectedForRepairedSource: true,
    oldSourceArchive: { sha256: oldSourceArchiveSha256, rejectedForRepair: archiveHashBefore !== oldSourceArchiveSha256 },
    oldPackage: { sha256: oldPackageSha256, rejectedForRepair: packageHash !== oldPackageSha256 },
  }, null, 2)}\n`);

  verifySource(work, entries);
  const archiveHashAfter = sha256(readFileSync(archivePath));
  assert.equal(archiveHashAfter, archiveHashBefore);
  writeFileSync(join(output, "RUNS.json"), `${JSON.stringify({ schema: "timeout-f22-repair-runs/1", runs: commandRuns }, null, 2)}\n`);
  writeFileSync(join(output, "RESULTS.json"), `${JSON.stringify({
    schema: "timeout-f22-repair-result/1",
    status: "AUTHOR_F22_REPAIR_SCOPED_PASS_REVIEW_REQUIRED",
    baseline: { commit: baseline, tree: baselineTree },
    originalModuleCommit,
    repairFreezeCommit,
    repairSourceCommit,
    module: { files: manifest(moduleEntries) },
    sourceArchive: { format: "ustar", bytes: archive.byteLength, sha256Before: archiveHashBefore, sha256After: archiveHashAfter, entries: entries.length, appendedSourceEntryDetected: false, exactSourceTreeComparedAfterRun: true },
    package: { filename: pack[0].filename, bytes: lstatSync(tarball).size, sha256: packageHash, files: packageFiles.length, instructionFiles: 0 },
    installed: { beforeMove: installedBefore, afterMove: installedAfter, physicallyMoved: true },
    runtime: { repair: { tests: 2, passed: 2 }, originalAuthor: { tests: 14, passed: 14 }, sleepNeighbor: { tests: 27, passed: 27 }, cleanupNeighbors: { tests: 38, passed: 38 }, total: { tests: 81, passed: 81 } },
    types: { build: "pass", sourceAndSelectedHarness: "pass", repairPositive: "pass", installedPositive: "pass", movedPositive: "pass" },
    movedControls: { defaultClockChildStatus: 7, actualShell: true, customReceiverExact: true, cancellationStatus: 124, cleanupRegistrations: 1 },
    defaultRegistry: { count: 77, timeoutPresent: false },
    publicSurface: { rootTimeoutExport: false, timeoutPackageSubpath: false, internalLeafRuntimeExports: 3 },
    independentPreservation: { originalQualification: "31/34 in each layout", rescored: false, fixtureFilesModified: false, wholeCohortExecuted: false, remainingVerifierIssuesAddressed: false },
    native: { executed: 0 },
    safeJs: { executed: 0 },
    sourceMutationDetected: false,
  }, null, 2)}\n`);
  writeFileSync(join(output, "REPORT.md"), `# Timeout F22 repaired reconstruction\n\nStatus: author-scoped F22 repair pass; independent Raman review remains required.\n\nThe candidate is coherent baseline \`${baseline}\` plus the original timeout README, duration, and index blobs from \`${originalModuleCommit}\`, and only the repaired scheduler blob from \`${repairSourceCommit}\`. The deterministic 268-entry source archive is \`${archiveHashBefore}\`; its hash and exact source-tree inventory remained unchanged after execution, so source mutation and new source entries are checked.\n\nThe isolated build and strict selected types passed. Runtime checks passed 81/81: repair 2/2, unchanged author 14/14, sleep 27/27, and shared invocation cleanup 38/38. The exact package \`${packageHash}\` was installed offline, exercised, physically moved, and exercised again. Both installed layouts returned default-clock child status 7 through an actual Shell and passed custom receiver, cancellation 124, and cooperative cleanup controls. Internal timeout leaf hashes were unchanged by the move.\n\nThe root and package subpath remain absent, and the default registry remains 77 commands without timeout. The old scheduler/source-archive/package hashes are explicitly rejected as repair bindings. No independent fixture was changed or rerun; the original 31/34 per layout is not rescored. Native and SafeJS executions are zero. This packet does not resolve the independent verifier issues or claim whole-product, parity, or superiority acceptance.\n`);
} catch (error) {
  writeFileSync(join(output, "FAILURE.json"), `${JSON.stringify({ name: error?.name, message: error?.message, stack: error?.stack, runs: commandRuns }, null, 2)}\n`);
  throw error;
} finally {
  if (temporary && existsSync(temporary)) removeOwnedTree(temporary);
}
