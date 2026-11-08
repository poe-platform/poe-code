import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url)), owner = "tests/plugins/expr-public-author";
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
assert.ok(process.argv[2] && process.argv[3], "supply committed candidate and installed Node24 executable");
const candidate = git("rev-parse", `${process.argv[2]}^{commit}`).toString().trim(), node24 = realpathSync(process.argv[3]);
assert.equal(digest(readFileSync(fileURLToPath(import.meta.url))), digest(git("show", `${candidate}:${owner}/verify-public.mjs`)));
const directory = realpathSync(mkdtempSync(join(tmpdir(), "expr-public-author-"))), root = join(directory, "candidate"); mkdirSync(root);
const report = { candidate, tree: git("rev-parse", `${candidate}^{tree}`).toString().trim(), directory, startedAt: new Date().toISOString(), scope: "expr76 author public integration, not independent26 or whole gate", commands: [], checks: [], failures: [], guards: [] };
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
function run(name, executable, args, cwd = root, expected = 0) {
  const result = spawnSync(executable, args, { cwd, env: { PATH: `${dirname(realpathSync(executable))}:/usr/bin:/bin`, HOME: directory, LC_ALL: "C", LANG: "C", TZ: "UTC", TSX_DISABLE_CACHE: "1", npm_config_cache: join(directory, "npm-cache") }, encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  json(join(directory, `${name}.json`), { name, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  report.commands.push({ name, status: result.status, expected });
  if (result.status !== expected || result.signal || result.error) report.failures.push({ name, expected, status: result.status, signal: result.signal, error: result.error?.message });
  return result;
}
function check(name, callback) { try { callback(); report.checks.push({ name, status: "pass" }); } catch (error) { report.checks.push({ name, status: "fail", error: error.stack }); report.failures.push({ name, error: error.message }); } }
function manifest(base, exclusions = []) {
  const rows = [];
  function walk(prefix) {
    for (const name of readdirSync(join(base, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name; if (exclusions.includes(path)) continue;
      const stat = lstatSync(join(base, path)); assert.equal(stat.isSymbolicLink(), false, path);
      if (stat.isDirectory()) { rows.push({ path, kind: "directory" }); walk(path); }
      else { assert.equal(stat.isFile(), true); rows.push({ path, kind: "file", sha256: digest(readFileSync(join(base, path))) }); }
    }
  }
  walk(""); return rows;
}
console.log(JSON.stringify({ candidate, directory }));
try {
  const selected = ["src", "scripts", "package.json", "package-lock.json", "README.md", "tsconfig.json", "tsconfig.build.json", owner,
    "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration", "tests/plugins/du-public-author/lifecycle.test.ts", "tests/commands/du/helpers.ts",
    "tests/plugins/html-to-markdown-public-author/lifecycle.test.ts", "tests/commands/html-to-markdown/helpers.ts", "tests/plugins/qualified-current-release", "tests/plugins/stream-five-public", "tests/integration/stream-inspection-public-author/consumer.mts"];
  const archive = join(directory, "candidate.tar"); git("archive", `--output=${archive}`, candidate, ...selected); report.archiveSha256 = digest(readFileSync(archive)); execFileSync("/usr/bin/tar", ["-xf", archive, "-C", root]);
  report.archiveBefore = manifest(root);
  report.inputs = git("ls-tree", "-rz", candidate, "--", ...selected).toString().split("\0").filter(Boolean).map(line => { const [metadata, path] = line.split("\t"), [mode, type, gitBlob] = metadata.split(" "); return { path, mode, type, gitBlob, sha256: digest(git("show", `${candidate}:${path}`)) }; });
  check("selected input bytes and modes are committed candidate blobs", () => { for (const entry of report.inputs) { assert.equal(entry.mode, "100644"); assert.equal(digest(readFileSync(join(root, entry.path))), entry.sha256); } });
  const pre = JSON.parse(readFileSync(join(root, owner, "PRE-WIRING.json")));
  check("all nine engine/shared-regex sources remain accepted c3 bytes", () => { assert.equal(pre.engineBindings.length, 9); for (const entry of pre.engineBindings) assert.equal(digest(readFileSync(join(root, entry.path))), entry.sha256); });
  cpSync(join(repository, "node_modules"), join(root, "node_modules"), { recursive: true, dereference: true });
  report.tools = [process.execPath, node24, join(root, "node_modules/typescript/lib/_tsc.js"), join(root, "node_modules/tsx/package.json")].map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const compiler = join(root, "node_modules/typescript/bin/tsc"); assert.equal(run("build", process.execPath, [compiler, "-p", "tsconfig.build.json"]).status, 0);
  report.emittedBefore = manifest(join(root, "dist"));
  const sourceTests = [`${owner}/registration.test.ts`, "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration/registry.test.ts", "tests/plugins/du-public-author/lifecycle.test.ts", "tests/plugins/html-to-markdown-public-author/lifecycle.test.ts"];
  const tested = run("source-scoped", process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...sourceTests]);
  report.sourceCounts = Object.fromEntries([...tested.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  check("74 scoped current author/registry/lifecycle tests execute", () => assert.deepEqual(report.sourceCounts, { tests: 74, pass: 74, fail: 0, cancelled: 0, skipped: 0, todo: 0 }));
  const scoped = join(directory, "scoped-types.json"); json(scoped, { extends: join(root, "tsconfig.json"), compilerOptions: { noEmit: true, rootDir: root, typeRoots: [join(root, "node_modules/@types")] }, files: sourceTests.map(path => join(root, path)), include: [], exclude: [] }); run("source-types", process.execPath, [compiler, "-p", scoped]);
  const npm = realpathSync(join(dirname(process.execPath), "npm")), pack = join(directory, "pack"); mkdirSync(pack);
  const packed = run("pack", process.execPath, [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", pack]); assert.equal(packed.status, 0);
  const tarball = join(pack, JSON.parse(packed.stdout)[0].filename), extracted = join(directory, "extracted"); mkdirSync(extracted); execFileSync("/usr/bin/tar", ["-xf", tarball, "-C", extracted]);
  let consumer = join(directory, "installed", "consumer"), installed = join(consumer, "node_modules/virtual-bash"); mkdirSync(dirname(installed), { recursive: true }); renameSync(join(extracted, "package"), installed); json(join(consumer, "package.json"), { private: true, type: "module" });
  report.package = { metadataSha256: digest(readFileSync(join(root, "package.json"))), tarballSha256: digest(readFileSync(tarball)), tarball, before: manifest(installed) };
  const metadata = JSON.parse(readFileSync(join(installed, "package.json")));
  check("full package has explicit expr runtime/types and no runtime dependencies", () => { assert.deepEqual(metadata.dependencies ?? {}, {}); assert.deepEqual(metadata.exports["./commands/expr"], { types: "./dist/commands/expr/index.d.ts", import: "./dist/commands/expr/index.js" }); assert.equal(existsSync(join(installed, "src")), false); });
  const typePairs = [[`${owner}/positive.ts.fixture`, "positive.ts"], ["tests/integration/stream-inspection-public-author/consumer.mts", "stream-consumer.mts"], ["tests/plugins/stream-five-fixture-migration/public-options.mts", "stream-options.mts"]];
  report.stagedInputs = typePairs.map(([source, name]) => { cpSync(join(root, source), join(consumer, name)); assert.deepEqual(readFileSync(join(consumer, name)), readFileSync(join(root, source))); return { source, name, sha256: digest(readFileSync(join(consumer, name))) }; });
  for (const name of ["public.mjs", "observer.mjs", "silent-worker.mjs", "worker-layout-control.mjs", "PRE-WIRING.json"]) cpSync(join(root, owner, name), join(consumer, name));
  cpSync(join(root, owner, "negative.ts.fixture"), join(consumer, "negative.ts"));
  const baseConfig = JSON.parse(readFileSync(join(root, "tests/plugins/qualified-current-release/tsconfig.consumer.json")));
  const bindings = await import(pathToFileURL(join(root, "scripts/typecheck-consumers.mjs"))), packageBinding = bindings.createBuiltPackageBinding(root);
  const permissions = await import(pathToFileURL(join(root, "scripts/verify-current-consumers.mjs"))); report.runtimes = [];
  for (const [index, executable] of [process.execPath, node24].entries()) { const target = join(directory, `permissions-${index}`); mkdirSync(target); report.runtimes.push(permissions.probeConsumerPermission({ root, directory: target }, executable)); }
  const runtimeFiles = ["positive.js", "public.mjs", "stream-consumer.mjs", "stream-options.mjs"];
  for (const phase of ["installed", "moved"]) {
    if (phase === "moved") { const previous = consumer; consumer = join(directory, "moved package with spaces", "consumer"); mkdirSync(dirname(consumer)); renameSync(previous, consumer); assert.equal(existsSync(previous), false); installed = join(consumer, "node_modules/virtual-bash"); }
    const config = { ...baseConfig, compilerOptions: { ...baseConfig.compilerOptions, typeRoots: [join(root, "node_modules/@types")], rootDir: consumer, outDir: consumer }, files: typePairs.map(([, name]) => join(consumer, name)) };
    json(join(consumer, "tsconfig.json"), config);
    const compiled = run(`${phase}-types`, process.execPath, [compiler, "-p", join(consumer, "tsconfig.json"), "--traceResolution"], consumer);
    check(`${phase}: declarations resolve only to this candidate package`, () => bindings.assertBuiltConsumerResolution(compiled.stdout, consumer, root, packageBinding));
    json(join(consumer, "negative.json"), { ...config, compilerOptions: { ...config.compilerOptions, noEmit: true }, files: [join(consumer, "negative.ts")] });
    const negative = run(`${phase}-negative-types`, process.execPath, [compiler, "-p", join(consumer, "negative.json"), "--pretty", "false"], consumer, 2);
    check(`${phase}: six intended negative type diagnostics`, () => { const lines = negative.stdout.split("\n").filter(line => /error TS/u.test(line)); assert.deepEqual(lines.map(line => /\((\d+),\d+\): error (TS\d+)/u.exec(line)?.slice(1)), [["3", "TS2353"], ["4", "TS2353"], ["5", "TS2322"], ["6", "TS2322"], ["7", "TS2353"], ["8", "TS2339"]]); });
    const expected = Object.fromEntries([...report.package.before.filter(row => row.kind === "file").map(row => [join(installed, row.path), row.sha256]), ...[...runtimeFiles, "observer.mjs", "silent-worker.mjs"].map(name => [join(consumer, name), digest(readFileSync(join(consumer, name)))])]);
    const common = `import assert from 'node:assert/strict'; import {registerHooks} from 'node:module'; import {createHash} from 'node:crypto'; import {fileURLToPath} from 'node:url'; const expected=${JSON.stringify(expected)}; const observed=new Map(); registerHooks({load(url,context,next){const result=next(url,context);if(url.startsWith('file:')){const path=fileURLToPath(url);assert.ok(expected[path],'unexpected loaded path: '+path);assert.ok(result.source!==null&&result.source!==undefined,'missing source: '+path);const sha256=createHash('sha256').update(result.source).digest('hex');assert.equal(sha256,expected[path],path);observed.set(path,sha256);WORKER_RECEIPT}return result;}});`;
    const guard = join(consumer, "guard.mjs"), workerGuard = join(consumer, "worker-guard.mjs");
    writeFileSync(guard, common.replace("WORKER_RECEIPT", "") + `process.once('beforeExit',()=>process.stdout.write(JSON.stringify({loadBindings:[...observed],execPath:process.execPath,version:process.version})+'\\n',error=>{if(error)throw error;}));\n`);
    writeFileSync(workerGuard, common.replace("WORKER_RECEIPT", `process.stderr.write('EXPR_WORKER_LOAD '+JSON.stringify({path,sha256})+'\\n');`) + "\n");
    report.guards.push({ phase, expected, mainSha256: digest(readFileSync(guard)), workerSha256: digest(readFileSync(workerGuard)), qualification: "trusted test-only worker loader appended before unchanged worker entry; stderr receipts, no product reply injection" });
    for (const [index, executable] of [process.execPath, node24].entries()) {
      const admission = report.runtimes[index], flags = permissions.consumerPermissionArgs(admission, consumer, true);
      for (const filename of runtimeFiles) {
        const result = run(`${phase}-${index}-${filename}`, executable, [...flags, "--import", guard, join(consumer, filename)], consumer);
        check(`${phase} runtime${index} ${filename}: actual root/expr source binding`, () => {
          const lines = result.stdout.trim().split("\n").map(line => JSON.parse(line)), loaded = lines.find(line => line.loadBindings);
          assert.ok(loaded); assert.equal(realpathSync(loaded.execPath), admission.executable); assert.equal(loaded.version, admission.identity.version);
          const actual = new Map(loaded.loadBindings); for (const path of ["dist/index.js", "dist/commands/expr/index.js"]) assert.equal(actual.get(join(installed, path)), expected[join(installed, path)]);
          if (filename === "public.mjs") { const observation = lines.find(line => line.authorPublicCases); assert.equal(observation.authorPublicCases.length, 12); assert.ok(observation.observer.workers.every(worker => worker.closed)); }
        });
      }
    }
    check(`${phase}: full installed package unchanged including added entries`, () => assert.deepEqual(manifest(installed), report.package.before));
  }
  for (const [index, executable] of [process.execPath, node24].entries()) {
    const forbidden = join(root, "src/index.ts"), flags = permissions.consumerPermissionArgs(report.runtimes[index], consumer, true);
    const result = run(`source-denial-${index}`, executable, [...flags, "--input-type=module", "-e", `import {readFileSync} from 'node:fs';readFileSync(${JSON.stringify(forbidden)});`], consumer, 1);
    check(`runtime${index}: source-read is genuinely denied`, () => { assert.match(result.stderr, /ERR_ACCESS_DENIED/u); assert.ok(result.stderr.includes(forbidden)); });
  }
  for (const [name, mutation, diagnostic] of [
    ["missing-root", path => renameSync(join(path, "dist/index.js"), join(path, "dist/index.js.disabled")), /ERR_MODULE_NOT_FOUND/u],
    ["missing-expr", path => renameSync(join(path, "dist/commands/expr/index.js"), join(path, "dist/commands/expr/index.js.disabled")), /ERR_MODULE_NOT_FOUND/u],
    ["missing-export", path => { const value = JSON.parse(readFileSync(join(path, "package.json"))); delete value.exports["./commands/expr"]; json(join(path, "package.json"), value); }, /ERR_PACKAGE_PATH_NOT_EXPORTED/u],
  ]) {
    const control = join(directory, name, "consumer"); cpSync(consumer, control, { recursive: true }); mutation(join(control, "node_modules/virtual-bash"));
    const result = run(name, node24, [...permissions.consumerPermissionArgs(report.runtimes[1], control, true), join(control, "positive.js")], control, 1);
    check(`${name}: no repository fallback`, () => assert.match(result.stderr, diagnostic));
  }
  const missingTypes = join(directory, "missing-types", "consumer"); cpSync(consumer, missingTypes, { recursive: true }); renameSync(join(missingTypes, "node_modules/virtual-bash/dist/commands/expr/index.d.ts"), join(missingTypes, "node_modules/virtual-bash/dist/commands/expr/index.d.ts.disabled"));
  json(join(missingTypes, "tsconfig.json"), { ...baseConfig, compilerOptions: { ...baseConfig.compilerOptions, noEmit: true, typeRoots: [join(root, "node_modules/@types")] }, files: [join(missingTypes, "positive.ts")] });
  const missing = run("missing-types", process.execPath, [compiler, "-p", join(missingTypes, "tsconfig.json"), "--pretty", "false"], missingTypes, 2);
  check("missing expr declarations cannot fall back to source", () => assert.match(missing.stdout, /TS7016.*virtual-bash\/commands\/expr/u));
  for (const status of [0, 3]) {
    const control = join(directory, `worker-layout-${status}`, "consumer"); cpSync(consumer, control, { recursive: true });
    if (status === 3) renameSync(join(control, "node_modules/virtual-bash/dist/commands/regex-execution/worker.js"), join(control, "node_modules/virtual-bash/dist/commands/regex-execution/worker.js.disabled"));
    run(`worker-layout-${status}`, node24, [...permissions.consumerPermissionArgs(report.runtimes[1], control, true), join(control, "worker-layout-control.mjs"), String(status)], control);
  }
  report.package.after = manifest(installed); report.package.finalInstalled = installed; check("positive package still unchanged", () => assert.deepEqual(report.package.after, report.package.before));
  report.emittedAfter = manifest(join(root, "dist")); check("built output unchanged", () => assert.deepEqual(report.emittedAfter, report.emittedBefore));
  report.archiveAfter = manifest(root, ["node_modules", "dist"]); check("selected archive unchanged with no added entries", () => assert.deepEqual(report.archiveAfter, report.archiveBefore));
} catch (error) { report.failures.push({ name: "fatal", error: error.stack }); }
finally { report.finishedAt = new Date().toISOString(); report.status = report.failures.length ? "fail" : "pass"; json(join(directory, "REPORT.json"), report); console.log(JSON.stringify({ directory, candidate, status: report.status, commands: report.commands.length, checks: report.checks.length, failures: report.failures })); if (report.failures.length) process.exitCode = 1; }
