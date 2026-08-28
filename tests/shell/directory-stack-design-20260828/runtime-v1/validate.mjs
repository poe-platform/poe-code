import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "../../../../node_modules/typescript/lib/typescript.js";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const version = process.argv[2];
assert.match(version, /^\d{2}$/);
const candidate = process.argv[3] ?? "WORKTREE";
const full = process.argv[4] === "full";
const output = path.join(own, `candidate-${version}.json.gz.base64`);
assert.equal(fs.existsSync(output), false);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 96 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const base = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const provider = "ca1d33424b94a21ae0f40a36412fd8191611e2df";
const letCommit = "c26892c3a1a419311c9cf46a6c2976e696e00624";
const authorRelative = path.relative(repository, own);
const runtimePath = "src/shell/runtime.ts";
const shellPath = "src/shell/shell.ts";
const candidateBytes = Object.fromEntries([runtimePath, shellPath].map(name => [name, candidate === "WORKTREE" ? fs.readFileSync(path.join(repository, name)) : git("show", `${candidate}:${name}`)]));
const originalRuntime = git("show", `${letCommit}:${runtimePath}`);
const sourceTree = bytes => ts.createSourceFile("runtime.ts", bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const beforeTree = sourceTree(originalRuntime), afterTree = sourceTree(candidateBytes[runtimePath]);
const runtimeClass = tree => tree.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === "Runtime");
const beforeRuntime = runtimeClass(beforeTree), afterRuntime = runtimeClass(afterTree);
const allowedMembers = new Set(["simple", "dispatchScoped", "processState", "builtin"]);
const unchangedMembers = [];
for (const member of beforeRuntime.members) {
  const name = member.name?.getText(beforeTree) ?? "constructor";
  const current = afterRuntime.members.find(item => (item.name?.getText(afterTree) ?? "constructor") === name);
  assert.ok(current, name);
  if (!allowedMembers.has(name)) { assert.equal(current.getText(afterTree), member.getText(beforeTree), name); unchangedMembers.push(name); }
  else if (name === "simple") assert.equal(current.getText(afterTree).replace(', directoryStack: { entries: [...state.directoryStack?.entries ?? []], bytes: state.directoryStack?.bytes ?? 0 }', ''), member.getText(beforeTree));
  else if (name === "dispatchScoped") assert.equal(current.getText(afterTree).replace('      const directoryStackCwdPublication = state.directoryStackCwdPublication;\n', '').replace(' && state.directoryStackCwdPublication === directoryStackCwdPublication', ''), member.getText(beforeTree));
  else if (name === "processState") assert.equal(current.getText(afterTree).replace('      directoryStack: { entries: [], bytes: 0 },\n', ''), member.getText(beforeTree));
  else {
    const kept = (body, tree) => body.statements.filter(statement => !(ts.isIfStatement(statement) && ['command === "cd"', 'command === "pushd" || command === "dirs" || command === "popd"'].includes(statement.expression.getText(tree)))).map(statement => statement.getText(tree));
    assert.deepEqual(kept(current.body, afterTree), kept(member.body, beforeTree));
  }
}
assert.equal(afterRuntime.members.length, beforeRuntime.members.length + 2);
const topLevelName = statement => statement.name?.getText() ?? (ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.name.getText() : undefined);
const unchangedTopLevel = [];
for (const statement of beforeTree.statements) {
  const name = topLevelName(statement);
  if (["Runtime", "shellBuiltinNames", "State", "cloneState"].includes(name)) continue;
  assert.ok(afterTree.statements.some(current => current.getText(afterTree) === statement.getText(beforeTree)), name ?? "import");
  unchangedTopLevel.push(name ?? "import");
}
assert.deepEqual(candidateBytes[shellPath].toString().replace("          directoryStack: { entries: [], bytes: 0 },\n", ""), git("show", `${base}:${shellPath}`).toString());
const regressionTests = ["core", "variable-scope", "runtime-regressions", "fs-error-diagnostics", "env-replacement", "env-replacement-bounds", "invoke", "invocation-cleanup", "invocation-cleanup-pipeline", "output-accounting", "output-accounting-bounds", "streaming"].map(name => `tests/shell/${name}.test.ts`);
regressionTests.push(...["state", "host", "ordering"].map(name => `tests/shell/getopts/runtime/${name}.test.ts`));
const cancellationTest = "tests/shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts";
const ownedTests = ["operation", "shell", "network"].map(name => `tests/integration/owned-output-production-rebase/author/${name}.test.ts`);
const names = git("ls-tree", "-r", "--name-only", base, "src", "package.json", "README.md", "tsconfig.json", "tsconfig.build.json", ...regressionTests, "tests/shell/helpers.ts", "tests/shell/getopts/runtime/helpers.ts", "tests/shell/bash-bugfix-helpers.ts", "tests/shell/env-replacement-bounds.ts", "tests/shell/output-accounting-bounds.ts", ...ownedTests, "tests/integration/owned-output-production-rebase/author/helpers.ts", "tests/shell/getopts-independent-20260827/stage2/corpus.mjs", "tests/shell/getopts-independent-20260827/stage2/fixtures").toString().trim().split("\n");
const inputs = names.map(name => ({ name, commit: name === runtimePath ? letCommit : name === "src/fs/webdav/webdav.ts" || name === "src/fs/webdav/README.md" ? provider : base }));
inputs.push({ name: cancellationTest, commit: "43af14a520160fad4e144a6b60c30ca123bd9ab9" });
const cdRoot = "tests/shell/cd-prerequisite-20260828";
const cdTests = ["cd.test.ts", "native-mapping.test.ts"].map(name => `${cdRoot}/runtime-v1/${name}`);
for (const name of [...cdTests, `${cdRoot}/observations-01.json.gz.base64`]) inputs.push({ name, commit: "8c0c17f0f5e7670d06cd7e9a0a8da3995e970375" });
const letRoot = "tests/shell/let-author-20260828";
for (const name of [`${letRoot}/checks.mjs`, `${letRoot}/evidence-v1/frozen-cases.json`]) inputs.push({ name, commit: "e3ac05413edddb8ce5dff73e6e8ff543e7946e41" });
assert.equal(new Set(inputs.map(input => input.name)).size, inputs.length);
assert.ok(inputs.every(input => !input.name.endsWith("AGENTS.md")));
const batch = spawnSync("git", ["cat-file", "--batch"], { cwd: repository, input: inputs.map(input => `${input.commit}:${input.name}`).join("\n") + "\n", maxBuffer: 96 * 1024 * 1024 });
assert.equal(batch.status, 0);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safe-bash-stack-author-")));
const snapshot = path.join(root, "source");
fs.mkdirSync(snapshot);
const data = { version, full, candidate, base, provider, letCommit, root, startedAt: new Date().toISOString(), unchangedMembers, unchangedTopLevel, inputs: [], authorInputs: {}, commands: [], layouts: [], newNativeRuns: 0, node: { version: process.version, path: process.execPath, sha256: digest(fs.readFileSync(process.execPath)) }, typescript: ts.version, sourceBlobs: Object.fromEntries(Object.entries(candidateBytes).map(([name, bytes]) => [name, { sha256: digest(bytes), base64: bytes.toString("base64") }])) };
const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(root, "home"), TMPDIR: path.join(root, "tmp"), LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: path.join(root, "cache"), npm_config_userconfig: path.join(root, "npmrc"), npm_config_globalconfig: path.join(root, "globalnpmrc") };
for (const directory of [env.HOME, env.TMPDIR]) fs.mkdirSync(directory);
fs.writeFileSync(env.npm_config_userconfig, ""); fs.writeFileSync(env.npm_config_globalconfig, "");
const run = (name, command, args, cwd = snapshot, more = {}) => {
  const result = spawnSync(command, args, { cwd, env, timeout: 240000, maxBuffer: 32 * 1024 * 1024, ...more });
  const stdout = result.stdout?.toString() ?? "", stderr = result.stderr?.toString() ?? "";
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const record = { name, command, args, cwd, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout, stderr, counts };
  data.commands.push(record); console.log(JSON.stringify({ name, status: record.status, counts }));
  return record;
};
const inventory = directory => {
  const entries = {};
  const visit = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name), key = relative ? `${relative}/${name}` : name, stat = fs.lstatSync(filename);
      if (stat.isDirectory()) { entries[key + "/"] = { directory: true, mode: stat.mode & 0o777 }; visit(filename, key); }
      else { assert.ok(stat.isFile(), key); const bytes = fs.readFileSync(filename); entries[key] = { sha256: digest(bytes), bytes: bytes.length, mode: stat.mode & 0o777 }; }
    }
  };
  visit(directory, ""); return entries;
};
try {
  let cursor = 0;
  for (const input of inputs) {
    const end = batch.stdout.indexOf(10, cursor), header = batch.stdout.subarray(cursor, end).toString().split(" ");
    assert.equal(header[1], "blob", input.name);
    const length = Number(header[2]), original = batch.stdout.subarray(end + 1, end + 1 + length);
    cursor = end + 2 + length;
    const bytes = candidateBytes[input.name] ?? original;
    const target = path.join(snapshot, input.name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    data.inputs.push({ ...input, gitBlob: header[0], originalSha256: digest(original), sha256: digest(bytes), bytes: bytes.length });
  }
  assert.equal(cursor, batch.stdout.length);
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(snapshot, "node_modules"), "dir");
  for (const name of ["stack.test.ts", "loader.mjs", "validate.mjs"]) {
    const bytes = fs.readFileSync(path.join(own, name));
    const target = path.join(snapshot, authorRelative, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    data.authorInputs[name] = { sha256: digest(bytes), base64: bytes.toString("base64") };
  }
  data.sourceBefore = inventory(path.join(snapshot, "src"));
  const focused = `${authorRelative}/stack.test.ts`;
  run("focused stack source", process.execPath, ["--import", "tsx", "--test", focused]);
  fs.writeFileSync(path.join(snapshot, "tsconfig.stack.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/**/*.ts", focused, ...regressionTests, cancellationTest, ...ownedTests, ...cdTests], exclude: [] }));
  run("scoped source/test types", process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.stack.json"]);
  if (full) {
    run("existing shell/state/getopts/cancellation regressions", process.execPath, ["--import", "tsx", "--test", ...regressionTests, cancellationTest]);
    run("existing owned-output regressions", process.execPath, ["--import", "tsx", "--test", ...ownedTests]);
    run("existing CD and frozen native mapping regressions", process.execPath, ["--import", "tsx", "--test", ...cdTests]);
  }
  const build = run("fixed composition build", process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"]);
  if (full && build.status === 0) {
    const letCases = path.join(snapshot, letRoot, "evidence-v1/frozen-cases.json");
    const letIds = JSON.parse(fs.readFileSync(letCases, "utf8")).filter(row => !["P39", "P58"].includes(row.id)).map(row => row.id);
    const letFiles = Object.fromEntries(Object.entries(inventory(path.join(snapshot, "dist"))).filter(([, value]) => !value.directory).map(([name, value]) => [`dist/${name}`, value.sha256]));
    const letBinding = path.join(root, "let-binding.json");
    fs.writeFileSync(letBinding, JSON.stringify({ root: snapshot, layout: "source", files: letFiles }));
    run("56 unchanged LET literal regressions (not original81 rescore)", process.execPath, [path.join(snapshot, letRoot, "checks.mjs")], snapshot,
      { env: { ...env, LET_BINDING: letBinding, LET_CASES: letCases, LET_IDS: letIds.join(",") } });
    data.letSelection = { executed: letIds, notReplayed: ["P39 missing function argv fixture", "P58 unsupported set -u fixture"], originalAuthor103NotRescored: true };
    const pack = run("pack built public package", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root]);
    assert.equal(pack.status, 0);
    const packInfo = JSON.parse(pack.stdout)[0], filename = path.join(root, packInfo.filename), tarball = fs.readFileSync(filename);
    data.package = { sha256: digest(tarball), bytes: tarball.length, files: packInfo.files.length, base64: tarball.toString("base64") };
    const installed = path.join(root, "installed"); fs.mkdirSync(installed);
    fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ private: true, type: "module" }));
    assert.equal(run("offline npm install", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", filename], installed).status, 0);
    const product = path.join(installed, "node_modules/virtual-bash");
    data.packageInventory = inventory(product);
    const source = fs.readFileSync(path.join(own, "stack.test.ts"), "utf8").replaceAll('"../../../../src/index.js"', '"virtual-bash"');
    assert.ok(!source.includes("../../../../src/"));
    fs.writeFileSync(path.join(installed, "stack.test.mjs"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText);
    fs.writeFileSync(path.join(installed, "stack.test.mts"), source);
    fs.copyFileSync(path.join(own, "loader.mjs"), path.join(installed, "loader.mjs"));
    fs.writeFileSync(path.join(installed, "inventory.json"), JSON.stringify(data.packageInventory));
    for (const layout of ["installed", "moved"]) {
      const consumer = layout === "installed" ? installed : path.join(root, "moved consumer with spaces");
      if (layout === "moved") { fs.renameSync(installed, consumer); assert.equal(fs.existsSync(installed), false); }
      const log = path.join(consumer, `${layout}-loads.jsonl`);
      const guarded = { env: { ...env, CONSUMER_ROOT: consumer, PACKAGE_INVENTORY: path.join(consumer, "inventory.json"), LOAD_LOG: log } };
      const result = run(`${layout} public runtime`, process.execPath, ["--loader", path.join(consumer, "loader.mjs"), "--test", path.join(consumer, "stack.test.mjs")], root, guarded);
      const types = run(`${layout} public types`, process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(repository, "node_modules/@types"), "stack.test.mts"], consumer);
      for (const [name, invalid, valid] of [
        ["private stack option", 'new Shell({fs, directoryStack: []});', 'new Shell({fs});'],
        ["private stack limit", 'new Shell({fs, limits: {maxDirectoryStackEntries: 4096}});', 'new Shell({fs, limits: {maxCommands: 4096}});'],
      ]) {
        const filename = path.join(consumer, "negative.mts");
        for (const [role, body] of [["reject", invalid], ["inversion", valid]]) {
          fs.writeFileSync(filename, `import {Shell,MemoryFileSystem} from 'virtual-bash'; const fs = new MemoryFileSystem(); ${body}\n`);
          const result = run(`${layout} ${name} ${role}`, process.execPath, [...types.args.slice(0, -1), "negative.mts"], consumer);
          if (role === "reject") { result.expectedRejection = true; assert.equal(result.status, 2); assert.match(result.stdout, /TS2353/); assert.doesNotMatch(result.stdout, /TS2307/); }
          else assert.equal(result.status, 0);
        }
      }
      const loads = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
      data.layouts.push({ layout, status: result.status, typesStatus: types.status, loads });
      assert.ok(loads.some(load => load.relative === "dist/shell/runtime.js"));
      assert.deepEqual(inventory(path.join(consumer, "node_modules/virtual-bash")), data.packageInventory);
      const runtimeFile = path.join(consumer, "node_modules/virtual-bash/dist/shell/runtime.js");
      const emitted = fs.readFileSync(runtimeFile);
      try {
        fs.appendFileSync(runtimeFile, "\n");
        const control = run(`${layout} tamper rejected`, process.execPath, ["--loader", "./loader.mjs", "--input-type=module", "-e", 'await import("virtual-bash")'], consumer, guarded);
        control.expectedRejection = true;
        assert.notEqual(control.status, 0); assert.match(control.stderr, /Changed product load: dist\/shell\/runtime.js/);
      } finally { fs.writeFileSync(runtimeFile, emitted); }
      assert.deepEqual(inventory(path.join(consumer, "node_modules/virtual-bash")), data.packageInventory);
      if (layout === "moved") {
        for (const [name, needle, replacement, pattern] of [
          ["builtin membership", ', "pushd", "dirs", "popd"', '', "builtin discovery"],
          ["publication stamp", 'state.directoryStackCwdPublication === directoryStackCwdPublication', 'true', "stack publication survives"],
          ["early ordinary tail", 'const status = await cd(target);', 'state.directoryStack = next; const status = await cd(target);', "failure publication|readonly checked|output failure"],
        ]) {
          const text = emitted.toString();
          assert.equal(text.split(needle).length, 2, name);
          const modified = Buffer.from(text.replace(needle, replacement));
          try {
            fs.writeFileSync(runtimeFile, modified);
            const altered = inventory(path.join(consumer, "node_modules/virtual-bash"));
            fs.writeFileSync(path.join(consumer, "inventory.json"), JSON.stringify(altered));
            const control = run(`loaded mutation ${name}`, process.execPath, ["--loader", "./loader.mjs", "--test", `--test-name-pattern=${pattern}`, "stack.test.mjs"], consumer, guarded);
            control.expectedRejection = true;
            control.mutatedRuntimeSha256 = digest(modified);
            assert.equal(control.status, 1); assert.ok(control.counts.fail > 0); assert.match(control.stdout, /ERR_ASSERTION/);
            assert.doesNotMatch(control.stderr, /Changed product load|SyntaxError/);
          } finally {
            fs.writeFileSync(runtimeFile, emitted);
            fs.writeFileSync(path.join(consumer, "inventory.json"), JSON.stringify(data.packageInventory));
          }
        }
        assert.deepEqual(inventory(path.join(consumer, "node_modules/virtual-bash")), data.packageInventory);
      }
    }
  }
  assert.deepEqual(inventory(path.join(snapshot, "src")), data.sourceBefore);
  data.sourceStable = true;
} catch (error) {
  data.failure = { message: error?.message, stack: error?.stack }; process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: false });
  data.temporaryRemoved = !fs.existsSync(root); data.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(data))).toString("base64") + "\n", { flag: "wx" });
}
if (data.commands.some(record => record.status !== 0 && !record.expectedRejection)) process.exitCode = 1;
console.log(JSON.stringify({ output, failure: data.failure ?? null, temporaryRemoved: data.temporaryRemoved }));
