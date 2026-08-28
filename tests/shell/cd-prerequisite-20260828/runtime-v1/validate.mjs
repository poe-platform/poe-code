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
const base = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const provider = "ca1d33424b94a21ae0f40a36412fd8191611e2df";
const mode = process.argv[2];
assert.ok(mode === "baseline" || mode === "candidate");
const version = process.argv[3];
assert.match(version, /^\d{2}$/);
const candidate = process.argv[4] ?? "WORKTREE";
const output = path.join(own, `${mode}-${version}.json.gz.base64`);
assert.equal(fs.existsSync(output), false);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const originalRuntime = git("show", `${base}:src/shell/runtime.ts`);
assert.deepEqual(originalRuntime, git("show", "fd1daa123298568546d9ea4e95f8c81dde9c52ff:src/shell/runtime.ts"));
const runtime = mode === "baseline" ? originalRuntime : candidate === "WORKTREE" ? fs.readFileSync(path.join(repository, "src/shell/runtime.ts")) : git("show", `${candidate}:src/shell/runtime.ts`);
const sourceTree = bytes => ts.createSourceFile("runtime.ts", bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const beforeTree = sourceTree(originalRuntime), afterTree = sourceTree(runtime);
const runtimeClass = tree => tree.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === "Runtime");
const beforeRuntime = runtimeClass(beforeTree), afterRuntime = runtimeClass(afterTree);
const unchangedMembers = [];
for (const member of beforeRuntime.members) {
  const name = member.name?.getText(beforeTree) ?? "constructor";
  const current = afterRuntime.members.find(candidate => (candidate.name?.getText(afterTree) ?? "constructor") === name);
  assert.ok(current, name);
  if (name !== "builtin") { assert.equal(current.getText(afterTree), member.getText(beforeTree), name); unchangedMembers.push(name); }
  else {
    const withoutCd = (body, tree) => body.statements.filter(statement => !(ts.isIfStatement(statement) && statement.expression.getText(tree) === 'command === "cd"')).map(statement => statement.getText(tree));
    assert.deepEqual(withoutCd(current.body, afterTree), withoutCd(member.body, beforeTree));
  }
}
assert.equal(beforeRuntime.members.length, afterRuntime.members.length);
const shellTests = [
  "core", "variable-scope", "runtime-regressions", "fs-error-diagnostics", "env-replacement", "env-replacement-bounds", "invoke",
  "invocation-cleanup", "invocation-cleanup-pipeline", "output-accounting", "output-accounting-bounds", "streaming",
].map(name => `tests/shell/${name}.test.ts`);
shellTests.push(...["state", "host", "ordering"].map(name => `tests/shell/getopts/runtime/${name}.test.ts`));
const extraTest = "tests/shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts";
const ownedOutputTests = ["operation", "shell", "network"].map(name => `tests/integration/owned-output-production-rebase/author/${name}.test.ts`);
const selected = git("ls-tree", "-r", "--name-only", base, "src", "package.json", "README.md", "tsconfig.json", "tsconfig.build.json",
  ...shellTests, "tests/shell/helpers.ts", "tests/shell/getopts/runtime/helpers.ts", "tests/shell/bash-bugfix-helpers.ts",
  "tests/shell/env-replacement-bounds.ts", "tests/shell/output-accounting-bounds.ts",
  ...ownedOutputTests, "tests/integration/owned-output-production-rebase/author/helpers.ts",
  "tests/shell/getopts-independent-20260827/stage2/corpus.mjs", "tests/shell/getopts-independent-20260827/stage2/fixtures").toString().trim().split("\n");
