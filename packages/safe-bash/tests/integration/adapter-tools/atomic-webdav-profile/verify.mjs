import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const owned = relative(root, directory);
const [cohort, revision] = process.argv.slice(2);
assert.equal(process.argv.length, 4, "usage: node verify.mjs <new-cohort> <full-committed-revision>");
assert.match(cohort, /^[a-z][a-z0-9-]*$/);
assert.match(revision, /^[a-f0-9]{40}$/);
const evidence = join(directory, "evidence", cohort);
assert.equal(existsSync(evidence), false, "never overwrite earlier evidence");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(directory, ".isolated-"));
const source = join(scratch, "source");
const consumer = join(scratch, "consumer");
mkdirSync(source);
mkdirSync(consumer);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: "wx" }); };
const save = (name, value) => write(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const paths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
  "tests/integration/adapter-tools/matrix.test.ts", "tests/integration/adapter-tools/fixtures.ts",
  "tests/integration/adapter-tools/preflight-review/preflight.ts", "tests/fs/webdav/mock.ts",
  ...["atomic-mock.ts", "controls.ts", "loaded-hook.mjs", "verify.mjs"].map(name => `${owned}/${name}`)];
const matrixPath = "tests/integration/adapter-tools/matrix.test.ts";
const fixturePath = "tests/integration/adapter-tools/fixtures.ts";
const preflightPath = "tests/integration/adapter-tools/preflight-review/preflight.ts";
const mockPath = "tests/fs/webdav/mock.ts";
const results = [];
const environment = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, NO_COLOR: "1", FORCE_COLOR: "0", TSX_DISABLE_CACHE: "1" };
function run(name, executable, args, cwd, extra = {}) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync(executable, args, { cwd, env: { ...environment, ...extra }, encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  write(join(evidence, `${name}.stdout.log`), result.stdout ?? "");
  write(join(evidence, `${name}.stderr.log`), result.stderr ?? "");
  const text = result.stdout ?? "";
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(text)?.[1] ?? NaN)]));
  const summary = { name, executable, args, cwd: relative(scratch, cwd), startedAt, durationMs: performance.now() - start, status: result.status, signal: result.signal, error: result.error?.message, ...(Number.isFinite(counts.tests) ? { counts, failedRows: [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]) } : {}) };
  results.push(summary);
  save(`${name}.result.json`, summary);
  return result;
}
function filesUnder(base) {
  return readdirSync(base, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name)).sort().map(path => ({ path: relative(base, path), sha256: hash(readFileSync(path)) }));
}
const node = (name, args, cwd, extra) => run(name, process.execPath, args, cwd, extra);
const tsc = join(root, "node_modules/typescript/bin/tsc");
const originalBytes = path => readFileSync(join(source, path));
let failure;
try {
  const archive = git("archive", "--format=tar.gz", revision, "--", ...paths);
  write(join(evidence, "committed-inputs.tar.gz"), archive);
  const extracted = spawnSync("tar", ["-xzf", join(evidence, "committed-inputs.tar.gz"), "-C", source], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  const inputs = filesUnder(source).map(entry => ({ ...entry, gitBlob: git("rev-parse", `${revision}:${entry.path}`).toString().trim() }));
  save("inputs.json", inputs);
  for (const entry of inputs) assert.equal(hash(git("cat-file", "blob", entry.gitBlob)), entry.sha256);
  assert.equal(hash(originalBytes(`${owned}/verify.mjs`)), hash(readFileSync(fileURLToPath(import.meta.url))), "runner is the frozen committed runner");
  save("capture.json", {
    startedAt: new Date().toISOString(), revision, sourceTree: git("rev-parse", `${revision}:src`).toString().trim(),
    liveHead: git("rev-parse", "HEAD").toString().trim(), liveStatus: git("status", "--porcelain=v1").toString(),
    inputsSha256: hash(JSON.stringify(inputs)), archiveSha256: hash(archive), node: process.version,
    nodeExecutableSha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch,
    toolchain: ["typescript", "tsx", "esbuild", "@types/node"].map(name => {
      const bytes = readFileSync(join(root, "node_modules", name, "package.json"));
      return { name, version: JSON.parse(bytes).version, packageJsonSha256: hash(bytes) };
    }),
    role: "resumed matrix/wrapper author; NOT independent verification", scratch,
    profile: "Original six writable backends plus original readonly rows; WebDAV MockDav loopback HTTP. Configured profile changes only WebDAV atomicEmptyDirectory fixture capability, besides public import relocation. No real-service claims.",
    mockPolicy: "Original MockDav source body preserved. Public files/locks feed synchronous helper. Original mock's own registerOwnedResourceResponse import remains on frozen build for fixture bookkeeping, never new private identity access. Loopback matrix serialization does not forward private response ownership.",
    toolchainPolicy: "Existing local dev tools; no install or new dependency; tool package metadata, not whole dependency trees, hashed.",
    cohostLoad: "Concurrent workers; durations are not benchmarks. No native provider/oracle invoked.",
  });
  assert.equal(node("build", [tsc, "-p", "tsconfig.build.json"], source).status, 0);
  const built = filesUnder(join(source, "dist"));
  save("built.json", built);
  write(join(source, "tsconfig.stock.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: [matrixPath, fixturePath, preflightPath, mockPath], exclude: [] }));
  const strictStock = node("strict-stock", [tsc, "-p", "tsconfig.stock.json"], source);
  const stock = node("stock-original79", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", matrixPath], source);
  assert.equal(strictStock.status, 0);
  const packed = run("pack", "npm", ["--cache", join(scratch, "npm-cache"), "pack", "--ignore-scripts", "--json", "--pack-destination", evidence], source);
  assert.equal(packed.status, 0);
  const packName = JSON.parse(packed.stdout)[0].filename;
  const packageRoot = join(consumer, "node_modules/virtual-bash");
  mkdirSync(packageRoot, { recursive: true });
  const unpacked = spawnSync("tar", ["-xzf", join(evidence, packName), "--strip-components=1", "-C", packageRoot], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  write(join(consumer, "package.json"), JSON.stringify({ name: "atomic-webdav-profile-external-consumer", private: true, type: "module" }, null, 2));
  const publicInputs = new Map();
  const importDelta = [];
  function relocate(path, changes) {
    let text = originalBytes(path).toString();
    for (const [from, to] of changes) {
      assert.equal(text.split(from).length, 2, `exactly one import relocation: ${path}: ${from}`);
      text = text.replace(from, to);
      importDelta.push({ path, from, to });
    }
    publicInputs.set(path, text);
    write(join(consumer, path), text);
  }
  for (const path of [matrixPath, fixturePath]) relocate(path, [["../../../src/index.js", "virtual-bash"]]);
  relocate(preflightPath, [["../../../../src/index.js", "virtual-bash"]]);
  relocate(mockPath, [["../../../src/fs/webdav/index.js", "virtual-bash/fs/webdav"],
    ["../../../src/fs/webdav/resource-id.js", join(source, "dist/fs/webdav/resource-id.js")]]);
  for (const name of ["atomic-mock.ts", "controls.ts"]) write(join(consumer, owned, name), originalBytes(`${owned}/${name}`));
  const stockFixture = publicInputs.get(fixturePath);
  const configuredFixture = stockFixture.replace('export const writableAdapters', 'import { atomicMockBinding } from "./atomic-webdav-profile/atomic-mock.js";\n\nexport const writableAdapters')
    .replace('baseUrl: baseUrl.href, timeoutMs:', 'atomicEmptyDirectory: atomicMockBinding(dav, baseUrl.href),\n    baseUrl: baseUrl.href, timeoutMs:');
  assert.notEqual(configuredFixture, stockFixture);
  const delta = [
    '+import { atomicMockBinding } from "./atomic-webdav-profile/atomic-mock.js";',
    '+    atomicEmptyDirectory: atomicMockBinding(dav, baseUrl.href),',
  ];
  write(join(evidence, "fixture-config-only.delta.txt"), `${delta.join("\n")}\n`);
  save("import-relocation.json", importDelta);
  write(join(evidence, "fixtures.stock-public.ts.txt"), stockFixture);
  write(join(evidence, "fixtures.configured-public.ts.txt"), configuredFixture);
  const matrix = originalBytes(matrixPath).toString();
  const originalRows = matrix.slice(matrix.indexOf("const digest ="));
  const publicRows = publicInputs.get(matrixPath).slice(publicInputs.get(matrixPath).indexOf("const digest ="));
  assert.equal(publicRows, originalRows, "all command workloads and assertions byte-identical");
  const tsconfig = { compilerOptions: {
    target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true,
    forceConsistentCasingInFileNames: true, skipLibCheck: true, types: ["node"],
    typeRoots: [join(root, "node_modules/@types")], rootDir: ".", outDir: "out-stock", noEmitOnError: true,
  }, include: [matrixPath, fixturePath, preflightPath, mockPath, `${owned}/atomic-mock.ts`, `${owned}/controls.ts`] };
  write(join(consumer, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  const hook = join(source, owned, "loaded-hook.mjs");
  function publicRun(name, file, output = "out-configured") {
    return node(name, ["--unhandled-rejections=strict", "--import", hook, "--test", "--test-reporter=tap", `${output}/${file.replace(/\.ts$/, ".js")}`], consumer,
      { ATOMIC_PROFILE_LOAD_ROOT: scratch, ATOMIC_PROFILE_LOAD_LOG: join(evidence, `${name}.loaded.jsonl`) });
  }
  assert.equal(node("strict-public-stock", [tsc, "-p", "tsconfig.json"], consumer).status, 0);
  const publicStock = publicRun("packed-stock79", matrixPath, "out-stock");
  writeFileSync(join(consumer, fixturePath), configuredFixture);
  tsconfig.compilerOptions.outDir = "out-configured";
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  assert.equal(node("strict-public-configured", [tsc, "-p", "tsconfig.json"], consumer).status, 0);
  save("consumer-generated.json", filesUnder(consumer).filter(entry => !entry.path.startsWith("node_modules/")));
  const configured = publicRun("packed-configured79", matrixPath);
  const controls = publicRun("packed-controls", `${owned}/controls.ts`);
  const probe = node("public-resolution", ["--input-type=module", "-e", `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { agentCommands, Shell, MemoryFileSystem } from 'virtual-bash'; const consumer = JSON.parse(readFileSync('package.json')); assert.notEqual(consumer.name, 'virtual-bash'); const resolved = import.meta.resolve('virtual-bash'); assert.equal(resolved, ${JSON.stringify(new URL(`file://${join(packageRoot, "dist/index.js")}`).href)}); const shell = new Shell({fs:new MemoryFileSystem()}).use(agentCommands()); assert.equal((await shell.exec(':')).exitCode, 0); const names = ${JSON.stringify(["cat", "cp", "find", "mkdir", "mv", "printf", "pwd", "rm", "rmdir", "sort", "tee", "test", "touch", "xargs", "sed", "awk", "jq", "rg", "sha256sum", "gzip", "diff", "patch"])}; for (const name of names) assert.equal(typeof shell.commands.get(name)?.execute, 'function', name); console.log(JSON.stringify({consumer:consumer.name,resolved,requiredCommands:names,actualAggregate:true})); await shell.dispose();`], consumer);
  assert.equal(probe.status, 0);
  save("public-resolution.json", JSON.parse(probe.stdout));
  const packedManifest = filesUnder(packageRoot);
  save("packed.json", packedManifest);
  const loadedSummary = {};
  for (const name of ["packed-stock79", "packed-configured79", "packed-controls"]) {
    const loads = readFileSync(join(evidence, `${name}.loaded.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(loads.some(entry => entry.path === "consumer/node_modules/virtual-bash/dist/index.js"));
    assert.ok(loads.some(entry => entry.path === "consumer/node_modules/virtual-bash/dist/plugins/index.js"));
    assert.equal(loads.some(entry => entry.path.startsWith("source/src/")), false);
    for (const entry of loads) assert.equal(hash(readFileSync(join(scratch, entry.path))), entry.sha256);
    loadedSummary[name] = { entries: loads.length, sha256: hash(JSON.stringify(loads)) };
  }
  for (const entry of inputs) assert.equal(hash(originalBytes(entry.path)), entry.sha256, `unchanged frozen input: ${entry.path}`);
  assert.deepEqual(filesUnder(join(source, "dist")), built);
  const summaries = Object.fromEntries(results.filter(result => result.counts).map(result => [result.name, result.counts]));
  save("summary.json", {
    revision, sourceTree: git("rev-parse", `${revision}:src`).toString().trim(), sourceManifestSha256: hash(JSON.stringify(inputs.filter(entry => entry.path.startsWith("src/")))),
    matrixSha256: hash(matrix), commandWorkloadsAndAssertionsSha256: hash(originalRows),
    stockFixtureSha256: hash(originalBytes(fixturePath)), configuredFixtureSha256: hash(configuredFixture),
    mockSha256: hash(originalBytes(mockPath)), atomicHelperSha256: hash(originalBytes(`${owned}/atomic-mock.ts`)),
    packSha256: hash(readFileSync(join(evidence, packName))), generatedBuildSha256: hash(JSON.stringify(built)), loadedSummary, summaries,
    delta, unchangedOriginalInputs: true, unchangedCommandWorkloadsAndAssertions: true, configuredChangesInputs: true,
    independentVerification: "required after clean author checkpoint; not performed by this author", realInterop: "not measured; prior WsgiDAV evidence remains independent",
    results,
  });
  assert.equal(stock.status, 1, "stock failure retained, not silently migrated");
  assert.equal(publicStock.status, 1);
  assert.deepEqual(summaries["stock-original79"], { tests: 79, pass: 78, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(summaries["packed-stock79"], summaries["stock-original79"]);
  for (const name of ["stock-original79", "packed-stock79"]) {
    assert.deepEqual(results.find(result => result.name === name).failedRows, ["webdav: create, copy, append, inspect and remove files"]);
  }
  assert.equal(configured.status, 0);
  assert.deepEqual(summaries["packed-configured79"], { tests: 79, pass: 79, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(controls.status, 0);
  assert.deepEqual(summaries["packed-controls"], { tests: 22, pass: 22, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  save("gate.json", { status: "passed", role: "author only", revision, originalStockFailureRetained: true, independentVerifierRequired: true });
} catch (error) {
  failure = error;
  save("failure.json", { message: String(error), stack: error?.stack, results });
} finally {
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, removed: !existsSync(scratch), completedAt: new Date().toISOString(), scope: "only runner-created isolated directory; existing native artifacts and other workers untouched" });
}
if (failure) throw failure;
