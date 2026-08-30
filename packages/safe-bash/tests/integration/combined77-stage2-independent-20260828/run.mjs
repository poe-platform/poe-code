import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const candidate = "5137a74ec855a32d8a8860eb66b62eb44d11e290", base = "284857d7aa9b0ee0df2b6fdd1a71f41115d7b909";
const evidence = "e8ab954d", prefix = "tests/integration/combined77-stage2-readiness-20260828";
const git = (...args) => {
  const child = spawnSync("/usr/bin/git", ["--no-replace-objects", "-C", repository, "-c", "core.fsmonitor=false", ...args],
    { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr.toString()); return child.stdout;
};
const binding = JSON.parse(git("show", `${evidence}:${prefix}/CANDIDATE.json`));
const expectedNames = JSON.parse(git("show", "02ccea66d1e7983056c0ed114f8842fbd7ec3255:tests/integration/which-public-independent-20260828/cases.json")).expected77;
const files = ["runtime.mjs", "guard.mjs", "run.mjs", "types.mts.fixture", "mutations.json", "CASES.json", "FREEZE.md", "FREEZE.json", "BINDING.md"];
const harness = Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")]));
const hashes = Object.fromEntries(Object.entries(harness).map(([name, bytes]) => [name, hash(Buffer.from(bytes, "base64"))]));
if (process.argv[2] === "--seal") {
  fs.writeFileSync(path.join(own, "EXECUTION-FREEZE.json"), JSON.stringify({ sealedAt: new Date().toISOString(), candidate,
    semanticFreeze: "1445dd79", candidateInspected: true, candidateExecuted: false, hashes,
    policy: "Exact API/CLI binding after candidate inspection, before execution; semantic families unchanged; three compiled-copy mutations and provenance controls" }, null, 2) + "\n", { flag: "wx" });
  process.exit(0);
}
const executionFreeze = JSON.parse(fs.readFileSync(path.join(own, "EXECUTION-FREEZE.json"), "utf8"));
assert.deepEqual(hashes, executionFreeze.hashes);
const output = path.join(own, `${process.argv[2] ?? "actual-01"}.json.gz.base64`);
assert.equal(fs.existsSync(output), false);
assert.equal(binding.candidate, candidate); assert.equal(binding.base, base);
assert.equal(git("rev-parse", `${candidate}^{tree}`).toString().trim(), binding.tree);
assert.equal(git("show", "-s", "--format=%P", candidate).toString().trim(), base);
const changed = git("diff", "--name-only", base, candidate).toString().trim().split("\n").sort();
assert.deepEqual(changed, binding.changes.map(entry => entry.path).sort());
assert.equal(changed.length, 10);
for (const entry of binding.changes) {
  assert.equal(hash(git("show", `${candidate}:${entry.path}`)), entry.sha256);
  assert.equal(git("rev-parse", `${entry.revision}:${entry.path}`).toString().trim(), entry.blob);
  assert.equal(git("rev-parse", `${candidate}:${entry.path}`).toString().trim(), entry.blob);
}
const fixedOrigins = { "src/shell/cancellation.ts": "57855a0293edb83bff98113123806497b4427416" };
for (const name of ["src/contracts/command.md", "src/contracts/command.ts", "src/shell/types.ts", "src/shell/runtime.ts", "src/shell/shell.ts"]) fixedOrigins[name] = "fd1daa123298568546d9ea4e95f8c81dde9c52ff";
for (const [name, revision] of Object.entries(fixedOrigins)) assert.equal(hash(git("show", `${candidate}:${name}`)), hash(git("show", `${revision}:${name}`)));
for (const entry of binding.changes.filter(entry => entry.path.startsWith("tests/"))) assert.equal(hash(git("show", `${candidate}:${entry.path}`)), hash(git("show", `7119f0c084e8d4f50074ca4c47c7311bc48792c8:${entry.path}`)));
const selected = ["src", "README.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ...changed.filter(name => name.startsWith("tests/")), "tests/commands/split/helpers.ts", "tests/commands/stream-format/helpers.ts"];
const names = git("ls-tree", "-r", "--name-only", candidate, "--", ...selected).toString().trim().split("\n");
const sourceHashes = Object.fromEntries(names.map(name => [name, hash(git("show", `${candidate}:${name}`))]));
assert.equal(names.length, 271);
const archive = git("archive", "--format=tar.gz", candidate, ...names);
const temporary = fs.realpathSync(fs.mkdtempSync("/tmp/combined77-independent-")), source = path.join(temporary, "source"), tooling = path.join(temporary, "tools/node_modules");
const result = { capturedAt: new Date().toISOString(), candidate, base, binding, semanticFreeze: "1445dd79", executionFreeze,
  archiveSha256: hash(archive), archiveBase64: archive.toString("base64"), sourceHashes, harness, temporary, records: [], controls: [], layouts: {},
  node: { path: process.execPath, sha256: hash(fs.readFileSync(process.execPath)), version: process.version, platform: process.platform, arch: process.arch },
  fixtureDiff: git("diff", base, candidate, "--", ...changed.filter(name => name.startsWith("tests/"))).toString() };
const inventory = root => {
  const entries = {};
  const walk = current => { for (const name of fs.readdirSync(current).sort()) {
    const filename = path.join(current, name), stat = fs.lstatSync(filename);
    if (stat.isDirectory()) walk(filename);
    else { assert.ok(stat.isFile(), filename); entries[path.relative(root, filename)] = { sha256: hash(fs.readFileSync(filename)), bytes: stat.size, mode: stat.mode & 0o777 }; }
  } };
  walk(root); return entries;
};
const npm = "/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js";
const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LC_ALL: "C", LANG: "C", TZ: "UTC",
  npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_cache: path.join(temporary, "cache"),
  npm_config_userconfig: path.join(temporary, "npmrc"), npm_config_globalconfig: path.join(temporary, "global-npmrc"), npm_config_registry: "http://127.0.0.1:1" };
function execute(label, args, cwd, extra = {}) {
  const child = spawnSync(process.execPath, args, { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const record = { label, args, cwd, status: child.status, signal: child.signal, error: child.error?.message, pid: child.pid, stdout: child.stdout, stderr: child.stderr };
  result.records.push(record);
  assert.equal(child.error, undefined, label); assert.equal(child.signal, null, label);
  if (child.pid) assert.throws(() => process.kill(child.pid, 0), error => error.code === "ESRCH");
  record.childGone = true;
  console.log(JSON.stringify({ label, status: record.status })); return record;
}
function consumerFiles(directory) {
  for (const name of ["runtime.mjs", "guard.mjs"]) fs.copyFileSync(path.join(own, name), path.join(directory, name));
  fs.copyFileSync(path.join(own, "types.mts.fixture"), path.join(directory, "types.mts"));
}
function runtime(label, directory, ids) {
  const packageRoot = path.join(directory, "node_modules/virtual-bash"), before = inventory(packageRoot);
  const config = path.join(directory, `${label}-input.json`), log = path.join(directory, `${label}-loads.jsonl`), manifest = path.join(directory, `${label}-guard.json`);
  fs.writeFileSync(config, JSON.stringify({ ids, expected77: expectedNames, layout: label }));
  const allowed = Object.fromEntries(Object.entries(before).map(([name, entry]) => [path.join(packageRoot, name), entry.sha256]));
  allowed[path.join(directory, "runtime.mjs")] = hashes["runtime.mjs"];
  fs.writeFileSync(manifest, JSON.stringify({ hashes: allowed, log }));
  const record = execute(`${label}-runtime`, ["--experimental-permission", `--allow-fs-read=${directory}`, `--allow-fs-write=${log}`, "--unhandled-rejections=strict", "--import", path.join(directory, "guard.mjs"), path.join(directory, "runtime.mjs"), config], directory, { COMBINED_GUARD: manifest });
  record.loads = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  for (const load of record.loads) assert.equal(load.sha256, allowed[load.filename]);
  record.productLoads = record.loads.filter(load => load.filename.startsWith(packageRoot + path.sep)).length;
  if (record.stdout?.trim()) record.observed = JSON.parse(record.stdout);
  assert.deepEqual(inventory(packageRoot), before);
  return record;
}
function types(label, directory) {
  const args = [path.join(tooling, "typescript/bin/tsc"), "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(tooling, "@types"), "--listFiles", path.join(directory, "types.mts")];
  const positive = execute(`${label}-types`, args, directory);
  const text = fs.readFileSync(path.join(directory, "types.mts"), "utf8");
  fs.writeFileSync(path.join(directory, "negative.mts"), text.replace(/^\/\/ @ts-expect-error[^\n]*\n/gmu, ""));
  const negative = execute(`${label}-negative-types`, [...args.slice(0, -1), path.join(directory, "negative.mts")], directory);
  return { positive: positive.status, negative: negative.status, diagnostics: (negative.stdout.match(/error TS\d+:/gu) ?? []).length };
}
try {
  fs.mkdirSync(source); fs.writeFileSync(env.npm_config_userconfig, ""); fs.writeFileSync(env.npm_config_globalconfig, "");
  const extract = spawnSync("/usr/bin/tar", ["-xz", "-C", source], { input: archive }); assert.equal(extract.status, 0, extract.stderr.toString());
  result.sourceBefore = inventory(source);
  for (const [name, entry] of Object.entries(result.sourceBefore)) assert.equal(entry.sha256, sourceHashes[name]);
  result.tools = {};
  for (const name of ["typescript", "@types/node", "undici-types"]) {
    const original = path.join(repository, "node_modules", name), target = path.join(tooling, name), before = inventory(original);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(original, target, { recursive: true });
    assert.deepEqual(inventory(target), before); result.tools[name] = { input: original, files: before };
  }
  result.npmSha256 = hash(fs.readFileSync(npm));
  const build = execute("build", [path.join(tooling, "typescript/bin/tsc"), "-p", "tsconfig.build.json", "--typeRoots", path.join(tooling, "@types"), "--listFiles"], source);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  result.emitted = inventory(path.join(source, "dist"));
  const packRoot = path.join(temporary, "pack"); fs.mkdirSync(packRoot);
  const pack = execute("pack", [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", packRoot], source);
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = fs.readFileSync(path.join(packRoot, JSON.parse(pack.stdout)[0].filename));
  result.package = { sha256: hash(tarball), base64: tarball.toString("base64"), metadata: JSON.parse(pack.stdout)[0] };
  assert.equal(result.package.sha256, "13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9");
  const installed = path.join(temporary, "installed"), packageRoot = path.join(installed, "node_modules/virtual-bash"); fs.mkdirSync(packageRoot, { recursive: true });
  const unpack = spawnSync("/usr/bin/tar", ["-xz", "--strip-components=1", "-C", packageRoot], { input: tarball }); assert.equal(unpack.status, 0);
  result.packageInventory = inventory(packageRoot); assert.equal(Object.keys(result.packageInventory).length, 846);
  assert.deepEqual(inventory(path.join(packageRoot, "dist")), result.emitted);
  assert.equal(fs.existsSync(path.join(packageRoot, "src")), false);
  consumerFiles(installed);
  const ids = JSON.parse(fs.readFileSync(path.join(own, "CASES.json"), "utf8")).cases.map(entry => entry.id);
  const installedRun = runtime("installed", installed, ids);
  result.layouts.installed = { status: installedRun.status, types: types("installed", installed) };
  const moved = path.join(temporary, "physically moved"); fs.renameSync(installed, moved);
  const archived = path.join(temporary, "source-not-admitted"); fs.renameSync(source, archived);
  assert.equal(fs.existsSync(installed), false); assert.equal(fs.existsSync(source), false);
  const movedRun = runtime("moved", moved, ids);
  result.layouts.moved = { status: movedRun.status, types: types("moved", moved) };
  result.mutations = [];
  for (const mutation of JSON.parse(fs.readFileSync(path.join(own, "mutations.json"), "utf8"))) {
    const directory = path.join(temporary, mutation.id); fs.cpSync(moved, directory, { recursive: true });
    const filename = path.join(directory, "node_modules/virtual-bash", mutation.file), before = fs.readFileSync(filename, "utf8");
    assert.equal(before.split(mutation.before).length, 2, mutation.id);
    const after = before.replace(mutation.before, mutation.after); fs.writeFileSync(filename, after);
    const record = runtime(mutation.id, directory, mutation.ids);
    result.mutations.push({ ...mutation, beforeSha256: hash(before), afterSha256: hash(after), status: record.status, rows: record.observed?.rows });
  }
  for (const [name, expected] of Object.entries(sourceHashes)) assert.equal(hash(fs.readFileSync(path.join(archived, name))), expected);
  for (const entry of Object.values(result.tools)) assert.deepEqual(inventory(entry.input), entry.files);
  assert.deepEqual(inventory(path.join(moved, "node_modules/virtual-bash")), result.packageInventory);
  assert.throws(() => assert.equal(result.package.sha256, "0".repeat(64))); result.controls.push({ id: "A01", outcome: "wrong-package-hash-rejected", productLoads: 0 });
  assert.throws(() => assert.equal(binding.changes[0].sha256, "0".repeat(64))); result.controls.push({ id: "A02", outcome: "wrong-helper-hash-rejected", productLoads: 0 });
  const forbidden = path.join(moved, "unlisted.mjs"); fs.writeFileSync(forbidden, "export const forbidden = 1;\n");
  const log = path.join(moved, "control-loads.jsonl"), manifest = path.join(moved, "control-guard.json"); fs.writeFileSync(manifest, JSON.stringify({ hashes: {}, log }));
  const denied = execute("unlisted-loader-control", ["--import", path.join(moved, "guard.mjs"), forbidden], moved, { COMBINED_GUARD: manifest });
  assert.notEqual(denied.status, 0); assert.match(denied.stderr, /COMBINED_UNLISTED/u); result.controls.push({ id: "L01", outcome: "unlisted-file-rejected", productLoads: 0 });
  result.completed = true;
  result.scopedPass = Object.values(result.layouts).every(layout => layout.status === 0 && layout.types.positive === 0 && layout.types.negative === 2 && layout.types.diagnostics === 3)
    && result.mutations.every(mutation => mutation.status !== 0 && mutation.rows?.some(row => row.status === "FAIL"));
} catch (error) { result.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  fs.rmSync(temporary, { recursive: true, force: true }); result.temporaryRemoved = !fs.existsSync(temporary); result.finishedAt = new Date().toISOString();
  const bytes = gzipSync(JSON.stringify(result), { level: 9 }); fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: result.completed ?? false, scopedPass: result.scopedPass ?? false, failure: result.failure, temporaryRemoved: result.temporaryRemoved }));
  if (!result.scopedPass) process.exitCode = 1;
}
