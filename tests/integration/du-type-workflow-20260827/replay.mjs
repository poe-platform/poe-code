import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classificationControls } from "./controls.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const candidate = execFileSync("git", ["rev-parse", "--verify", `${process.argv[2]}^{commit}`], { cwd: repository, encoding: "utf8" }).trim();
const node24 = process.argv[3];
assert.ok(node24 && existsSync(node24), "supply the already-installed Node24 binary for the additional packed runtime/permission profile");
const directory = realpathSync(mkdtempSync(join(tmpdir(), "du-type-workflow-")));
const root = join(directory, "candidate"); mkdirSync(root);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { schema: 1, candidate, tree: execFileSync("git", ["rev-parse", `${candidate}^{tree}`], { cwd: repository, encoding: "utf8" }).trim(), startedAt: new Date().toISOString(), directory, runtimes: [], commands: [], controls: [], failures: [], scope: "author typing/classification and one packed internal DU leaf workflow; not public DU integration or whole-product acceptance" };
report.harnessInputs = ["replay.mjs", "controls.mjs"].map(name => ({ name, sha256: digest(readFileSync(new URL(name, import.meta.url))) }));
console.log(JSON.stringify({ directory, candidate }));
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const execute = (name, executable, args, cwd = root, expected = 0, extra = {}) => {
  const env = { ...process.env, PATH: dirname(executable) + ":" + process.env.PATH, TSX_DISABLE_CACHE: "1" }; delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024, ...extra });
  const record = { name, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  json(join(directory, `${name}.json`), record);
  report.commands.push({ name, status: result.status, signal: result.signal, expected, log: `${name}.json` });
  if (expected !== null && (result.status !== expected || result.signal || result.error)) report.failures.push({ name, expected, actual: result.status, error: result.error?.message });
  return result;
};
const check = (name, operation) => {
  try { operation(); report.controls.push({ name, status: "pass" }); }
  catch (error) { report.controls.push({ name, status: "fail", error: error.stack }); report.failures.push({ name, error: error.message }); }
};
const fileManifest = directory => {
  const records = [];
  const walk = prefix => {
    for (const name of readdirSync(join(directory, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name, info = lstatSync(join(directory, path));
      assert.equal(info.isSymbolicLink(), false, `unexpected package symlink: ${path}`);
      if (info.isDirectory()) walk(path); else { const bytes = readFileSync(join(directory, path)); records.push({ path, bytes: bytes.length, sha256: digest(bytes) }); }
    }
  };
  walk(""); return records;
};

try {
  for (const executable of [process.execPath, node24]) {
    const identity = execute(`runtime-${report.runtimes.length}`, executable, ["--input-type=module", "-e", "console.log(JSON.stringify({version:process.version,execPath:process.execPath,arch:process.arch,platform:process.platform}))"], directory);
    report.runtimes.push({ ...JSON.parse(identity.stdout), sha256: digest(readFileSync(realpathSync(executable))) });
  }
  const archive = join(directory, "candidate.tar");
  execFileSync("git", ["archive", `--output=${archive}`, candidate], { cwd: repository });
  const archiveHash = createHash("sha256");
  for await (const bytes of createReadStream(archive)) archiveHash.update(bytes);
  report.archiveSha256 = archiveHash.digest("hex");
  execFileSync("tar", ["-xf", archive, "-C", root]);
  rmSync(archive);
  const tree = execFileSync("git", ["ls-tree", "-rz", "--full-tree", candidate], { cwd: repository, maxBuffer: 32 * 1024 * 1024 }).toString().split("\0").filter(Boolean).map(line => {
    const [metadata, path] = line.split("\t"); const [mode, type, blob] = metadata.split(" "); return { mode, type, blob, path };
  });
  const sourceInputs = tree.filter(entry => ["src/", "scripts/"].some(prefix => entry.path.startsWith(prefix)) || entry.path.startsWith("tests/plugins/qualified-current-release") || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(entry.path));
  const sourceWitness = () => sourceInputs.map(entry => ({ ...entry, sha256: digest(readFileSync(join(root, entry.path))) }));
  report.sourceBefore = sourceWitness();
  for (const entry of sourceInputs) {
    const bytes = readFileSync(join(root, entry.path));
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.blob, `archive differs from Git blob: ${entry.path}`);
  }
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["add", "--all"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  cpSync(join(repository, "node_modules"), join(root, "node_modules"), { recursive: true, dereference: true });
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  report.compiler = { version: JSON.parse(readFileSync(join(root, "node_modules/typescript/package.json"))).version, sha256: digest(readFileSync(compiler)), implementationSha256: digest(readFileSync(join(root, "node_modules/typescript/lib/_tsc.js"))) };
  const staged = JSON.parse(readFileSync(join(root, "tests/plugins/qualified-current-release/staged-types.json")));
  report.originalInputsBefore = staged.entries.map(entry => ({ path: entry.path, role: entry.role, sha256: digest(readFileSync(join(root, entry.path))) }));
  const controlRoot = join(directory, "classification-controls"); mkdirSync(controlRoot);
  report.controls.push(...await classificationControls(root, controlRoot));
  report.failures.push(...report.controls.filter(row => row.status === "fail"));
  const typeReport = join(directory, "typecheck-all");
  execute("typecheck-all", process.execPath, ["scripts/typecheck.mjs", "--build", "--report", typeReport]);
  const reportNames = readdirSync(typeReport); assert.equal(reportNames.length, 1);
  report.typecheck = JSON.parse(readFileSync(join(typeReport, reportNames[0])));
  const previousConfig = JSON.parse(execFileSync("git", ["show", "5f6960a2^:tsconfig.json"], { cwd: repository, encoding: "utf8" }));
  const baselineConfig = join(directory, "old-classification.json");
  json(baselineConfig, { extends: join(root, "tsconfig.json"), compilerOptions: { typeRoots: [join(root, "node_modules/@types")] }, exclude: previousConfig.exclude.map(path => resolve(root, path)) });
  const baseline = execute("original-classification-diagnostics", process.execPath, [compiler, "--noEmit", "--pretty", "false", "-p", baselineConfig], root, 2);
  report.baselineDiagnostics = baseline.stdout.split("\n").filter(line => /error TS/u.test(line));
  check("baseline has exactly fourteen staging TS2307 errors", () => {
    assert.equal(report.baselineDiagnostics.length, 14);
    for (const entry of staged.entries) assert.ok(report.baselineDiagnostics.some(line => line.startsWith(entry.path + "(") && /error TS2307:/u.test(line)), entry.path);
  });
  execute("canonical-config-fixture", process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", "tests/plugins/qualified-current-release-native-data/controls.test.ts"]);
  const buildBindingModule = await import(pathToFileURL(join(root, "scripts/typecheck-consumers.mjs")));
  const binding = buildBindingModule.createBuiltPackageBinding(root);
  const packRoot = join(directory, "pack"); mkdirSync(packRoot);
  const packed = execute("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packRoot]);
  assert.equal(packed.status, 0);
  const tarball = join(packRoot, JSON.parse(packed.stdout)[0].filename);
  report.package = { metadataSha256: digest(readFileSync(join(root, "package.json"))), tarballSha256: digest(readFileSync(tarball)) };
  const moved = join(directory, "moved package with spaces"); mkdirSync(moved);
  const extracted = join(directory, "extracted"); mkdirSync(extracted);
  execFileSync("tar", ["-xf", tarball, "-C", extracted]);
  const installed = join(moved, "node_modules/virtual-bash"); mkdirSync(dirname(installed), { recursive: true }); renameSync(join(extracted, "package"), installed);
  assert.equal(existsSync(join(installed, "src")), false);
  report.package.before = fileManifest(installed);
  json(join(moved, "package.json"), { private: true, type: "module" });
  const input = "tests/plugins/qualified-current-release/du-leaf.mts";
  cpSync(join(root, input), join(moved, "du-leaf.mts"));
  assert.deepEqual(readFileSync(join(moved, "du-leaf.mts")), readFileSync(join(root, input)));
  const consumerConfig = JSON.parse(readFileSync(join(root, "tests/plugins/qualified-current-release/tsconfig.consumer.json")));
  Object.assign(consumerConfig.compilerOptions, { typeRoots: [join(root, "node_modules/@types")], rootDir: moved, outDir: moved }); consumerConfig.files = [join(moved, "du-leaf.mts")];
  json(join(moved, "tsconfig.json"), consumerConfig);
  const compiled = execute("packed-du-types", process.execPath, [compiler, "-p", join(moved, "tsconfig.json"), "--traceResolution"]);
  check("all packed declaration resolutions authenticated", () => buildBindingModule.assertBuiltConsumerResolution(compiled.stdout, moved, root, binding));
  const permissionModule = await import(pathToFileURL(join(root, "scripts/verify-current-consumers.mjs")));
  const permission = permissionModule.probeConsumerPermission({ root, directory }, node24);
  const flags = permissionModule.consumerPermissionArgs(permission, moved);
  report.permission = permission;
  execute("packed-du-runtime", node24, [...flags, join(moved, "du-leaf.mjs")], moved);
  const node22PermissionDirectory = join(directory, "node22-permission"); mkdirSync(node22PermissionDirectory);
  const node22Permission = permissionModule.probeConsumerPermission({ root, directory: node22PermissionDirectory }, process.execPath);
  report.node22Permission = node22Permission;
  execute("packed-du-runtime-node22", process.execPath, [...permissionModule.consumerPermissionArgs(node22Permission, moved), join(moved, "du-leaf.mjs")], moved);
  const sourceDenied = execute("packed-source-denial", node24, [...flags, "--input-type=module", "-e", `import {readFileSync} from 'node:fs';readFileSync(${JSON.stringify(join(root, "src/commands/du/index.ts"))});`], moved, 1);
  check("source denial is permission error, not bootstrap failure", () => assert.match(sourceDenied.stderr, /ERR_ACCESS_DENIED/u));
  const typeBefore = readFileSync(join(moved, "du-leaf.mts"));
  writeFileSync(join(moved, "du-leaf.mts"), typeBefore.toString().replace("maxEntries: 64", 'maxEntries: "wrong"'));
  const negative = execute("negative-du-options", process.execPath, [compiler, "-p", join(moved, "tsconfig.json"), "--noEmit"], root, 2);
  check("DU option error remains TS2322", () => assert.match(negative.stdout, /TS2322/u));
  writeFileSync(join(moved, "du-leaf.mts"), typeBefore);
  const leafDeclarations = join(installed, "dist/commands/du/index.d.ts"), leafBefore = readFileSync(leafDeclarations);
  writeFileSync(leafDeclarations, Buffer.concat([leafBefore, Buffer.from("\nexport declare const foreignOnly: 1;\n")]));
  writeFileSync(join(moved, "du-leaf.mts"), Buffer.concat([typeBefore, Buffer.from('\nimport { foreignOnly } from "./node_modules/virtual-bash/dist/commands/du/index.js"; const extra: 1 = foreignOnly; void extra;\n')]));
  const mixed = execute("alternate-leaf-compiles-without-binding", process.execPath, [compiler, "-p", join(moved, "tsconfig.json"), "--noEmit", "--traceResolution"]);
  check("alternate leaf rejected despite compiler success", () => assert.throws(() => buildBindingModule.assertBuiltConsumerResolution(mixed.stdout, moved, root, binding), /candidate declaration bytes or file set changed/u));
  writeFileSync(leafDeclarations, leafBefore); writeFileSync(join(moved, "du-leaf.mts"), typeBefore);
  const leafRuntime = join(installed, "dist/commands/du/index.js");
  renameSync(leafDeclarations, leafDeclarations + ".saved"); renameSync(leafRuntime, leafRuntime + ".saved");
  try {
    const missingTypes = execute("missing-installed-leaf-types", process.execPath, [compiler, "-p", join(moved, "tsconfig.json"), "--noEmit"], root, 2);
    check("missing installed DU declarations have no source fallback", () => assert.match(missingTypes.stdout, /TS2307.*node_modules\/virtual-bash\/dist\/commands\/du\/index.js/u));
    const missingRuntime = execute("missing-installed-leaf-runtime", node24, [...flags, join(moved, "du-leaf.mjs")], moved, 1);
    check("missing installed DU runtime has no source fallback", () => assert.match(missingRuntime.stderr, /ERR_MODULE_NOT_FOUND/u));
  } finally { renameSync(leafDeclarations + ".saved", leafDeclarations); renameSync(leafRuntime + ".saved", leafRuntime); }
  const uniqueTemplates = [...new Map(staged.entries.map(entry => [entry.sha256, entry])).values()];
  report.templateReplays = [];
  for (const [index, entry] of uniqueTemplates.entries()) {
    const fixture = join(directory, `consumer-${index}.ts.fixture`), target = join(moved, "consumer.ts");
    cpSync(join(root, entry.path), fixture); cpSync(fixture, target); assert.deepEqual(readFileSync(target), readFileSync(join(root, entry.path)));
    const config = { ...consumerConfig, files: [target], compilerOptions: { ...consumerConfig.compilerOptions, noEmit: true } }; json(join(moved, "template.json"), config);
    const result = execute(`staged-original-template-${index}`, process.execPath, [compiler, "-p", join(moved, "template.json"), "--traceResolution"]);
    check(`original template ${index} resolves same candidate`, () => buildBindingModule.assertBuiltConsumerResolution(result.stdout, moved, root, binding));
    report.templateReplays.push({ sha256: entry.sha256, representative: entry.path, identicalInputs: staged.entries.filter(other => other.sha256 === entry.sha256).map(other => other.path), status: result.status });
  }
  const compilerControl = join(directory, "compiler-control"); mkdirSync(compilerControl);
  json(join(compilerControl, "package.json"), { private: true, type: "module" });
  const controlConfig = JSON.parse(readFileSync(join(root, "tsconfig.json"))); controlConfig.compilerOptions.types = []; json(join(compilerControl, "tsconfig.json"), controlConfig);
  for (const path of ["src/current.ts", "tests/integration/du-overlay-independent-20260827/new-neighbor.ts"]) { mkdirSync(dirname(join(compilerControl, path)), { recursive: true }); writeFileSync(join(compilerControl, path), "export const stillChecked: number = 'wrong';\n"); }
  const sourceErrors = execute("source-and-template-neighbor-errors", process.execPath, [compiler, "--noEmit", "--pretty", "false", "-p", join(compilerControl, "tsconfig.json")], root, 2);
  check("real source and unknown neighboring template errors still caught", () => { const lines = sourceErrors.stdout.split("\n").filter(line => /error TS/u.test(line)); assert.equal(lines.length, 2); assert.ok(lines.every(line => /TS2322/u.test(line))); });
  report.package.after = fileManifest(installed);
  check("installed package immutable after positive and negative controls", () => assert.deepEqual(report.package.after, report.package.before));
  report.sourceAfter = sourceWitness(); check("frozen source/config inputs unchanged", () => assert.deepEqual(report.sourceAfter, report.sourceBefore));
  report.originalInputsAfter = staged.entries.map(entry => ({ path: entry.path, role: entry.role, sha256: digest(readFileSync(join(root, entry.path))) }));
  check("all fourteen original artifacts byte-identical", () => assert.deepEqual(report.originalInputsAfter, report.originalInputsBefore));
  const { verifyTypecheckInputs } = await import(pathToFileURL(join(root, "scripts/typecheck-inputs.mjs")));
  check("all owner manifests and current routes still authenticate after execution", () => assert.equal(verifyTypecheckInputs(root).stagedInputs.length, 14));
  report.completed = true;
} catch (error) { report.failures.push({ name: "replay setup or continuation", error: error.stack }); }
finally {
  report.finishedAt = new Date().toISOString();
  report.status = report.completed && report.failures.length === 0 ? "author-scoped-pass" : "author-scoped-fail";
  json(join(directory, "REPORT.json"), report);
  console.log(JSON.stringify({ report: join(directory, "REPORT.json"), status: report.status, controls: report.controls.length, failures: report.failures }));
  process.exitCode = report.failures.length ? 1 : 0;
}
