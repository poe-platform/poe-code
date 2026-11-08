import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, "../../../..");
const revision = "3bf672f722da2bdf1591ed112290b702987bf63a";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z][a-z0-9-]*$/);
assert.equal(process.argv.length, 3);
const evidence = join(own, "evidence", label);
assert.equal(existsSync(evidence), false);
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(own, ".isolated-"));
const source = join(scratch, "source");
const consumer = join(scratch, "outside-consumer");
const base = "tests/integration/adapter-tools";
const matrix = `${base}/matrix.test.ts`;
const fixture = `${base}/fixtures.ts`;
const selector = `${base}/profiles/rmdir-fixtures.ts`;
const refusal = `${base}/profiles/stock-webdav-capability.test.ts`;
const helper = `${base}/atomic-webdav-profile/atomic-mock.ts`;
const author = `${base}/atomic-webdav-profile/controls.ts`;
const prior = `${base}/atomic-webdav-profile-independent/hidden.ts`;
const observer = `${base}/atomic-webdav-profile-independent/observe.mjs`;
const controls = `${base}/profiles-independent/controls.test.ts`;
const preflight = `${base}/preflight-review/preflight.ts`;
const mock = "tests/fs/webdav/mock.ts";
const inputs = [matrix, fixture, selector, refusal, helper, author, prior, observer, preflight, mock];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const save = (name, value) => write(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const text = path => git("show", `${revision}:${path}`).toString();
const manifest = directory => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
  .map(path => ({ path: relative(directory, path), sha256: hash(readFileSync(path)) }));
const once = (value, before, after) => {
  assert.equal(value.split(before).length, 2, before);
  return value.replace(before, after);
};
const results = [];
const environment = { ...process.env, HOME: join(scratch, "home"), TMPDIR: scratch, TMP: scratch, TEMP: scratch,
  NODE_OPTIONS: "", TSX_DISABLE_CACHE: "1", INDEPENDENT_MUTATION: "", NO_COLOR: "1", FORCE_COLOR: "0", npm_config_update_notifier: "false" };
delete environment.NODE_TEST_CONTEXT;
const run = (name, executable, args, cwd, extra = {}) => {
  const start = performance.now();
  const result = spawnSync(executable, args, { cwd, env: { ...environment, ...extra }, encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  write(join(evidence, `${name}.stdout.log`), result.stdout ?? "");
  write(join(evidence, `${name}.stderr.log`), result.stderr ?? "");
  const output = result.stdout ?? "";
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(output)?.[1] ?? NaN)]));
  const record = { name, executable, args, cwd: relative(scratch, cwd), status: result.status, signal: result.signal,
    error: result.error?.message, durationMs: performance.now() - start, counts,
    names: [...output.matchAll(/^# Subtest: (.*)$/gm)].map(match => match[1]),
    failures: [...output.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]) };
  results.push(record);
  save(`${name}.result.json`, record);
  console.log(`${name}: exit=${record.status} tests=${counts.tests} pass=${counts.pass} fail=${counts.fail}`);
  return record;
};
const node = (name, args, cwd, extra) => run(name, process.execPath, args, cwd, extra);
function passed(record, count) {
  assert.equal(record.status, 0, record.name);
  if (count !== undefined) assert.deepEqual(record.counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, record.name);
}
const protectedPaths = [`${base}/atomic-webdav-profile`, `${base}/atomic-webdav-profile-independent`, `${base}/profiles/history`,
  "tests/fs/webdav/atomic-extension", "tests/fs/webdav/atomic-extension-independent"];
