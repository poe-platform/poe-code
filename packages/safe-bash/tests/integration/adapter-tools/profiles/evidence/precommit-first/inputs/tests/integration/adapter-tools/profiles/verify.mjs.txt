import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const base = "tests/integration/adapter-tools";
const scope = `${base}/profiles`;
const [cohort, revision, mode] = process.argv.slice(2);
assert.match(cohort ?? "", /^[a-z][a-z0-9-]*$/);
assert.match(revision ?? "", /^[a-f0-9]{40}$/);
assert.ok(mode === undefined || mode === "--worktree-tests");
assert.equal(process.argv.length, mode ? 5 : 4);
const worktreeTests = mode === "--worktree-tests";
const evidence = join(directory, "evidence", cohort);
assert.equal(existsSync(evidence), false, "evidence labels are immutable");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(directory, ".isolated-"));
const source = join(scratch, "source");
const consumer = join(scratch, "consumer");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: "wx" }); };
const save = (name, value) => write(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const matrixPath = `${base}/matrix.test.ts`;
const fixturePath = `${base}/fixtures.ts`;
const preflightPath = `${base}/preflight-review/preflight.ts`;
const mockPath = "tests/fs/webdav/mock.ts";
const atomicPath = `${base}/atomic-webdav-profile/atomic-mock.ts`;
const controlsPath = `${base}/atomic-webdav-profile/controls.ts`;
const hiddenPath = `${base}/atomic-webdav-profile-independent/hidden.ts`;
const hookPath = `${base}/atomic-webdav-profile/loaded-hook.mjs`;
const selectorPath = `${scope}/rmdir-fixtures.ts`;
const refusalPath = `${scope}/stock-webdav-capability.test.ts`;
const canonicalPaths = [matrixPath, fixturePath, selectorPath, refusalPath];
const readonlyPaths = [preflightPath, mockPath, atomicPath, controlsPath, hiddenPath, hookPath];
const historyPaths = ["before.json", "README.md", "matrix.test.ts.txt", "fixtures.ts.txt", "rmdir-row.ts.txt", "rmdir-body.ts.txt"].map(name => `${scope}/history/${name}`);
const ownedInputs = [...canonicalPaths, ...historyPaths, `${scope}/README.md`, `${scope}/verify.mjs`];
const inputPaths = [...ownedInputs, ...readonlyPaths];
const results = [];
const environment = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch, NO_COLOR: "1", FORCE_COLOR: "0", TSX_DISABLE_CACHE: "1", INDEPENDENT_MUTATION: "", npm_config_update_notifier: "false" };
function run(name, executable, args, cwd, extra = {}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(executable, args, { cwd, env: { ...environment, ...extra }, encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  write(join(evidence, `${name}.stdout.log`), result.stdout ?? "");
  write(join(evidence, `${name}.stderr.log`), result.stderr ?? "");
  const text = result.stdout ?? "";
  const count = key => Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(text)?.[1] ?? NaN);
  const counts = Number.isFinite(count("tests")) ? Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, count(key)])) : undefined;
  const names = [...text.matchAll(/^# Subtest: (.*)$/gm)].map(match => match[1]);
  const summary = { name, args, cwd: relative(scratch, cwd), startedAt, durationMs: performance.now() - started,
    status: result.status, signal: result.signal, error: result.error?.message,
    ...(counts ? { counts, names, failedRows: [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]) } : {}) };
  results.push(summary);
  save(`${name}.result.json`, summary);
  return result;
}
const node = (name, args, cwd, extra) => run(name, process.execPath, args, cwd, extra);
const tsc = join(root, "node_modules/typescript/bin/tsc");
function manifest(basePath) {
  return readdirSync(basePath, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name)).sort().map(path => ({ path: relative(basePath, path), sha256: hash(readFileSync(path)) }));
}
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `unique declared transformation: ${from}`);
  return text.replace(from, to);
}
let failure;
try {
  mkdirSync(source);
  const archive = git("archive", "--format=tar.gz", revision, "--", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json");
  write(join(evidence, "committed-product.tar.gz"), archive);
  assert.equal(spawnSync("tar", ["-xzf", join(evidence, "committed-product.tar.gz"), "-C", source]).status, 0);
  const productInputs = manifest(source);
  save("product-inputs.json", productInputs);
  const inputs = inputPaths.map(path => {
    const overlay = worktreeTests && ownedInputs.includes(path);
    const bytes = overlay ? readFileSync(join(root, path)) : git("show", `${revision}:${path}`);
    write(join(source, path), bytes);
    write(join(evidence, "inputs", `${path}.txt`), bytes);
    return { path, sha256: hash(bytes), bytes: bytes.length, origin: overlay ? "uncommitted owned test input" : "committed",
      ...(overlay ? {} : { gitBlob: git("rev-parse", `${revision}:${path}`).toString().trim() }) };
  });
  save("inputs.json", inputs);
  const inputText = path => readFileSync(join(source, path), "utf8");
  assert.equal(hash(inputText(`${scope}/verify.mjs`)), hash(readFileSync(fileURLToPath(import.meta.url))), "executed runner matches captured input");
  const before = JSON.parse(inputText(`${scope}/history/before.json`));
  for (const entry of before.inputs) {
    assert.equal(hash(git("cat-file", "blob", entry.gitBlob)), entry.sha256);
    const archived = entry.path === matrixPath ? `${scope}/history/matrix.test.ts.txt`
      : entry.path === fixturePath ? `${scope}/history/fixtures.ts.txt` : entry.path;
    assert.equal(hash(inputText(archived)), entry.sha256, `original archive/helper/preflight/mock unchanged: ${entry.path}`);
  }
  const originalMatrix = inputText(`${scope}/history/matrix.test.ts.txt`);
  const originalFixture = inputText(`${scope}/history/fixtures.ts.txt`);
  const originalBody = inputText(`${scope}/history/rmdir-body.ts.txt`);
  assert.equal(hash(originalBody), before.row.commandAssertionBodySha256);
  assert.equal(hash(inputText(`${scope}/history/rmdir-row.ts.txt`)), before.row.sha256);
  const matrixChanges = [
    ['} from "./fixtures.js";\n', '} from "./fixtures.js";\nimport { withRmdirFixture } from "./profiles/rmdir-fixtures.js";\n'],
    ['  test(`${backend}: create, copy, append, inspect and remove files`, options, async () => {\n    await withFixture(backend,', '  test(`${backend === "webdav" ? "webdav configured atomic-empty" : backend}: create, copy, append, inspect and remove files`, options, async () => {\n    await withRmdirFixture(backend,'],
  ];
  const fixtureChanges = [
    ['  type FileSystem, type ShellExecOptions, type ShellResult, type VirtualShellPlugin,\n', '  type FileSystem, type ShellExecOptions, type ShellResult, type VirtualShellPlugin,\n  type WebDavAtomicEmptyDirectoryBinding,\n'],
    ['type Cleanup = () => Promise<void>;\n\n', 'type Cleanup = () => Promise<void>;\n\nexport interface FixtureProfileOptions {\n  readonly webdavAtomicBinding?: (dav: MockDav, namespaceUrl: string) => WebDavAtomicEmptyDirectoryBinding;\n}\n\n'],
    ['async function davFixture(cleanups: Cleanup[])', 'async function davFixture(cleanups: Cleanup[], profile: FixtureProfileOptions)'],
    ['  const fs = new WebDavFileSystem({\n', '  const fs = new WebDavFileSystem({\n    ...(profile.webdavAtomicBinding ? { atomicEmptyDirectory: profile.webdavAtomicBinding(dav, baseUrl.href) } : {}),\n'],
    ['  plugin: VirtualShellPlugin = agentCommands(),\n', '  plugin: VirtualShellPlugin = agentCommands(),\n  profile: FixtureProfileOptions = {},\n'],
    ['await davFixture(cleanups));', 'await davFixture(cleanups, profile));'],
  ];
  assert.equal(matrixChanges.reduce((text, [from, to]) => replaceOnce(text, from, to), originalMatrix), inputText(matrixPath));
  assert.equal(fixtureChanges.reduce((text, [from, to]) => replaceOnce(text, from, to), originalFixture), inputText(fixturePath));
  assert.ok(inputText(matrixPath).includes(originalBody), "entire old command/assertion body byte-identical");
  save("equivalence.json", { before, matrixChanges, fixtureChanges, other78MatrixRowsByteIdentical: true,
    commandAssertionBodySha256: hash(originalBody), helperDiff: "", helperUnchanged: true,
    canonicalMatrixSha256: hash(inputText(matrixPath)), canonicalFixtureSha256: hash(inputText(fixturePath)), selectorSha256: hash(inputText(selectorPath)) });
  const protectedPaths = [`${base}/atomic-webdav-profile`, `${base}/atomic-webdav-profile-independent`, `${base}/preflight-review`, mockPath];
  const protectedDiff = git("diff", revision, "--", ...protectedPaths);
  assert.equal(protectedDiff.length, 0, "preexisting helper/evidence/preflight/mock are read-only");
  save("capture.json", { revision, sourceTree: git("rev-parse", `${revision}:src`).toString().trim(),
    startedAt: new Date().toISOString(), liveHead: git("rev-parse", "HEAD").toString().trim(), liveStatus: git("status", "--porcelain=v1").toString(),
    worktreeTests, productArchiveSha256: hash(archive), productManifestSha256: hash(JSON.stringify(productInputs)), inputManifestSha256: hash(JSON.stringify(inputs)),
    node: process.version, nodeExecutableSha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch,
    tools: ["typescript", "tsx", "esbuild", "@types/node"].map(name => { const bytes = readFileSync(join(root, "node_modules", name, "package.json")); return { name, version: JSON.parse(bytes).version, packageJsonSha256: hash(bytes) }; }),
    role: "author replay, not independent review", independentMutationEnvironment: "explicitly empty", scratch,
    history: "stock78/79 and configured79/79 prior evidence untouched; only full configured historical workloads replayed against this candidate",
    service: "no real service started/downloaded; authenticated b22d00c evidence remains independent historical basis",
    profile: "actual agentCommands; loopback MockDav; S3 mock snapshot-marker semantics; no performance claim under concurrent cohost work" });
  assert.equal(node("build", [tsc, "-p", "tsconfig.build.json"], source).status, 0);
  const built = manifest(join(source, "dist"));
  save("built.json", built);
  const sourceTypes = [...canonicalPaths, ...readonlyPaths.filter(path => path.endsWith(".ts"))];
  write(join(source, "tsconfig.profile.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: sourceTypes, exclude: [] }));
  assert.equal(node("strict-source", [tsc, "-p", "tsconfig.profile.json", "--listFiles"], source).status, 0);
  const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap"];
  node("source-stock-refusals", [...testArgs, refusalPath], source);
  node("source-canonical81", [...testArgs, matrixPath, refusalPath], source);
  const packed = run("pack", "npm", ["--offline", "--cache", join(scratch, "npm-cache"), "pack", "--ignore-scripts", "--json", "--pack-destination", evidence], source);
  assert.equal(packed.status, 0);
  const packName = JSON.parse(packed.stdout)[0].filename;
  const packageRoot = join(consumer, "node_modules/virtual-bash");
  mkdirSync(packageRoot, { recursive: true });
  assert.equal(spawnSync("tar", ["-xzf", join(evidence, packName), "--strip-components=1", "-C", packageRoot]).status, 0);
  write(join(consumer, "package.json"), JSON.stringify({ name: "adapter-rmdir-canonical-consumer", private: true, type: "module" }));
  const importDeltas = [];
  function publicCopy(path, text = inputText(path), destination = consumer) {
    const replaced = text.replace(/(["'])(\.\.[^"']*\/src\/index\.js)\1/g, (_match, quote, from) => { importDeltas.push({ path, from, to: "virtual-bash" }); return `${quote}virtual-bash${quote}`; })
      .replace('"../../../src/fs/webdav/index.js"', '"virtual-bash/fs/webdav"')
      .replace('"../../../src/fs/webdav/resource-id.js"', JSON.stringify(join(source, "dist/fs/webdav/resource-id.js")));
    write(join(destination, path), replaced);
  }
  for (const path of sourceTypes) publicCopy(path);
  const compilerOptions = { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true,
    forceConsistentCasingInFileNames: true, skipLibCheck: true, types: ["node"], typeRoots: [join(root, "node_modules/@types")],
    rootDir: ".", outDir: "out", noEmitOnError: true };
  write(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions, include: sourceTypes }));
  assert.equal(node("strict-packed-canonical", [tsc, "-p", "tsconfig.json", "--listFiles"], consumer).status, 0);
  const loaded = [];
  function publicTests(name, paths, cwd = consumer) {
    loaded.push(name);
    return node(name, ["--unhandled-rejections=strict", "--import", join(source, hookPath), "--test", "--test-reporter=tap", ...paths.map(path => `out/${path.replace(/\.ts$/, ".js")}`)], cwd,
      { ATOMIC_PROFILE_LOAD_ROOT: scratch, ATOMIC_PROFILE_LOAD_LOG: join(evidence, `${name}.loaded.jsonl`) });
  }
  publicTests("packed-canonical81", [matrixPath, refusalPath]);
  publicTests("packed-author-controls22", [controlsPath]);
  publicTests("packed-independent-controls27-author-replay", [hiddenPath]);
  const historical = join(consumer, "historical-configured");
  write(join(historical, "package.json"), JSON.stringify({ name: "adapter-rmdir-historical-configured-consumer", private: true, type: "module" }));
  publicCopy(matrixPath, originalMatrix, historical);
  const configuredFixture = replaceOnce(replaceOnce(originalFixture, 'export const writableAdapters', 'import { atomicMockBinding } from "./atomic-webdav-profile/atomic-mock.js";\n\nexport const writableAdapters'),
    'baseUrl: baseUrl.href, timeoutMs:', 'atomicEmptyDirectory: atomicMockBinding(dav, baseUrl.href),\n    baseUrl: baseUrl.href, timeoutMs:');
  publicCopy(fixturePath, configuredFixture, historical);
  for (const path of [preflightPath, mockPath, atomicPath]) publicCopy(path, inputText(path), historical);
  const historicalTypes = [matrixPath, fixturePath, preflightPath, mockPath, atomicPath];
  write(join(historical, "tsconfig.json"), JSON.stringify({ compilerOptions, include: historicalTypes }));
  write(join(evidence, "historical-configured-fixture.ts.txt"), configuredFixture);
  save("import-relocations.json", { rootImports: importDeltas,
    mockOnly: [{ from: "../../../src/fs/webdav/index.js", to: "virtual-bash/fs/webdav", kind: "type import" },
      { from: "../../../src/fs/webdav/resource-id.js", to: join(source, "dist/fs/webdav/resource-id.js"), kind: "unchanged original mock bookkeeping; not new private identity logic" }] });
  assert.equal(node("strict-packed-historical", [tsc, "-p", "tsconfig.json", "--listFiles"], historical).status, 0);
  publicTests("packed-historical-configured79", [matrixPath], historical);
  const probe = node("public-boundary", ["--input-type=module", "-e", `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { Shell, MemoryFileSystem, agentCommands } from 'virtual-bash'; import { requiredWorkflowCommands } from './out/${preflightPath.replace(/\.ts$/, ".js")}'; const name = JSON.parse(readFileSync('package.json')).name; assert.notEqual(name, 'virtual-bash'); const resolved = import.meta.resolve('virtual-bash'); assert.equal(resolved, ${JSON.stringify(pathToFileURL(join(packageRoot, "dist/index.js")).href)}); const shell = new Shell({fs:new MemoryFileSystem()}).use(agentCommands()); assert.equal((await shell.exec(':')).exitCode,0); const required = [...new Set(Object.values(requiredWorkflowCommands).flat())]; for (const command of required) assert.equal(typeof shell.commands.get(command)?.execute,'function',command); console.log(JSON.stringify({name,resolved,required,actualAggregate:true})); await shell.dispose();`], consumer);
  assert.equal(probe.status, 0);
  save("public-boundary.json", JSON.parse(probe.stdout));
  save("packed.json", manifest(packageRoot));
  save("consumer-inputs-and-outputs.json", manifest(consumer).filter(entry => !entry.path.startsWith("node_modules/")));
  const loadSummary = {};
  for (const name of loaded) {
    const entries = readFileSync(join(evidence, `${name}.loaded.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(entries.some(entry => entry.path === "consumer/node_modules/virtual-bash/dist/index.js"));
    assert.ok(entries.some(entry => entry.path === "consumer/node_modules/virtual-bash/dist/plugins/index.js"));
    assert.equal(entries.some(entry => entry.path.startsWith("source/src/")), false);
    for (const entry of entries) assert.equal(hash(readFileSync(join(scratch, entry.path))), entry.sha256);
    loadSummary[name] = { entries: entries.length, sha256: hash(JSON.stringify(entries)) };
  }
  for (const entry of [...productInputs, ...inputs]) assert.equal(hash(readFileSync(join(source, entry.path))), entry.sha256);
  assert.deepEqual(manifest(join(source, "dist")), built);
  assert.deepEqual(git("diff", revision, "--", ...protectedPaths), protectedDiff);
  const countsByProfile = {};
  for (const result of results.filter(result => result.counts)) {
    const readonlyRefusals = result.names.filter(name => name.startsWith("readonly: rejects mutation:")).length;
    const stockRefusals = result.names.filter(name => name.startsWith("stock-webdav:")).length;
    countsByProfile[result.name] = { ...result.counts, readonlyRefusals, stockRefusals,
      workflowOrControlRows: result.counts.tests - readonlyRefusals - stockRefusals };
  }
  save("summary.json", { revision, worktreeTests, sourceTree: git("rev-parse", `${revision}:src`).toString().trim(),
    productManifestSha256: hash(JSON.stringify(productInputs)), commandAssertionBodySha256: hash(originalBody),
    historicalWorkloadsSha256: hash(originalMatrix.slice(originalMatrix.indexOf("const digest ="))),
    canonicalMatrixSha256: hash(inputText(matrixPath)), canonicalFixtureSha256: hash(inputText(fixturePath)),
    historicalConfiguredFixtureSha256: hash(configuredFixture), mockSha256: hash(inputText(mockPath)), atomicHelperSha256: hash(inputText(atomicPath)),
    helperDiff: "", packSha256: hash(readFileSync(join(evidence, packName))), builtManifestSha256: hash(JSON.stringify(built)),
    countsByProfile, loadSummary, results, role: "author only; different verifier required", serviceAuth: "historical b22d00c only; not rerun" });
  for (const [name, total] of [["source-stock-refusals", 2], ["source-canonical81", 81], ["packed-canonical81", 81],
    ["packed-author-controls22", 22], ["packed-independent-controls27-author-replay", 27], ["packed-historical-configured79", 79]]) {
    const result = results.find(item => item.name === name);
    assert.equal(result.status, 0, name);
    assert.deepEqual(result.counts, { tests: total, pass: total, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, name);
    if (name.endsWith("canonical81")) {
      assert.equal(result.names.filter(title => title.startsWith("webdav configured atomic-empty:")).length, 1);
      assert.equal(countsByProfile[name].readonlyRefusals, 9);
      assert.equal(countsByProfile[name].stockRefusals, 2);
      assert.equal(countsByProfile[name].workflowOrControlRows, 70);
    }
  }
  save("gate.json", { status: "passed", revision, worktreeTests, classification: worktreeTests ? "precommit test overlay, not committed candidate evidence" : "frozen committed author evidence", independentVerifierRequired: true });
} catch (error) {
  failure = error;
  save("failure.json", { message: String(error), stack: error?.stack, results });
} finally {
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, removed: !existsSync(scratch), completedAt: new Date().toISOString(), policy: "only runner-created scratch; other workers and native artifacts untouched" });
}
if (failure) throw failure;
