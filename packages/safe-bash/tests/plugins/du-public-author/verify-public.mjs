import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const owner = "tests/plugins/du-public-author";
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
assert.ok(process.argv[2] && process.argv[3], "supply committed candidate and installed Node24 executable");
const candidate = git("rev-parse", "--verify", `${process.argv[2]}^{commit}`).toString().trim();
const node24 = realpathSync(process.argv[3]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(readFileSync(fileURLToPath(import.meta.url))), digest(git("show", `${candidate}:${owner}/verify-public.mjs`)), "harness must be committed in the selected candidate");
const directory = realpathSync(mkdtempSync(join(tmpdir(), "du-public-author-")));
const root = join(directory, "candidate"); mkdirSync(root);
const report = { schema: 1, candidate, tree: git("rev-parse", `${candidate}^{tree}`).toString().trim(), directory, startedAt: new Date().toISOString(), scope: "DU author public integration and explicit owned-output adoption; no whole gate, service or independent acceptance", commands: [], checks: [], failures: [] };
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
console.log(JSON.stringify({ candidate, directory }));
function run(name, executable, args, cwd = root, expected = 0) {
  const env = { PATH: `${dirname(realpathSync(executable))}:/usr/bin:/bin`, LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: directory, TSX_DISABLE_CACHE: "1", npm_config_cache: join(directory, "npm-cache") };
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  const record = { name, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  json(join(directory, `${name}.json`), record); report.commands.push({ name, status: result.status, expected, log: `${name}.json` });
  if (result.status !== expected || result.signal || result.error) report.failures.push({ name, expected, status: result.status, signal: result.signal, error: result.error?.message });
  return result;
}
function check(name, callback) {
  try { callback(); report.checks.push({ name, status: "pass" }); }
  catch (error) { report.checks.push({ name, status: "fail", error: error.stack }); report.failures.push({ name, error: error.message }); }
}
function manifest(directory, excludedRoots = []) {
  const records = [];
  const walk = prefix => {
    for (const name of readdirSync(join(directory, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name, stat = lstatSync(join(directory, path));
      if (excludedRoots.includes(path)) continue;
      assert.equal(stat.isSymbolicLink(), false, `unexpected symlink: ${path}`);
      if (stat.isDirectory()) { records.push({ path, kind: "directory" }); walk(path); }
      else { assert.equal(stat.isFile(), true); records.push({ path, kind: "file", sha256: digest(readFileSync(join(directory, path))) }); }
    }
  };
  walk(""); return records;
}

try {
  const selected = ["src", "scripts", "package.json", "package-lock.json", "README.md", "tsconfig.json", "tsconfig.build.json", owner,
    "tests/commands/du", "tests/fs/webdav/mock.ts", "tests/plugins/html-to-markdown-public-author/lifecycle.test.ts", "tests/commands/html-to-markdown/helpers.ts", "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration",
    "tests/plugins/qualified-current-release", "tests/plugins/stream-five-public", "tests/integration/stream-inspection-public-author/consumer.mts"];
  const archive = join(directory, "candidate.tar");
  git("archive", `--output=${archive}`, candidate, ...selected);
  report.archiveSha256 = digest(readFileSync(archive));
  execFileSync("/usr/bin/tar", ["-xf", archive, "-C", root]);
  report.archiveBefore = manifest(root);
  const entries = git("ls-tree", "-rz", candidate, "--", ...selected).toString().split("\0").filter(Boolean).map(line => {
    const [metadata, path] = line.split("\t"), [mode, type, blob] = metadata.split(" "); return { mode, type, blob, path };
  });
  check("every selected input matches committed Git blob and regular-file mode", () => {
    for (const entry of entries) {
      assert.equal(entry.type, "blob"); assert.ok(["100644", "100755"].includes(entry.mode), entry.path);
      const bytes = readFileSync(join(root, entry.path));
      assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.blob, entry.path);
    }
  });
  report.inputBindings = entries.map(entry => ({ ...entry, sha256: digest(readFileSync(join(root, entry.path))) }));
  report.buildInputsSha256 = digest(JSON.stringify(report.inputBindings.filter(entry => entry.path.startsWith("src/") || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"].includes(entry.path))));
  cpSync(join(repository, "node_modules"), join(root, "node_modules"), { recursive: true, dereference: true });
  report.tooling = ["node_modules/typescript/package.json", "node_modules/typescript/lib/_tsc.js", "node_modules/tsx/package.json", "node_modules/@types/node/package.json"].map(path => ({ path, sha256: digest(readFileSync(join(root, path))) }));
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  const built = run("build", process.execPath, [compiler, "-p", "tsconfig.build.json"]);
  assert.equal(built.status, 0, "cannot proceed without a complete product build");
  report.emittedBefore = manifest(join(root, "dist"));
  const moduleTests = entries.filter(entry => entry.path.startsWith("tests/commands/du/") && entry.path.endsWith(".test.ts") && !entry.path.endsWith("/native.test.ts")).map(entry => entry.path);
  const sourceTests = [`${owner}/lifecycle.test.ts`, "tests/plugins/html-to-markdown-public-author/lifecycle.test.ts", ...moduleTests, "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration/registry.test.ts"];
  const canonical = run("source-scoped", process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...sourceTests]);
  report.sourceCounts = Object.fromEntries([...canonical.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  check("166 explicit DU/HTML-lifecycle/registry tests execute without skips", () => assert.deepEqual(report.sourceCounts, { tests: 166, pass: 166, fail: 0, cancelled: 0, skipped: 0, todo: 0 }));
  const scopedConfig = join(directory, "scoped-types.json");
  json(scopedConfig, { extends: join(root, "tsconfig.json"), compilerOptions: { noEmit: true, rootDir: root, typeRoots: [join(root, "node_modules/@types")] }, files: sourceTests.map(path => join(root, path)), include: [], exclude: [] });
  run("source-scoped-types", process.execPath, [compiler, "-p", scopedConfig]);
  const npm = realpathSync(join(dirname(process.execPath), "npm")), packDirectory = join(directory, "pack"); mkdirSync(packDirectory);
  const packed = run("pack", process.execPath, [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory]);
  assert.equal(packed.status, 0);
  const tarball = join(packDirectory, JSON.parse(packed.stdout)[0].filename), extracted = join(directory, "extracted"); mkdirSync(extracted);
  execFileSync("/usr/bin/tar", ["-xf", tarball, "-C", extracted]);
  const moved = join(directory, "moved package with spaces", "consumer"), installed = join(moved, "node_modules/virtual-bash"); mkdirSync(dirname(installed), { recursive: true });
  renameSync(join(extracted, "package"), installed); json(join(moved, "package.json"), { private: true, type: "module" });
  report.package = { metadataSha256: digest(readFileSync(join(root, "package.json"))), tarballSha256: digest(readFileSync(tarball)), tarball, installed, before: manifest(installed) };
  const metadata = JSON.parse(readFileSync(join(installed, "package.json")));
  check("zero runtime dependencies and exact explicit DU export", () => {
    assert.deepEqual(metadata.dependencies ?? {}, {}); assert.equal(existsSync(join(installed, "src")), false);
    assert.deepEqual(metadata.exports["./commands/du"], { types: "./dist/commands/du/index.d.ts", import: "./dist/commands/du/index.js" });
  });
  const inputPairs = [[`${owner}/consumer.ts.fixture`, "consumer.ts"], [`${owner}/lifecycle.ts.fixture`, "lifecycle.ts"],
    ["tests/integration/stream-inspection-public-author/consumer.mts", "stream-consumer.mts"], ["tests/plugins/stream-five-fixture-migration/public-options.mts", "stream-options.mts"]];
  report.stagedInputs = inputPairs.map(([source, name]) => {
    cpSync(join(root, source), join(moved, name)); assert.deepEqual(readFileSync(join(moved, name)), readFileSync(join(root, source)));
    return { source, name, sha256: digest(readFileSync(join(moved, name))) };
  });
  const config = JSON.parse(readFileSync(join(root, "tests/plugins/qualified-current-release/tsconfig.consumer.json")));
  Object.assign(config.compilerOptions, { typeRoots: [join(root, "node_modules/@types")], rootDir: moved, outDir: moved });
  config.files = inputPairs.map(([, name]) => join(moved, name)); json(join(moved, "tsconfig.json"), config);
  const compiled = run("packed-types", process.execPath, [compiler, "-p", join(moved, "tsconfig.json"), "--traceResolution"]);
  const bindingModule = await import(pathToFileURL(join(root, "scripts/typecheck-consumers.mjs")));
  const binding = bindingModule.createBuiltPackageBinding(root);
  check("strict public and relative declarations resolve only to this built candidate", () => bindingModule.assertBuiltConsumerResolution(compiled.stdout, moved, root, binding));
  cpSync(join(root, owner, "negative.ts.fixture"), join(moved, "negative.ts"));
  json(join(moved, "negative.json"), { ...config, compilerOptions: { ...config.compilerOptions, noEmit: true }, files: [join(moved, "negative.ts")] });
  const negative = run("packed-negative-types", process.execPath, [compiler, "-p", join(moved, "negative.json"), "--pretty", "false"], root, 2);
  check("four intended negative type errors, not unrelated compiler errors", () => {
    const lines = negative.stdout.split("\n").filter(line => /error TS/u.test(line)); assert.equal(lines.length, 4);
    assert.deepEqual(lines.map(line => /\((\d+),\d+\): error (TS\d+)/u.exec(line)?.slice(1)), [["3", "TS2353"], ["4", "TS2322"], ["5", "TS2353"], ["6", "TS2339"]]);
  });
  const runtimeFiles = ["consumer.js", "lifecycle.js", "stream-consumer.mjs", "stream-options.mjs"];
  const loadedInputs = Object.fromEntries([
    ...report.package.before.filter(entry => entry.kind === "file").map(entry => [join(installed, entry.path), entry.sha256]),
    ...runtimeFiles.map(name => [join(moved, name), digest(readFileSync(join(moved, name)))]),
  ]);
  const guard = join(moved, "guard.mjs");
  writeFileSync(guard, `import assert from 'node:assert/strict';\nimport { registerHooks } from 'node:module';\nimport { createHash } from 'node:crypto';\nimport { fileURLToPath } from 'node:url';\nconst expected = ${JSON.stringify(loadedInputs)};\nconst observed = new Map();\nregisterHooks({load(url, context, nextLoad) { const result=nextLoad(url,context); if(url.startsWith('file:')) { const path=fileURLToPath(url); assert.ok(expected[path], 'unexpected loaded file: '+path); assert.ok(result.source!==undefined && result.source!==null, 'missing loaded source: '+path); const sha256=createHash('sha256').update(result.source).digest('hex'); assert.equal(sha256,expected[path],path); observed.set(path,sha256); } return result; }});\nprocess.once('exit',()=>console.log(JSON.stringify({loadBindings:[...observed],execPath:process.execPath,version:process.version})));\n`);
  report.runtimeGuard = { sha256: digest(readFileSync(guard)), expected: loadedInputs, scope: "main-thread loaded module bytes; no claim of worker dependency tracing" };
  const permissions = await import(pathToFileURL(join(root, "scripts/verify-current-consumers.mjs")));
  report.runtimes = [];
  for (const [index, executable] of [process.execPath, node24].entries()) {
    const permissionDirectory = join(directory, `permissions-${index}`); mkdirSync(permissionDirectory);
    const admission = permissions.probeConsumerPermission({ root, directory: permissionDirectory }, executable);
    report.runtimes.push(admission);
    const flags = permissions.consumerPermissionArgs(admission, moved, true);
    for (const filename of runtimeFiles) {
      const result = run(`runtime-${index}-${filename}`, executable, [...flags, "--import", guard, join(moved, filename)], moved);
      check(`runtime ${index} ${filename} authenticates actual loaded root and DU bytes`, () => {
        const receipt = result.stdout.trim().split("\n").map(line => JSON.parse(line)).find(value => value.loadBindings);
        assert.ok(receipt); assert.equal(realpathSync(receipt.execPath), admission.executable); assert.equal(receipt.version, admission.identity.version);
        const observed = new Map(receipt.loadBindings);
        for (const path of ["dist/index.js", "dist/commands/du/index.js", "dist/commands/du/du.js"]) assert.equal(observed.get(join(installed, path)), loadedInputs[join(installed, path)]);
      });
    }
    const forbidden = join(root, "src/index.ts");
    const denied = run(`source-denial-${index}`, executable, [...flags, "--input-type=module", "-e", `import {readFileSync} from 'node:fs'; readFileSync(${JSON.stringify(forbidden)});`], moved, 1);
    check(`runtime ${index} source denial is actual permission failure`, () => { assert.match(denied.stderr, /ERR_ACCESS_DENIED/u); assert.ok(denied.stderr.includes(forbidden)); });
  }
  for (const [name, mutation, diagnostic] of [
    ["missing-root", path => renameSync(join(path, "dist/index.js"), join(path, "dist/index.js.disabled")), /ERR_MODULE_NOT_FOUND/u],
    ["missing-du", path => renameSync(join(path, "dist/commands/du/index.js"), join(path, "dist/commands/du/index.js.disabled")), /ERR_MODULE_NOT_FOUND/u],
    ["missing-export", path => { const value = JSON.parse(readFileSync(join(path, "package.json"))); delete value.exports["./commands/du"]; json(join(path, "package.json"), value); }, /ERR_PACKAGE_PATH_NOT_EXPORTED/u],
  ]) {
    const control = join(directory, name, "consumer"); cpSync(moved, control, { recursive: true }); mutation(join(control, "node_modules/virtual-bash"));
    const result = run(name, node24, [...permissions.consumerPermissionArgs(report.runtimes[1], control, true), join(control, "consumer.js")], control, 1);
    check(`${name} rejects rather than loading repository fallback`, () => assert.match(result.stderr, diagnostic));
  }
  const missingTypes = join(directory, "missing-types", "consumer"); cpSync(moved, missingTypes, { recursive: true });
  renameSync(join(missingTypes, "node_modules/virtual-bash/dist/commands/du/index.d.ts"), join(missingTypes, "node_modules/virtual-bash/dist/commands/du/index.d.ts.disabled"));
  json(join(missingTypes, "tsconfig.json"), { ...config, compilerOptions: { ...config.compilerOptions, noEmit: true, rootDir: missingTypes, outDir: missingTypes }, files: [join(missingTypes, "consumer.ts")] });
  const missing = run("missing-types", process.execPath, [compiler, "-p", join(missingTypes, "tsconfig.json"), "--pretty", "false"], missingTypes, 2);
  check("missing installed public DU declarations refuse source fallback", () => assert.match(missing.stdout, /TS7016.*virtual-bash\/commands\/du/u));
  report.package.after = manifest(installed); check("positive installed package unchanged, including no added entries", () => assert.deepEqual(report.package.after, report.package.before));
  report.emitted = manifest(join(root, "dist"));
  check("built output unchanged including no added entries", () => assert.deepEqual(report.emitted, report.emittedBefore));
  report.archiveAfter = manifest(root, ["node_modules", "dist"]);
  check("selected committed archive source/tests/artifacts unchanged with no added entries", () => assert.deepEqual(report.archiveAfter, report.archiveBefore));
} catch (error) { report.failures.push({ name: "fatal", error: error.stack }); }
finally {
  report.finishedAt = new Date().toISOString(); report.status = report.failures.length ? "fail" : "pass";
  json(join(directory, "REPORT.json"), report);
  console.log(JSON.stringify({ directory, candidate, status: report.status, commands: report.commands.length, checks: report.checks.length, failures: report.failures }));
  if (report.failures.length) process.exitCode = 1;
}