const protectedFiles = git("ls-tree", "-r", "--name-only", revision, "--", ...protectedPaths).toString().trim().split("\n");
const protectedHashes = protectedFiles.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
let failure;
try {
  const startedAt = new Date().toISOString();
  mkdirSync(source);
  mkdirSync(environment.HOME);
  const productPaths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
  const archive = git("archive", "--format=tar.gz", revision, "--", ...productPaths, ...inputs, `${base}/profiles/history`);
  write(join(evidence, "frozen-source-inputs.tar.gz"), archive);
  assert.equal(spawnSync("tar", ["-xzf", join(evidence, "frozen-source-inputs.tar.gz"), "-C", source]).status, 0);
  const frozen = manifest(source);
  save("frozen-manifest.json", frozen);
  for (const name of ["verify.mjs", "controls.test.ts"]) write(join(evidence, "verifier-inputs", `${name}.txt`), readFileSync(join(own, name)));
  write(join(source, controls), readFileSync(join(own, "controls.test.ts")));
  symlinkSync(join(root, "node_modules"), join(source, "node_modules"), "dir");
  const history = JSON.parse(text(`${base}/profiles/history/before.json`));
  for (const entry of history.inputs) {
    assert.equal(hash(git("cat-file", "blob", entry.gitBlob)), entry.sha256);
    const path = entry.path === matrix ? `${base}/profiles/history/matrix.test.ts.txt`
      : entry.path === fixture ? `${base}/profiles/history/fixtures.ts.txt` : entry.path;
    assert.equal(hash(text(path)), entry.sha256, path);
  }
  const oldMatrix = text(`${base}/profiles/history/matrix.test.ts.txt`);
  const body = text(`${base}/profiles/history/rmdir-body.ts.txt`);
  assert.equal(hash(body), history.row.commandAssertionBodySha256);
  assert.equal(hash(text(`${base}/profiles/history/rmdir-row.ts.txt`)), history.row.sha256);
  assert.equal(text(matrix).split(body).length, 2);
  let reversed = once(text(matrix), 'import { withRmdirFixture } from "./profiles/rmdir-fixtures.js";\n', "");
  reversed = once(reversed, '${backend === "webdav" ? "webdav configured atomic-empty" : backend}: create', '${backend}: create');
  reversed = once(reversed, "await withRmdirFixture(backend,", "await withFixture(backend,");
  assert.equal(reversed, oldMatrix, "no other matrix byte changed");
  assert.equal(git("diff", history.beforeHead, revision, "--", helper).length, 0);
  const fixtureDiff = git("diff", history.beforeHead, revision, "--", fixture).toString();
  write(join(evidence, "fixture.diff.txt"), fixtureDiff);
  write(join(evidence, "matrix.diff.txt"), git("diff", history.beforeHead, revision, "--", matrix));
  write(join(evidence, "helper.diff.txt"), "");
  assert.match(text(fixture), /plugin: VirtualShellPlugin = agentCommands\(\),\n  profile: FixtureProfileOptions = \{\},/);
  for (const path of [matrix, refusal, selector]) assert.doesNotMatch(text(path), /\b(?:skip|todo|only|xfail)\s*[:.(]/);
  assert.doesNotMatch(text(selector), /matrix\.test/);
  save("equivalence.json", { history, oldBodyByteIdentical: true, other78ByteIdentical: true, helperDiffBytes: 0,
    currentMatrix: hash(text(matrix)), currentFixture: hash(text(fixture)), selector: hash(text(selector)), fixtureDiffSha256: hash(fixtureDiff) });
  save("capture.json", { startedAt, revision, sourceTree: git("rev-parse", `${revision}:src`).toString().trim(), archiveSha256: hash(archive),
    liveHead: git("rev-parse", "HEAD").toString().trim(), liveStatus: git("status", "--short").toString(), scratch,
    node: process.version, nodeSha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch,
    compilerSha256: hash(readFileSync(join(root, "node_modules/typescript/lib/_tsc.js"))),
    tools: ["typescript", "tsx", "esbuild", "@types/node"].map(name => ({ name, metadataSha256: hash(readFileSync(join(root, "node_modules", name, "package.json"))), version: JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"))).version })),
    profile: "independent exact committed product/input snapshot; own verifier input bytes captured; no service download; no live whole-product qualification" });
  const tsc = join(root, "node_modules/typescript/bin/tsc");
  passed(node("build", [tsc, "-p", "tsconfig.build.json"], source));
  save("built-manifest.json", manifest(join(source, "dist")));
  const types = [...inputs.filter(path => path.endsWith(".ts")), controls];
  write(join(source, "tsconfig.independent.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: types, exclude: [] }));
  passed(node("strict-source", [tsc, "-p", "tsconfig.independent.json", "--listFiles"], source));
  const testArgs = ["--unhandled-rejections=strict", "--test", "--test-reporter=tap"];
  const sourceRun = node("source-canonical81", ["--import", "tsx", "--import", join(source, observer), ...testArgs, matrix, refusal], source,
    { INDEPENDENT_LOAD_LOG: join(evidence, "source-canonical81.modules.jsonl") });
  passed(sourceRun, 81);
  assert.equal(new Set(sourceRun.names).size, 81);
  assert.equal(sourceRun.names.filter(name => name.startsWith("readonly: rejects mutation:")).length, 9);
  assert.equal(sourceRun.names.filter(name => name.startsWith("stock-webdav:")).length, 2);
  assert.equal(sourceRun.names.filter(name => name.startsWith("webdav configured atomic-empty:")).length, 1);
  passed(run("pack", "npm", ["--offline", "--cache", join(scratch, "npm-cache"), "pack", "--ignore-scripts", "--json", "--pack-destination", evidence], source));
  const packageRoot = join(consumer, "node_modules/virtual-bash");
  mkdirSync(packageRoot, { recursive: true });
  assert.equal(spawnSync("tar", ["-xzf", join(evidence, "virtual-bash-0.0.0.tgz"), "--strip-components=1", "-C", packageRoot]).status, 0);
  write(join(consumer, "package.json"), JSON.stringify({ name: "independent-canonical-rmdir-boundary", private: true, type: "module" }));
  const relocations = [];
  for (const path of types) {
    const original = readFileSync(join(source, path), "utf8");
    const relocated = original.replace(/(["'])(\.\.[^"']*\/src\/index\.js)\1/g, (_match, quote, from) => {
      relocations.push({ path, from, to: "virtual-bash" });
      return `${quote}virtual-bash${quote}`;
    }).replace('"../../../src/fs/webdav/index.js"', '"virtual-bash/fs/webdav"')
      .replace('"../../../src/fs/webdav/resource-id.js"', JSON.stringify(join(packageRoot, "dist/fs/webdav/resource-id.js")));
    write(join(consumer, path), relocated);
  }
  save("consumer-relocations.json", { rootImports: relocations, mockOnly: "unchanged MockDav private resource-id bookkeeping relocated to actual packed file; no new fake identity; mock type import uses public /fs/webdav" });
  const compilerOptions = { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, forceConsistentCasingInFileNames: true,
    skipLibCheck: true, types: ["node"], typeRoots: [join(root, "node_modules/@types")], rootDir: ".", outDir: "out", noEmitOnError: true };
  write(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions, include: types }));
  passed(node("strict-packed", [tsc, "-p", "tsconfig.json", "--listFiles"], consumer));
  save("consumer-input-manifest.json", types.map(path => ({ path, sha256: hash(readFileSync(join(consumer, path))) })));
  save("emitted-manifest.json", manifest(join(consumer, "out")));
  const publicTests = (name, paths) => node(name, ["--import", join(source, observer), ...testArgs, ...paths.map(path => `out/${path.replace(/\.ts$/, ".js")}`)], consumer,
    { INDEPENDENT_LOAD_LOG: join(evidence, `${name}.modules.jsonl`) });
  const packed = publicTests("packed-canonical81", [matrix, refusal]);
  passed(packed, 81);
  assert.deepEqual(packed.names, sourceRun.names);
  passed(publicTests("author-controls22", [author]), 22);
  passed(publicTests("prior-independent27", [prior]), 27);
  passed(publicTests("new-independent14", [controls]), 14);
  const mutationPath = join(consumer, "out", selector.replace(/\.ts$/, ".js"));
  const helperPath = join(consumer, "out", helper.replace(/\.ts$/, ".js"));
  const originalSelector = readFileSync(mutationPath, "utf8");
  const originalHelper = readFileSync(helperPath, "utf8");
  const mutants = [
    { name: "selector-lost-binding", path: mutationPath, original: originalSelector, changed: once(originalSelector, 'name === "webdav"', 'name === "never-webdav"') },
    { name: "helper-ignores-locks", path: helperPath, original: originalHelper, changed: once(originalHelper, "lock.expires > Date.now()", "false") },
    { name: "helper-ignores-descendants", path: helperPath, original: originalHelper, changed: once(originalHelper, 'if (entry.startsWith(`${path}/`))', 'if (false)') },
  ];
  for (const mutant of mutants) {
    write(mutant.path, mutant.changed);
    write(join(evidence, "mutants", `${mutant.name}.js.txt`), mutant.changed);
    try {
      const result = publicTests(`mutant-${mutant.name}`, [controls]);
      assert.equal(result.status, 1);
      assert.equal(result.counts.tests, 14);
      assert.ok(result.counts.fail > 0);
      assert.equal(result.counts.skipped + result.counts.todo + result.counts.cancelled, 0);
    } finally { write(mutant.path, mutant.original); }
  }
  passed(publicTests("restored-independent14", [controls]), 14);
  const closures = {};
  for (const record of results.filter(record => existsSync(join(evidence, `${record.name}.modules.jsonl`)))) {
    const raw = readFileSync(join(evidence, `${record.name}.modules.jsonl`));
    const events = raw.toString().trim().split("\n").map(line => JSON.parse(line));
    const loaded = [...new Map(events.filter(event => event.kind === "load").map(event => [event.path, event])).values()];
    if (record.name !== "source-canonical81") {
      assert.ok(loaded.some(event => event.path === join(packageRoot, "dist/index.js")));
      assert.ok(loaded.some(event => event.path === join(packageRoot, "dist/plugins/index.js")));
      for (const event of loaded) assert.equal(event.path.startsWith(`${source}/dist/`) || event.path.startsWith(`${source}/src/`), false, "no source/private fallback in consumer");
      for (const event of events.filter(event => event.kind === "resolve" && /^virtual-bash(?:\/|$)/.test(event.specifier))) assert.ok(fileURLToPath(event.url).startsWith(`${packageRoot}/dist/`));
      for (const event of loaded.filter(event => event.path.startsWith(`${packageRoot}/`))) assert.equal(event.sha256, hash(readFileSync(event.path)));
    } else {
      assert.ok(loaded.some(event => event.path === join(source, "src/index.ts")));
      assert.ok(loaded.some(event => event.path === join(source, "src/plugins/index.ts")));
    }
    closures[record.name] = { eventLogSha256: hash(raw), events: events.length, loadedFiles: loaded.length,
      loaded: loaded.map(event => ({ path: relative(scratch, event.path), sha256: event.sha256 })) };
  }
  save("module-closures.json", closures);
  for (const entry of frozen) assert.equal(hash(readFileSync(join(source, entry.path))), entry.sha256, entry.path);
  save("summary.json", { revision, sourceCanonical: sourceRun.counts, packedCanonical: packed.counts,
    positions: { workflow: 70, readonlyRefusal: 9, explicitStockRefusal: 2 }, controls: { reusedAuthor: 22, reusedIndependent: 27, newIndependent: 14 },
    mutationResults: results.filter(record => record.name.startsWith("mutant-")), results,
    packSha256: hash(readFileSync(join(evidence, "virtual-bash-0.0.0.tgz"))), productInputsUnchanged: true,
    fullRelease: false, historicalWholeMatricesRerun: false, newRealService: false, finishedAt: new Date().toISOString() });
} catch (error) {
  failure = error;
  save("failure.json", { message: String(error), stack: error.stack, results });
  console.error(error);
} finally {
  const changedProtected = protectedHashes.filter(entry => hash(readFileSync(join(root, entry.path))) !== entry.sha256);
  save("preservation.json", { protectedHashes, changedProtected });
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, removed: !existsSync(scratch), changedProtected });
  if (changedProtected.length) failure ??= new Error("protected input changed during run");
}
if (failure) process.exitCode = 1;
