import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
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
const moduleCommit = "9ed9a0f14d12758713a8dc42be1ff75f0c87a36f";
const authorCommit = "c332a17f09dfe17fd8fa29252a48db729c83c67d";
const repository = process.cwd();
const scope = resolve(repository, "tests/commands/timeout-author-20260828");
const requested = process.argv[2];
if (!requested) throw new Error("A unique evidence directory is required");
const output = resolve(repository, requested);
if (dirname(output) !== scope || !output.startsWith(scope + sep) || existsSync(output)) throw new Error("Evidence path must be a new direct child of the author scope");
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
  const result = spawnSync("/usr/bin/git", args, { cwd: repository, ...(encoding === "buffer" ? {} : { encoding }), maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr)}`);
  return result.stdout;
}

function safePath(path) {
  if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`unsafe archive path: ${path}`);
  }
  if (path.split("/").includes("AGENTS.md")) throw new Error(`forbidden instruction file in archive input: ${path}`);
}

function treeEntries(commit, paths) {
  const raw = git(["ls-tree", "-rz", "-l", commit, "--", ...paths], "buffer");
  const records = raw.toString("utf8").split("\0").filter(Boolean);
  return records.map(record => {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\s+(\d+)\t(.+)$/u.exec(record);
    if (!match) throw new Error(`unrecognized tree record: ${record}`);
    const [, mode, type, oid, sizeText, path] = match;
    safePath(path);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) throw new Error(`non-regular archive input: ${path} ${mode} ${type}`);
    const bytes = git(["cat-file", "blob", oid], "buffer");
    if (bytes.byteLength !== Number(sizeText)) throw new Error(`blob length mismatch: ${path}`);
    return { path, mode, oid, bytes, sha256: sha256(bytes), length: bytes.byteLength, commit };
  });
}

function sourceEntries() {
  const entries = new Map(treeEntries(baseline, ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]).map(entry => [entry.path, entry]));
  const module = treeEntries(moduleCommit, ["src/commands/timeout"]);
  assert.deepEqual(module.map(entry => entry.path).sort(), [
    "src/commands/timeout/README.md",
    "src/commands/timeout/duration.ts",
    "src/commands/timeout/index.ts",
    "src/commands/timeout/scheduler.ts",
  ]);
  for (const entry of module) {
    if (entries.has(entry.path)) throw new Error(`timeout path unexpectedly exists in baseline: ${entry.path}`);
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

function tar(entries) {
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
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  if (existsSync(target)) throw new Error(`refusing to overwrite reconstructed input: ${entry.path}`);
  writeFileSync(target, entry.bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`reconstructed input is not a regular file: ${entry.path}`);
  if (sha256(readFileSync(target)) !== entry.sha256) throw new Error(`reconstructed input hash mismatch: ${entry.path}`);
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
    cwdRole: cwd === repository ? "repository" : cwd.includes("consumer-b") ? "moved-consumer" : cwd.includes("consumer-a") ? "installed-consumer" : "reconstruction",
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

function manifest(entries) {
  return entries.map(({ path, mode, oid, sha256: hash, length, commit }) => ({ path, mode, bytes: length, sha256: hash, blob: oid, commit }));
}

function allRegularFiles(root, prefix = "") {
  const result = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    safePath(path);
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`non-regular reconstructed entry: ${path}`);
    if (stat.isDirectory()) result.push(...allRegularFiles(root, path));
    else result.push(path);
  }
  return result;
}

function verifySource(work, entries) {
  for (const entry of entries) {
    const target = join(work, entry.path);
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || sha256(readFileSync(target)) !== entry.sha256) throw new Error(`post-run source mutation: ${entry.path}`);
  }
  const actualSource = allRegularFiles(join(work, "src")).map(path => `src/${path}`).sort();
  const expectedSource = entries.filter(entry => entry.path.startsWith("src/")).map(entry => entry.path).sort();
  assert.deepEqual(actualSource, expectedSource);
}

function removeOwnedTree(root) {
  const normalized = resolve(root);
  const prefix = resolve(tmpdir()) + sep;
  if (!normalized.startsWith(prefix) || !normalized.includes("virtual-bash-timeout-")) throw new Error(`refusing cleanup outside owned temporary root: ${normalized}`);
  const remove = path => {
    const stat = lstatSync(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of readdirSync(path)) remove(join(path, name));
      rmdirSync(path);
      return;
    }
    if (stat.isFile() || stat.isSymbolicLink()) {
      unlinkSync(path);
      return;
    }
    throw new Error(`refusing non-file temporary cleanup: ${path}`);
  };
  remove(normalized);
}

try {
  const entries = sourceEntries();
  const archive = tar(entries);
  const archivePath = join(output, "SOURCE.tar");
  writeFileSync(archivePath, archive);
  const archiveHashBefore = sha256(archive);
  writeFileSync(join(output, "SOURCE-MANIFEST.json"), `${JSON.stringify({ schema: "timeout-fixed-source/1", baseline, moduleCommit, entries: manifest(entries) }, null, 2)}\n`);
  const tarList = recordRun("source-tar-list", "/usr/bin/tar", ["-tf", archivePath], repository, 0).result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(tarList.length, entries.length);
  assert.equal(tarList.some(path => path.split("/").includes("AGENTS.md")), false);

  temporary = mkdtempSync(join(tmpdir(), "virtual-bash-timeout-"));
  const work = join(temporary, "work");
  mkdirSync(work);
  for (const entry of entries) writeEntry(work, entry);

  const testSpecifications = [
    [authorCommit, "tests/commands/timeout-author-20260828/fixtures.ts"],
    [authorCommit, "tests/commands/timeout-author-20260828/timeout.test.ts"],
    [baseline, "tests/commands/time-env/helpers.ts"],
    [baseline, "tests/commands/time-env/sleep.test.ts"],
    [baseline, "tests/shell/helpers.ts"],
    [baseline, "tests/shell/invocation-cleanup-lifecycle.test.ts"],
    [baseline, "tests/shell/invocation-cleanup-pipeline.test.ts"],
    [baseline, "tests/integration/owned-output-production-rebase/author/helpers.ts"],
    [baseline, "tests/integration/owned-output-production-rebase/author/operation.test.ts"],
  ];
  const testEntries = testSpecifications.flatMap(([commit, path]) => treeEntries(commit, [path]));
  assert.equal(testEntries.length, testSpecifications.length);
  for (const entry of testEntries) writeEntry(work, entry);
  writeFileSync(join(output, "TEST-HARNESS.json"), `${JSON.stringify({ schema: "timeout-author-harness/1", entries: manifest(testEntries) }, null, 2)}\n`);

  const node = process.execPath;
  const tsc = join(repository, "node_modules/typescript/bin/tsc");
  const tsx = join(repository, "node_modules/tsx/dist/loader.mjs");
  const npm = join(dirname(node), "npm");
  const typeRoot = join(repository, "node_modules/@types");
  const tools = [node, tsc, tsx, npm, "/usr/bin/git", "/usr/bin/tar"].map(path => {
    const actual = realpathSync(path);
    const stat = lstatSync(actual);
    return { requested: path, realpath: actual, mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(readFileSync(actual)) };
  });
  const nodeTypeFiles = allRegularFiles(join(typeRoot, "node"));
  const nodeTypeManifest = nodeTypeFiles.map(path => ({ path, sha256: sha256(readFileSync(join(typeRoot, "node", path))) }));
  writeFileSync(join(output, "TOOLS.json"), `${JSON.stringify({ schema: "timeout-author-tools/1", tools, nodeTypes: {
    files: nodeTypeManifest.length,
    manifestSha256: sha256(JSON.stringify(nodeTypeManifest)),
    package: JSON.parse(readFileSync(join(typeRoot, "node/package.json"), "utf8"))
  } }, null, 2)}\n`);

  recordRun("build", node, [tsc, "-p", "tsconfig.build.json", "--typeRoots", typeRoot], work, 0);
  recordRun("author-runtime", node, ["--import", tsx, "--test", "tests/commands/timeout-author-20260828/timeout.test.ts"], work, 0);
  recordRun("sleep-neighbor", node, ["--import", tsx, "--test", "tests/commands/time-env/sleep.test.ts"], work, 0);
  recordRun("shared-runtime-neighbors", node, ["--import", tsx, "--test", "tests/shell/invocation-cleanup-lifecycle.test.ts", "tests/shell/invocation-cleanup-pipeline.test.ts"], work, 0);
  recordRun("owned-output-neighbor", node, ["--import", tsx, "--test", "tests/integration/owned-output-production-rebase/author/operation.test.ts"], work, 0);
  recordRun("source-and-harness-types", node, [tsc, "--noEmit", "-p", "tsconfig.json", "--typeRoots", typeRoot], work, 0);

  const packageRun = recordRun("npm-pack", npm, ["pack", "--json", "--pack-destination", join(output, "package")], work, 0);
  const pack = JSON.parse(packageRun.result.stdout);
  assert.equal(Array.isArray(pack), true);
  assert.equal(pack.length, 1);
  const tarball = join(output, "package", pack[0].filename);
  const packageListRun = recordRun("package-list", "/usr/bin/tar", ["-tzf", tarball], repository, 0);
  const packageFiles = packageListRun.result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(packageFiles.some(path => path.split("/").includes("AGENTS.md")), false);
  assert.equal(packageFiles.includes("package/dist/commands/timeout/index.js"), true);
  assert.equal(packageFiles.includes("package/dist/commands/timeout/index.d.ts"), true);

  const consumerA = join(temporary, "consumer-a");
  const consumerB = join(temporary, "consumer-b");
  mkdirSync(consumerA);
  writeFileSync(join(consumerA, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies: { "virtual-bash": `file:${tarball}` } }, null, 2)}\n`);
  recordRun("consumer-install", npm, ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], consumerA, 0);
  const runtimeConsumer = `import assert from "node:assert/strict";
import * as root from "virtual-bash";
const internalUrl = new URL("./node_modules/virtual-bash/dist/commands/timeout/index.js", import.meta.url);
const internal = await import(internalUrl.href);
let subpathCode = null;
try { await import("virtual-bash/commands/timeout"); } catch (error) { subpathCode = error.code; }
const defaults = root.createAgentCommands();
assert.deepEqual(Object.keys(internal).sort(), ["createTimeoutCommand", "createTimeoutCommands", "timeoutCommands"]);
assert.equal(Object.hasOwn(root, "createTimeoutCommand"), false);
assert.equal(defaults.length, 77);
assert.equal(defaults.some(command => command.name === "timeout"), false);
assert.equal(subpathCode, "ERR_PACKAGE_PATH_NOT_EXPORTED");
console.log(JSON.stringify({ root: import.meta.resolve("virtual-bash"), internal: internalUrl.href, internalKeys: Object.keys(internal).sort(), defaults: defaults.length, timeoutDefault: false, rootTimeout: false, subpathCode }));
`;
  writeFileSync(join(consumerA, "runtime.mjs"), runtimeConsumer);
  const positive = `import { createTimeoutCommand, createTimeoutCommands, timeoutCommands, type TimeoutCommandOptions, type TimeoutCommandsOptions, type TimeoutScheduler } from "./node_modules/virtual-bash/dist/commands/timeout/index.js";
const scheduler: TimeoutScheduler = { now: () => 0, setTimeout: () => undefined, clearTimeout: () => undefined };
const one: TimeoutCommandOptions = { invoke: undefined, scheduler, maxTimerMilliseconds: undefined };
const many: TimeoutCommandsOptions = { ...one, replace: undefined };
createTimeoutCommand(one); createTimeoutCommands(many); timeoutCommands(many);
`;
  const negativeRoot = `import { createTimeoutCommand } from "virtual-bash"; void createTimeoutCommand;\n`;
  const negativeSubpath = `import { createTimeoutCommand } from "virtual-bash/commands/timeout"; void createTimeoutCommand;\n`;
  const negativeReadonly = `import { type TimeoutCommandOptions } from "./node_modules/virtual-bash/dist/commands/timeout/index.js"; const value: TimeoutCommandOptions = {}; value.invoke = undefined;\n`;
  writeFileSync(join(consumerA, "positive.mts"), positive);
  writeFileSync(join(consumerA, "negative-root.mts"), negativeRoot);
  writeFileSync(join(consumerA, "negative-subpath.mts"), negativeSubpath);
  writeFileSync(join(consumerA, "negative-readonly.mts"), negativeReadonly);
  const typeArguments = [tsc, "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", "--typeRoots", join(repository, "node_modules/@types")];
  recordRun("consumer-runtime-installed", node, ["runtime.mjs"], consumerA, 0);
  recordRun("consumer-types-positive-installed", node, [...typeArguments, "positive.mts"], consumerA, 0);
  recordRun("consumer-types-negative-root", node, [...typeArguments, "negative-root.mts"], consumerA, record => record.exitCode !== 0);
  recordRun("consumer-types-negative-subpath", node, [...typeArguments, "negative-subpath.mts"], consumerA, record => record.exitCode !== 0);
  recordRun("consumer-types-negative-readonly", node, [...typeArguments, "negative-readonly.mts"], consumerA, record => record.exitCode !== 0);

  const installedModule = join(consumerA, "node_modules/virtual-bash/dist/commands/timeout/index.js");
  const installedDeclaration = join(consumerA, "node_modules/virtual-bash/dist/commands/timeout/index.d.ts");
  const installedBefore = {
    module: { bytes: lstatSync(installedModule).size, sha256: sha256(readFileSync(installedModule)) },
    declaration: { bytes: lstatSync(installedDeclaration).size, sha256: sha256(readFileSync(installedDeclaration)) },
  };
  assert.equal(installedBefore.module.sha256, sha256(readFileSync(join(work, "dist/commands/timeout/index.js"))));
  assert.equal(installedBefore.declaration.sha256, sha256(readFileSync(join(work, "dist/commands/timeout/index.d.ts"))));
  renameSync(consumerA, consumerB);
  recordRun("consumer-runtime-moved", node, ["runtime.mjs"], consumerB, 0);
  recordRun("consumer-types-positive-moved", node, [...typeArguments, "positive.mts"], consumerB, 0);
  const movedModule = join(consumerB, "node_modules/virtual-bash/dist/commands/timeout/index.js");
  const movedDeclaration = join(consumerB, "node_modules/virtual-bash/dist/commands/timeout/index.d.ts");
  const installedAfter = {
    module: { bytes: lstatSync(movedModule).size, sha256: sha256(readFileSync(movedModule)) },
    declaration: { bytes: lstatSync(movedDeclaration).size, sha256: sha256(readFileSync(movedDeclaration)) },
  };
  assert.deepEqual(installedAfter, installedBefore);

  verifySource(work, entries);
  const archiveHashAfter = sha256(readFileSync(archivePath));
  assert.equal(archiveHashAfter, archiveHashBefore);
  const moduleEntries = entries.filter(entry => entry.path.startsWith("src/commands/timeout/"));
  const nativePath = join(repository, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/timeout");
  let native;
  if (existsSync(nativePath)) {
    const stat = lstatSync(nativePath);
    native = { present: true, regular: stat.isFile(), mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(readFileSync(nativePath)), executed: 0 };
  } else native = { present: false, executed: 0 };
  writeFileSync(join(output, "NATIVE.json"), `${JSON.stringify({
    schema: "timeout-native-author-hold/1",
    expected: { profile: "GNU coreutils 9.7 Darwin arm64 Mach-O", bytes: 95240, sha256: "36fc11afeb227c7ea50054de958b80de954088139f1d5ef4c03df95ef811a55e" },
    actual: native,
    prospectiveRows: 12,
    executed: 0,
    reason: "native protocol remained held; read-only identity check only"
  }, null, 2)}\n`);
  writeFileSync(join(output, "RUNS.json"), `${JSON.stringify({ schema: "timeout-author-runs/1", runs: commandRuns }, null, 2)}\n`);
  writeFileSync(join(output, "RESULTS.json"), `${JSON.stringify({
    schema: "timeout-author-reconstruction-result/1",
    status: "AUTHOR_SCOPED_PASS_NOT_INDEPENDENT_ACCEPTANCE",
    baseline: { commit: baseline, tree: "48e5ae39ce98e1c8e416bae77da40d88b75e1db5" },
    module: { commit: moduleCommit, files: manifest(moduleEntries) },
    sourceArchive: { format: "ustar", bytes: archive.byteLength, sha256Before: archiveHashBefore, sha256After: archiveHashAfter, entries: entries.length, appendDetected: false },
    package: { filename: pack[0].filename, bytes: lstatSync(tarball).size, sha256: sha256(readFileSync(tarball)), files: packageFiles.length, instructionFiles: 0 },
    installed: { beforeMove: installedBefore, afterMove: installedAfter },
    authorFocused: { tests: 14, passed: 14, failed: 0, childClosureGateCases: 3, sameSentinelPriorityEdges: 2 },
    defaultRegistry: { count: 77, timeoutPresent: false },
    publicSurface: { rootTimeoutExport: false, timeoutPackageSubpath: false, internalLeafRuntimeExports: 3 },
    independent: { familiesExecuted: 0, numericVectorsExecuted: 0, RamanAcceptanceClaimed: false },
    native: { prospective: 12, executed: 0 },
    safeJs: { priorRootReportedCommit: "dc7ed138fe3d81295340a1420df0518373023b5f", priorRootReported: "25/25", executedHere: 0 },
    sourceMutationDetected: false
  }, null, 2)}\n`);
  writeFileSync(join(output, "REPORT.md"), `# Timeout author reconstructed validation\n\nStatus: author-scoped pass, not independent Raman acceptance.\n\nThe candidate is the exact coherent77 baseline ${baseline} plus only the four timeout module blobs from ${moduleCommit}. The deterministic source archive hash is ${archiveHashBefore}; the same hash remained after execution, and its ${entries.length} inputs contain no symlinks, non-regular entries, or instruction files.\n\nThe reconstructed build, 14 author cases, strict source/harness types, sleep neighbor, shared invocation-cleanup neighbors, and owned-output neighbor passed. The packed and locally installed package was moved and rechecked. Its internal leaf exposes three runtime factories, while the root and package subpath remain absent and the default registry remains 77 without timeout.\n\nThe author did not execute Raman's 32 families or 70 vectors, did not execute the 12 native rows, and did not replay SafeJS. The prior SafeJS 25/25 record is root-reported only. Cooperative timeout still cannot preempt a blocked event loop, an ignored signal, opaque host work, a stalled conforming clock, or nonsettling cleanup.\n`);
} catch (error) {
  writeFileSync(join(output, "FAILURE.json"), `${JSON.stringify({ name: error?.name, message: error?.message, stack: error?.stack, runs: commandRuns }, null, 2)}\n`);
  throw error;
} finally {
  if (temporary && existsSync(temporary)) removeOwnedTree(temporary);
}
