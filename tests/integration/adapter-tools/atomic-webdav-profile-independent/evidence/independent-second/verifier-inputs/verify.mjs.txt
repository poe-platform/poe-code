import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const owned = relative(root, here);
const author = "tests/integration/adapter-tools/atomic-webdav-profile";
const frozen = "68059389bf95e03caeae6479837187add3d07814";
const checkpoint = "222e9e127b5e86fa3e9af85d3bad0ee9fa54395c";
const cohort = process.argv[2];
assert.equal(process.argv.length, 3, "usage: node verify.mjs <new-cohort>");
assert.match(cohort, /^[a-z][a-z0-9-]*$/);
const evidence = join(here, "evidence", cohort);
assert.equal(existsSync(evidence), false, "raw cohorts are immutable");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(here, ".isolated-"));
const source = join(scratch, "source");
const consumer = join(scratch, "consumer");
const packageRoot = join(consumer, "node_modules/virtual-bash");
const matrix = "tests/integration/adapter-tools/matrix.test.ts";
const fixture = "tests/integration/adapter-tools/fixtures.ts";
const preflight = "tests/integration/adapter-tools/preflight-review/preflight.ts";
const mock = "tests/fs/webdav/mock.ts";
const paths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", matrix, fixture, preflight, mock,
  ...["atomic-mock.ts", "controls.ts", "verify.mjs", "loaded-hook.mjs"].map(name => `${author}/${name}`)];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (path, bytes, exclusive = true) => {
  assert.ok(resolve(path).startsWith(`${here}/`), "writes stay in independent ownership");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: exclusive ? "wx" : "w" });
};
const save = (name, value) => write(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const tree = base => readdirSync(base, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name)).sort().map(path => ({ path: relative(base, path), sha256: hash(readFileSync(path)) }));
const text = path => readFileSync(join(source, path), "utf8");
const tsc = join(root, "node_modules/typescript/bin/tsc");
const environment = {
  PATH: process.env.PATH, HOME: join(scratch, "home"), TMPDIR: scratch, TMP: scratch, TEMP: scratch,
  NO_COLOR: "1", TSX_DISABLE_CACHE: "1", npm_config_cache: join(scratch, "npm-cache"),
  npm_config_userconfig: join(scratch, "npmrc"), npm_config_globalconfig: join(scratch, "global-npmrc"),
  npm_config_offline: "true", npm_config_update_notifier: "false",
};
const results = [];
function run(name, executable, args, cwd, extra = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, env: { ...environment, ...extra }, encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  write(join(evidence, `${name}.stdout.log`), result.stdout ?? "");
  write(join(evidence, `${name}.stderr.log`), result.stderr ?? "");
  const output = result.stdout ?? "";
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(output)?.[1] ?? NaN)]));
  const record = { name, executable, args, cwd, startedAt, finishedAt: new Date().toISOString(), status: result.status,
    signal: result.signal, error: result.error?.message, ...(Number.isFinite(counts.tests) ? {
      counts, failedRows: [...output.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]),
    } : {}) };
  results.push(record);
  save(`${name}.result.json`, record);
  console.log(`${name}: exit ${result.status}${record.counts ? `; ${counts.pass}/${counts.tests}` : ""}`);
  return { ...result, record };
}
const node = (name, args, cwd, extra) => run(name, process.execPath, args, cwd, extra);
const passed = result => assert.equal(result.status, 0, `${result.record.name}: ${result.stderr}`);
const expectedCounts = (result, tests, pass) => {
  assert.deepEqual(result.record.counts, { tests, pass, fail: tests - pass, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(result.status, tests === pass ? 0 : 1);
};
const replaceOnce = (input, from, to) => {
  assert.equal(input.split(from).length, 2, `unique declared transformation: ${from}`);
  return input.replace(from, to);
};
const closures = {};
function checkClosure(name) {
  const events = readFileSync(join(evidence, `${name}.modules.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const loaded = [...new Map(events.filter(event => event.kind === "load").map(event => [event.path, event])).values()];
  for (const entry of loaded) {
    assert.equal(hash(readFileSync(entry.path)), entry.sha256);
    assert.ok(entry.path.startsWith(`${consumer}/`) || ["dist/fs/webdav/resource-id.js", "dist/contracts/errors.js"].some(path => entry.path === join(source, path)), `unexpected runtime module ${entry.path}`);
  }
  assert.ok(loaded.some(entry => entry.path === join(packageRoot, "dist/index.js")));
  assert.ok(loaded.some(entry => entry.path === join(packageRoot, "dist/plugins/index.js")));
  for (const event of events.filter(event => event.kind === "resolve" && (event.specifier === "virtual-bash" || event.specifier.startsWith("virtual-bash/")))) {
    assert.ok(fileURLToPath(event.url).startsWith(`${packageRoot}/dist/`));
  }
  for (const event of events.filter(event => event.kind === "resolve" && event.url.startsWith("file:") && fileURLToPath(event.url).startsWith(`${source}/`))) {
    const resolved = fileURLToPath(event.url);
    const parent = fileURLToPath(event.parentURL);
    if (resolved === join(source, "dist/fs/webdav/resource-id.js")) assert.ok(parent.startsWith(`${consumer}/`) && parent.endsWith("/tests/fs/webdav/mock.js"));
    else {
      assert.equal(resolved, join(source, "dist/contracts/errors.js"));
      assert.equal(parent, join(source, "dist/fs/webdav/resource-id.js"));
    }
  }
  closures[name] = { events: events.length, loadedFiles: loaded.length, eventLogSha256: hash(readFileSync(join(evidence, `${name}.modules.jsonl`))), loaded };
}
let failure;
try {
  mkdirSync(source);
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(environment.HOME);
  write(environment.npm_config_userconfig, "");
  write(environment.npm_config_globalconfig, "");
  const liveHead = git("rev-parse", "HEAD").toString().trim();
  const archive = git("archive", "--format=tar.gz", frozen, "--", ...paths);
  write(join(evidence, "frozen-inputs.tar.gz"), archive);
  passed(run("extract-frozen", "tar", ["-xzf", join(evidence, "frozen-inputs.tar.gz"), "-C", source], scratch));
  const inputs = tree(source).map(entry => ({ ...entry, gitBlob: git("rev-parse", `${frozen}:${entry.path}`).toString().trim() }));
  for (const entry of inputs) {
    assert.equal(hash(git("cat-file", "blob", entry.gitBlob)), entry.sha256);
    assert.equal(hash(git("show", `${checkpoint}:${entry.path}`)), entry.sha256, `author checkpoint changed frozen ${entry.path}`);
  }
  save("frozen-manifest.json", inputs);
  const comparisons = inputs.map(entry => ({ path: entry.path, frozenSha256: entry.sha256,
    currentCommitSha256: hash(git("show", `${liveHead}:${entry.path}`)),
    liveSha256: existsSync(join(root, entry.path)) ? hash(readFileSync(join(root, entry.path))) : null }));
  save("current-vs-frozen.json", comparisons);
  write(join(evidence, "committed-runtime.delta.patch"), git("diff", frozen, liveHead, "--", ...paths));
  write(join(evidence, "live-runtime.delta.patch"), git("diff", frozen, "--", ...paths));
  const initialShared = ["src", author, "dist"].filter(path => existsSync(join(root, path))).flatMap(path => tree(join(root, path)).map(entry => ({ ...entry, path: `${path}/${entry.path}` })));
  save("shared-readonly-before.json", initialShared);
  save("capture.json", {
    startedAt: new Date().toISOString(), frozen, checkpoint, liveHead, sourceTree: git("rev-parse", `${frozen}:src`).toString().trim(),
    currentSourceTree: git("rev-parse", `${liveHead}:src`).toString().trim(),
    status: git("status", "--porcelain=v1").toString(), index: git("diff", "--cached", "--name-status").toString(),
    archiveSha256: hash(archive), node: process.version, nodeExecutable: process.execPath, nodeExecutableSha256: hash(readFileSync(process.execPath)),
    platform: process.platform, arch: process.arch, scratch,
    tools: ["typescript", "tsx", "esbuild", "@types/node"].map(name => ({ name, version: JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"))).version,
      packageJsonSha256: hash(readFileSync(join(root, "node_modules", name, "package.json"))) })),
    role: "new independent leaf verifier; not author or original matrix helper",
    limits: "Frozen mock fixture qualification, not current dirty product qualification, real-service evidence, canonical migration or superiority. Tool package metadata and compiler file lists, not complete installed dev dependency trees, are sealed.",
  });
  for (const name of ["verify.mjs", "observe.mjs", "hidden.ts"]) write(join(evidence, "verifier-inputs", `${name}.txt`), readFileSync(join(here, name)));
  passed(node("frozen-build", [tsc, "-p", "tsconfig.build.json"], source));
  const built = tree(join(source, "dist"));
  save("built-manifest.json", built);
  write(join(source, "tsconfig.stock.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: [matrix, fixture, preflight, mock], exclude: [] }));
  passed(node("strict-original", [tsc, "-p", "tsconfig.stock.json"], source));
  const stock = node("original-stock79", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", matrix], source);
  const pack = run("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", evidence], source);
  passed(pack);
  const packName = JSON.parse(pack.stdout)[0].filename;
  passed(run("extract-package", "tar", ["-xzf", join(evidence, packName), "--strip-components=1", "-C", packageRoot], scratch));
  const packed = tree(packageRoot);
  save("packed-manifest.json", packed);
  for (const entry of built) assert.equal(hash(readFileSync(join(packageRoot, "dist", entry.path))), entry.sha256);
  assert.deepEqual(JSON.parse(readFileSync(join(packageRoot, "package.json"))).dependencies ?? {}, {});
  write(join(consumer, "package.json"), JSON.stringify({ name: "independent-atomic-dav-consumer", private: true, type: "module" }));
  const relocations = [];
  const relocate = (path, changes) => {
    let bytes = text(path);
    for (const [from, to] of changes) {
      bytes = replaceOnce(bytes, from, to);
      relocations.push({ path, from, to });
    }
    write(join(consumer, path), bytes);
    return bytes;
  };
  const publicMatrix = relocate(matrix, [["../../../src/index.js", "virtual-bash"]]);
  const stockFixture = relocate(fixture, [["../../../src/index.js", "virtual-bash"]]);
  relocate(preflight, [["../../../../src/index.js", "virtual-bash"]]);
  relocate(mock, [["../../../src/fs/webdav/index.js", "virtual-bash/fs/webdav"],
    ["../../../src/fs/webdav/resource-id.js", join(source, "dist/fs/webdav/resource-id.js")]]);
  for (const name of ["atomic-mock.ts", "controls.ts"]) write(join(consumer, author, name), text(`${author}/${name}`));
  write(join(consumer, owned, "hidden.ts"), readFileSync(join(here, "hidden.ts")));
  save("import-relocations.json", relocations);
  const bodyStart = text(matrix).indexOf("const digest =");
  assert.ok(bodyStart > 0);
  const body = text(matrix).slice(bodyStart);
  assert.equal(publicMatrix.slice(publicMatrix.indexOf("const digest =")), body);
  assert.equal(publicMatrix.replace('from "virtual-bash"', 'from "../../../src/index.js"'), text(matrix));
  const configurationDeltas = [
    ["export const writableAdapters", 'import { atomicMockBinding } from "./atomic-webdav-profile/atomic-mock.js";\n\nexport const writableAdapters'],
    ["baseUrl: baseUrl.href, timeoutMs:", "atomicEmptyDirectory: atomicMockBinding(dav, baseUrl.href),\n    baseUrl: baseUrl.href, timeoutMs:"],
  ];
  let configuredFixture = stockFixture;
  for (const [from, to] of configurationDeltas) configuredFixture = replaceOnce(configuredFixture, from, to);
  let reversed = configuredFixture;
  for (const [from, to] of [...configurationDeltas].reverse()) reversed = replaceOnce(reversed, to, from);
  assert.equal(reversed, stockFixture);
  const authorSummary = JSON.parse(git("show", `${checkpoint}:${author}/evidence/author-corrected/summary.json`));
  const seals = { matrixSha256: hash(text(matrix)), commandWorkloadsAndAssertionsSha256: hash(body), stockFixtureSha256: hash(text(fixture)),
    configuredFixtureSha256: hash(configuredFixture), mockSha256: hash(text(mock)), atomicHelperSha256: hash(text(`${author}/atomic-mock.ts`)),
    packSha256: hash(readFileSync(join(evidence, packName))), generatedBuildSha256: hash(JSON.stringify(built)),
    sourceManifestSha256: hash(JSON.stringify(inputs.filter(entry => entry.path.startsWith("src/")))) };
  for (const [name, value] of Object.entries(seals)) assert.equal(value, authorSummary[name], `independent reproduction of author seal: ${name}`);
  save("original-seals.json", { ...seals, comparedTo: `${checkpoint}:${author}/evidence/author-corrected/summary.json`, exactBody: true, exactMatrixExceptImport: true, reversibleDeclaredConfigOnly: true, configurationDeltas });
  write(join(evidence, "stock-fixture.ts.txt"), stockFixture);
  write(join(evidence, "configured-fixture.ts.txt"), configuredFixture);
  const config = { compilerOptions: { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true,
    forceConsistentCasingInFileNames: true, skipLibCheck: true, types: ["node"], typeRoots: [join(root, "node_modules/@types")],
    rootDir: ".", outDir: "out-stock", noEmitOnError: true },
    include: [matrix, fixture, preflight, mock, `${author}/atomic-mock.ts`, `${author}/controls.ts`, `${owned}/hidden.ts`] };
  write(join(consumer, "tsconfig.json"), JSON.stringify(config, null, 2));
  const strict = name => {
    const result = node(name, [tsc, "-p", "tsconfig.json", "--listFiles"], consumer);
    passed(result);
    const listed = result.stdout.trim().split("\n");
    assert.ok(listed.includes(join(packageRoot, "dist/index.d.ts")));
    assert.equal(listed.some(path => path.startsWith(join(source, "src"))), false);
    save(`${name}.type-closure.json`, listed.map(path => ({ path, sha256: hash(readFileSync(path)) })));
  };
  const publicRun = (name, file, output = "out-configured", extra = {}) => {
    const result = node(name, ["--unhandled-rejections=strict", "--import", join(here, "observe.mjs"), "--test", "--test-reporter=tap", `${output}/${file.replace(/\.ts$/, ".js")}`], consumer,
      { INDEPENDENT_LOAD_LOG: join(evidence, `${name}.modules.jsonl`), ...extra });
    checkClosure(name);
    return result;
  };
  strict("strict-packed-stock");
  const packedStock = publicRun("packed-stock79", matrix, "out-stock");
  write(join(consumer, fixture), configuredFixture, false);
  config.compilerOptions.outDir = "out-configured";
  write(join(consumer, "tsconfig.json"), JSON.stringify(config, null, 2), false);
  strict("strict-packed-configured");
  const configured = publicRun("configured79", matrix);
  const controls = publicRun("author-controls22", `${author}/controls.ts`);
  const hidden = publicRun("independent-hidden", `${owned}/hidden.ts`);
  const probe = `import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; import {Shell,MemoryFileSystem,agentCommands} from 'virtual-bash';
const boundary=JSON.parse(readFileSync('package.json')); assert.notEqual(boundary.name,'virtual-bash');
const resolved=import.meta.resolve('virtual-bash'); assert.equal(resolved,${JSON.stringify(new URL(`file://${join(packageRoot, "dist/index.js")}`).href)});
const shell=new Shell({fs:new MemoryFileSystem()}).use(agentCommands());
try { assert.equal((await shell.exec(':')).exitCode,0); const names=${JSON.stringify(["cat", "cp", "find", "mkdir", "mv", "printf", "pwd", "rm", "rmdir", "sort", "tee", "test", "touch", "xargs", "sed", "awk", "jq", "rg", "sha256sum", "gzip", "diff", "patch"])};
for(const name of names) assert.equal(typeof shell.commands.get(name)?.execute,'function',name);
assert.equal(shell.commands.get('curl'),undefined); assert.equal(shell.commands.get('safejs'),undefined);
console.log(JSON.stringify({boundary:boundary.name,resolved,aggregate:true,requiredNames:names})); } finally {await shell.dispose();}`;
  write(join(consumer, "probe.mjs"), probe);
  const resolution = node("public-boundary", ["--import", join(here, "observe.mjs"), "probe.mjs"], consumer, { INDEPENDENT_LOAD_LOG: join(evidence, "public-boundary.modules.jsonl") });
  passed(resolution);
  checkClosure("public-boundary");
  save("public-boundary.json", JSON.parse(resolution.stdout));
  passed(run("archive-consumer", "tar", ["-czf", join(evidence, "consumer-inputs-and-emission.tar.gz"), "--exclude=node_modules", "-C", consumer, "."], scratch));
  save("consumer-manifest.json", tree(consumer).filter(entry => !entry.path.startsWith("node_modules/")));
  expectedCounts(stock, 79, 78);
  expectedCounts(packedStock, 79, 78);
  for (const result of [stock, packedStock]) assert.deepEqual(result.record.failedRows, ["webdav: create, copy, append, inspect and remove files"]);
  expectedCounts(configured, 79, 79);
  expectedCounts(controls, 22, 22);
  expectedCounts(hidden, 27, 27);
  const helperPath = join(consumer, "out-configured", author, "atomic-mock.js");
  const helper = readFileSync(helperPath, "utf8");
  const mutations = [
    { name: "lost-capability", environment: true },
    { name: "ignore-nonempty", from: 'if (entry.startsWith(`${path}/`))\n                    fail("ENOTEMPTY");', to: 'if (false)\n                    fail("ENOTEMPTY");' },
    { name: "recursive-child-deletion", from: 'if (entry.startsWith(`${path}/`))\n                    fail("ENOTEMPTY");', to: 'if (entry.startsWith(`${path}/`))\n                    backing.files.delete(entry);' },
    { name: "recursive-http-delete", from: 'if (!backing.files.delete(path))', to: 'await backing.fetch(`${namespaceUrl}${path.slice(1)}/`, { method: "DELETE" });\n            if (!true)' },
    { name: "yield-before-delete", from: 'if (!backing.files.delete(path))', to: 'await Promise.resolve();\n            if (!backing.files.delete(path))' },
    { name: "wrong-target", from: 'if (!backing.files.delete(path))', to: 'if (!backing.files.delete(`${path}-sibling`))' },
    { name: "prefix-sibling-refusal", from: 'entry.startsWith(`${path}/`)', to: 'entry.startsWith(path)' },
    { name: "ignore-namespace", from: 'request.namespaceUrl !== namespaceUrl', to: 'false' },
    { name: "wrong-receipt", from: 'namespaceUrl, path, outcome: "removed"', to: 'namespaceUrl, path: "/wrong-target", outcome: "removed"' },
    { name: "ignore-locks", from: 'lock.expires > Date.now()', to: 'false' },
  ];
  const mutationResults = [];
  for (const mutation of mutations) {
    const mutated = mutation.environment ? helper : replaceOnce(helper, mutation.from, mutation.to);
    write(join(evidence, "mutants", `${mutation.name}.js.txt`), mutated);
    write(helperPath, mutated, false);
    const result = publicRun(`mutation-${mutation.name}`, `${owned}/hidden.ts`, "out-configured", mutation.environment ? { INDEPENDENT_MUTATION: mutation.name } : {});
    mutationResults.push({ ...mutation, inputSha256: hash(mutated), status: result.status, counts: result.record.counts, failedRows: result.record.failedRows });
    assert.equal(result.status, 1, `mutation survives: ${mutation.name}`);
    assert.equal(result.record.counts?.tests, 27, "a crash/import failure does not kill a mutation");
    assert.ok(result.record.counts.fail > 0);
    assert.equal(result.record.counts.cancelled + result.record.counts.skipped + result.record.counts.todo, 0);
    write(helperPath, helper, false);
  }
  save("mutation-results.json", mutationResults);
  const restored = publicRun("hidden-restored", `${owned}/hidden.ts`);
  expectedCounts(restored, 27, 27);
  assert.deepEqual(tree(join(source, "dist")), built);
  assert.deepEqual(tree(packageRoot), packed);
  for (const entry of inputs) assert.equal(hash(readFileSync(join(source, entry.path))), entry.sha256);
  const sharedChanges = initialShared.filter(entry => !existsSync(join(root, entry.path)) || hash(readFileSync(join(root, entry.path))) !== entry.sha256);
  save("shared-readonly-after.json", { changedSinceCapture: sharedChanges, note: "Concurrent changes are reported, never reset or attributed without evidence. This runner only writes below its own directory." });
  save("module-closures.json", closures);
  save("summary.json", { frozen, checkpoint, liveHead, seals,
    counts: Object.fromEntries(results.filter(result => result.counts).map(result => [result.name, result.counts])),
    denominatorClassification: { originalMatrixRows: 79, writableBackendRows: 66, otherPositiveRows: 4, readonlyRefusalRows: 9,
      stockPositiveChecksPassed: 69, configuredPositiveChecksPassed: 70, originalReadonlyRefusalsPassed: 9,
      authorControlsSeparate: 22, independentHiddenSeparate: 27, boundedMutants: mutations.length },
    decision: "frozen configured test-only profile independently accepted; stock 78/79 failure retained; no canonical migration or new real-service qualification",
  });
  save("gate.json", { passed: true, profile: "frozen configured mock fixture only", canonicalMigration: false, newRealInterop: false, mutationsKilled: mutationResults.length });
} catch (error) {
  failure = error;
  save("failure.json", { message: String(error), stack: error?.stack, results });
  save("partial-module-closures.json", closures);
  if (existsSync(consumer)) run("failed-consumer-archive", "tar", ["-czf", join(evidence, "failed-consumer-inputs-and-emission.tar.gz"), "--exclude=node_modules", "-C", consumer, "."], scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
  save("cleanup.json", { scratch, removed: !existsSync(scratch), finishedAt: new Date().toISOString(), scope: "only this invocation's owned isolated directory" });
}
if (failure) throw failure;