assert.ok(selected.length > 200);
assert.ok(selected.every(name => !name.endsWith("AGENTS.md")));
const inputs = selected.map(name => ({ name, commit: name === "src/fs/webdav/webdav.ts" || name === "src/fs/webdav/README.md" ? provider : base }));
inputs.push({ name: extraTest, commit: "43af14a520160fad4e144a6b60c30ca123bd9ab9" });
const refs = inputs.map(input => `${input.commit}:${input.name}`).join("\n") + "\n";
const packed = spawnSync("git", ["cat-file", "--batch"], { cwd: repository, input: refs, maxBuffer: 64 * 1024 * 1024 });
assert.equal(packed.status, 0);
let cursor = 0;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safe-bash-cd-author-")));
const snapshot = path.join(root, "source");
fs.mkdirSync(snapshot);
const data = { mode, version, base, provider, candidate, originalRuntimeSha256: digest(originalRuntime), runtimeSha256: digest(runtime),
  freeze: "beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e", ratification: "2fbd1e051993cadf384cf4fc559f20e3f0b7cc1c",
  policy: "ef833fd2cbf006993b1f94d7f3a0d3254e0ad3de", startedAt: new Date().toISOString(), root,
  unchangedRuntimeMembers: unchangedMembers, builtinOutsideCdUnchanged: true,
  node: { version: process.version, path: process.execPath, sha256: digest(fs.readFileSync(process.execPath)) },
  typescript: { version: ts.version, sha256: digest(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/typescript.js"))) },
  inputs: [], commands: [], layouts: [], authorInputs: {}, newGnu53NativeRuns: 0,
  legacyRegressionOracle: { path: "/bin/bash", sha256: digest(fs.readFileSync("/bin/bash")),
    qualification: "existing variable-scope regression invokes this host binary; not a GNU5.3 native28 rerun" } };
const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(root, "home"), TMPDIR: path.join(root, "tmp"),
  LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: path.join(root, "cache"), npm_config_userconfig: path.join(root, "npmrc"), npm_config_globalconfig: path.join(root, "globalnpmrc") };
for (const directory of [env.HOME, env.TMPDIR]) fs.mkdirSync(directory);
fs.writeFileSync(env.npm_config_userconfig, ""); fs.writeFileSync(env.npm_config_globalconfig, "");
const run = (name, command, args, cwd = snapshot, more = {}) => {
  const result = spawnSync(command, args, { cwd, env, timeout: 180000, maxBuffer: 24 * 1024 * 1024, ...more });
  const stdout = result.stdout?.toString() ?? "", stderr = result.stderr?.toString() ?? "";
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const record = { name, command, args, cwd, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout, stderr, counts };
  data.commands.push(record);
  console.log(JSON.stringify({ name, status: record.status, counts }));
  return record;
};
const inventory = directory => {
  const entries = {};
  const visit = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name), key = relative ? `${relative}/${name}` : name, stat = fs.lstatSync(filename);
      if (stat.isDirectory()) visit(filename, key);
      else { assert.ok(stat.isFile(), key); const bytes = fs.readFileSync(filename); entries[key] = { sha256: digest(bytes), bytes: bytes.length }; }
    }
  };
  visit(directory, ""); return entries;
};
try {
  for (const input of inputs) {
    const end = packed.stdout.indexOf(10, cursor);
    const header = packed.stdout.subarray(cursor, end).toString().split(" ");
    assert.equal(header[1], "blob", input.name);
    const length = Number(header[2]);
    const original = packed.stdout.subarray(end + 1, end + 1 + length);
    cursor = end + 2 + length;
    const bytes = input.name === "src/shell/runtime.ts" ? runtime : original;
    const target = path.join(snapshot, input.name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    data.inputs.push({ ...input, gitBlob: header[0], originalSha256: digest(original), sha256: digest(bytes), bytes: bytes.length });
  }
  assert.equal(cursor, packed.stdout.length);
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(snapshot, "node_modules"), "dir");
  const ownRelative = path.relative(repository, own);
  const authorFiles = ["cd.test.ts", "native-mapping.test.ts", "loader.mjs", "validate.mjs"];
  for (const name of authorFiles) {
    const bytes = fs.readFileSync(path.join(own, name));
    const target = path.join(snapshot, ownRelative, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    data.authorInputs[name] = { sha256: digest(bytes), base64: bytes.toString("base64") };
  }
  const native = fs.readFileSync(path.join(own, "../observations-01.json.gz.base64"));
  assert.equal(digest(Buffer.from(native.toString(), "base64")), "b9f81d6f6507a5d110d0a196cabebe5d4ea1e803994d817485ed0c71520df592");
  fs.writeFileSync(path.join(snapshot, ownRelative, "../observations-01.json.gz.base64"), native);
  data.nativeEvidenceFileSha256 = digest(native);
  data.sourceBefore = inventory(path.join(snapshot, "src"));
  const focused = ["cd.test.ts", "native-mapping.test.ts"].map(name => `${ownRelative}/${name}`);
  run("focused source and preserved native mapping", process.execPath, ["--import", "tsx", "--test", ...focused]);
  const config = { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/**/*.ts", ...focused, ...shellTests, extraTest, ...ownedOutputTests], exclude: [] };
  fs.writeFileSync(path.join(snapshot, "tsconfig.cd.json"), JSON.stringify(config));
  run("scoped source/test types", process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.cd.json"]);
  if (mode === "candidate") run("selected existing shell regressions", process.execPath, ["--import", "tsx", "--test", ...shellTests, extraTest]);
  if (mode === "candidate") run("accepted owned-output regressions", process.execPath, ["--import", "tsx", "--test", ...ownedOutputTests]);
  const build = run("fixed composition build", process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"]);
  if (build.status === 0 && mode === "candidate") {
    const pack = run("pack built public package", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root]);
    assert.equal(pack.status, 0);
    const filename = JSON.parse(pack.stdout)[0].filename;
    const tarball = fs.readFileSync(path.join(root, filename));
    data.package = { sha256: digest(tarball), bytes: tarball.length, base64: tarball.toString("base64") };
    const installed = path.join(root, "installed");
    const product = path.join(installed, "node_modules/virtual-bash");
    fs.mkdirSync(product, { recursive: true });
    assert.equal(run("unpack public package", "/usr/bin/tar", ["-xzf", path.join(root, filename), "--strip-components=1", "-C", product], root).status, 0);
    data.packageInventory = inventory(product);
    for (const filename of ["cd.test.ts", "native-mapping.test.ts"]) {
      const source = fs.readFileSync(path.join(own, filename), "utf8").replaceAll('"../../../../src/index.js"', '"virtual-bash"');
      assert.ok(!source.includes("../../../../src/"));
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
      const target = path.join(installed, "harness", "runtime-v1", filename.replace(/\.ts$/, ".mjs"));
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, compiled);
      fs.writeFileSync(target.replace(/\.mjs$/, ".mts"), source);
    }
    fs.writeFileSync(path.join(installed, "harness/observations-01.json.gz.base64"), native);
    fs.copyFileSync(path.join(own, "loader.mjs"), path.join(installed, "loader.mjs"));
    fs.writeFileSync(path.join(installed, "inventory.json"), JSON.stringify(data.packageInventory));
    for (const layout of ["installed", "moved"]) {
      const consumer = layout === "installed" ? installed : path.join(root, "moved consumer with spaces");
      if (layout === "moved") fs.renameSync(installed, consumer);
      const log = path.join(consumer, `${layout}-loads.jsonl`);
      const result = run(`${layout} public runtime`, process.execPath, ["--loader", "./loader.mjs", "--test", "harness/runtime-v1/cd.test.mjs", "harness/runtime-v1/native-mapping.test.mjs"], consumer,
        { env: { ...env, CONSUMER_ROOT: consumer, PACKAGE_INVENTORY: path.join(consumer, "inventory.json"), LOAD_LOG: log } });
      const types = run(`${layout} public types`, process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(repository, "node_modules/@types"), "harness/runtime-v1/cd.test.mts", "harness/runtime-v1/native-mapping.test.mts"], consumer);
      const loads = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
      data.layouts.push({ layout, status: result.status, typesStatus: types.status, loads });
      assert.deepEqual(inventory(path.join(consumer, "node_modules/virtual-bash")), data.packageInventory);
      const runtimeFile = path.join(consumer, "node_modules/virtual-bash/dist/shell/runtime.js");
      const emittedRuntime = fs.readFileSync(runtimeFile);
      try {
        fs.appendFileSync(runtimeFile, "\n");
        const control = run(`${layout} tampered emitted runtime rejected`, process.execPath, ["--loader", "./loader.mjs", "--input-type=module", "-e", 'await import("virtual-bash")'], consumer,
          { env: { ...env, CONSUMER_ROOT: consumer, PACKAGE_INVENTORY: path.join(consumer, "inventory.json"), LOAD_LOG: log } });
        control.expectedRejection = true;
        assert.notEqual(control.status, 0);
        assert.match(control.stderr, /Changed product load: dist\/shell\/runtime.js/);
      } finally { fs.writeFileSync(runtimeFile, emittedRuntime); }
      assert.deepEqual(inventory(path.join(consumer, "node_modules/virtual-bash")), data.packageInventory);
    }
  }
  assert.deepEqual(inventory(path.join(snapshot, "src")), data.sourceBefore);
  data.sourceStable = true;
} catch (error) {
  data.failure = { message: error?.message, stack: error?.stack }; process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: false });
  data.temporaryRemoved = !fs.existsSync(root);
  data.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(data))).toString("base64") + "\n", { flag: "wx" });
}
if (mode === "candidate" && data.commands.some(record => record.status !== 0 && !record.expectedRejection)) process.exitCode = 1;
console.log(JSON.stringify({ output, failure: data.failure ?? null, temporaryRemoved: data.temporaryRemoved }));
