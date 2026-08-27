import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertBinding, baseline, inventory, moduleCommit, rendererHash, runtimeCases, sha256, validateDeclaration } from "./contract.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../..");
assert.deepEqual(process.argv.slice(2, 3), ["--candidate"], "opt-in only: --candidate EXACT_DECLARATION.json");
assert.equal(process.argv.length, 4);
const declaration = validateDeclaration(JSON.parse(readFileSync(resolve(process.argv[3]))));
mkdirSync(join(owned, "scratch"), { recursive: true });
const scratch = realpathSync(mkdtempSync(join(owned, "scratch", "candidate-")));
const source = join(scratch, "archive"), installed = join(scratch, "installed");
const json = (filename, value) => writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: join(scratch, "npm-cache"), npm_config_userconfig: join(scratch, "empty.npmrc"), npm_config_globalconfig: join(scratch, "empty-global.npmrc") };
const steps = [];
let sequence = 0;
console.log(`Retained evidence: ${scratch}`);

function command(name, executable, args, cwd = scratch, extra = {}) {
  const prefix = `${String(++sequence).padStart(3, "0")}-${name}`;
  json(join(scratch, `${prefix}.PRE.json`), { executable: realpathSync(executable), executableSha256: sha256(readFileSync(realpathSync(executable))), args, cwd, env, consumerTree: cwd === installed || cwd.includes("consumer") || cwd.includes("control-") ? inventory(cwd) : undefined, started: new Date().toISOString() });
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024, ...extra });
  const record = { name, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr, ended: new Date().toISOString() };
  steps.push(record);
  json(join(scratch, `${prefix}.RAW.json`), record);
  return record;
}
function success(record) {
  assert.equal(record.error, undefined, record.name);
  assert.equal(record.signal, null, record.name);
  assert.equal(record.status, 0, `${record.name}: see retained raw output`);
  return record;
}
function failure(record, pattern, status) {
  assert.equal(record.error, undefined, "supervisor failure is NOT a qualified negative control");
  assert.equal(record.signal, null, "forced termination is NOT a pass");
  assert.equal(record.status, status);
  assert.match(`${record.stdout}\n${record.stderr}`, pattern);
  return record;
}
function git(args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

try {
  assert.equal(git(["rev-parse", `${declaration.candidateCommit}^{commit}`]).trim(), declaration.candidateCommit);
  const fixturePrefix = "tests/integration/html-public-independent-20260827/";
  const fixturePaths = git(["ls-tree", "-r", "--name-only", declaration.fixtureCommit, "--", fixturePrefix]).trim().split("\n");
  const fixtureFiles = {};
  for (const filename of fixturePaths) {
    assert.ok(filename.startsWith(fixturePrefix));
    const bytes = spawnSync("git", ["show", `${declaration.fixtureCommit}:${filename}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(bytes.status, 0);
    fixtureFiles[filename.slice(fixturePrefix.length)] = sha256(bytes.stdout);
  }
  const liveFixtures = inventory(owned, "", ["scratch"]);
  assertBinding(liveFixtures, fixtureFiles, "FIXTURE_FREEZE");
  const changed = git(["diff", "--name-only", baseline, declaration.candidateCommit, "--", "src", "package.json"]).trim().split("\n").filter(Boolean).sort();
  assertBinding(changed, declaration.changedProductPaths, "SOURCE_SCOPE");
  assertBinding(changed.filter(name => name.startsWith("src/commands/html-to-markdown/") && name !== "src/commands/html-to-markdown/README.md"), declaration.htmlIoPaths, "HTML_IO_SCOPE");
  const tools = declaration.toolPaths;
  for (const name of ["node", "npm", "tsc"]) assertBinding(sha256(readFileSync(realpathSync(tools[name]))), declaration.toolExecutables[name], `TOOL_${name}`);
  assert.equal(realpathSync(tools.node), realpathSync(process.execPath));
  for (const name of ["typescript", "nodeTypes", "undiciTypes", "npmRoot"]) assertBinding(sha256(JSON.stringify(inventory(tools[name]))), declaration.toolTrees[name], `TOOL_TREE_${name}`);
  const initial = { date: new Date().toISOString(), declaration, fixtureFiles, tools: declaration.toolExecutables, toolTrees: declaration.toolTrees, supervisor: sha256(readFileSync(import.meta.filename)), loader: fixtureFiles["loader.mjs"], consumer: fixtureFiles["driver.mjs"], node: process.version, kind: "PRE-RUN-NOT-ACCEPTANCE" };
  json(join(scratch, "PRE-RUN.json"), initial);
  const archive = spawnSync("git", ["archive", "--format=tar", declaration.candidateCommit], { cwd: repository, maxBuffer: 1024 * 1024 * 1024 });
  assert.equal(archive.status, 0);
  assertBinding(sha256(archive.stdout), declaration.archiveSha256, "SOURCE_ARCHIVE");
  writeFileSync(join(scratch, "candidate.tar"), archive.stdout, { flag: "wx" });
  mkdirSync(source);
  success(command("extract-exact-archive", "/usr/bin/tar", ["-xf", join(scratch, "candidate.tar"), "-C", source], scratch, { timeout: 180_000 }));
  const sourceTree = inventory(source);
  assertBinding(sourceTree, declaration.packageFiles, "FULL_SOURCE_INPUTS");
  assertBinding(sourceTree["src/commands/html-to-markdown/render.ts"], rendererHash, "RENDERER_UNCHANGED");
  for (const filename of ["render.ts", "options.ts", "parser.ts", "entities.ts", "text.ts"]) {
    const relative = `src/commands/html-to-markdown/${filename}`;
    const accepted = spawnSync("git", ["show", `${moduleCommit}:${relative}`], { cwd: repository });
    assert.equal(accepted.status, 0);
    assertBinding(sourceTree[relative], sha256(accepted.stdout), `ACCEPTED_HTML_${filename}`);
  }
  const manifest = JSON.parse(readFileSync(join(source, "package.json")));
  assert.equal(manifest.name, "virtual-bash");
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.optionalDependencies ?? {}, {});
  assert.deepEqual(manifest.exports, declaration.packageExports);
  assertBinding(sha256(archive.stdout), declaration.archiveSha256, "SOURCE_ARCHIVE");
  mkdirSync(join(source, "node_modules", "@types"), { recursive: true });
  for (const [name, destination] of [["typescript", "typescript"], ["nodeTypes", "@types/node"], ["undiciTypes", "undici-types"]]) cpSync(tools[name], join(source, "node_modules", destination), { recursive: true });
  success(command("full-build", tools.node, [join(source, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], source, { timeout: 180_000 }));
  const afterBuild = inventory(source);
  for (const [filename, digest] of Object.entries(sourceTree)) assertBinding(afterBuild[filename], digest, `BUILD_INPUT_${filename}`);
  assert.ok(Object.keys(afterBuild).every(filename => Object.hasOwn(sourceTree, filename) || filename.startsWith("dist/") || filename.startsWith("node_modules/")), "unexpected appended build entries");
  const pack = success(command("full-npm-pack", tools.node, [tools.npm, "pack", "--json", "--ignore-scripts", "--offline", "--pack-destination", scratch], source, { timeout: 180_000 }));
  const packRecord = JSON.parse(pack.stdout)[0];
  const packPath = join(scratch, packRecord.filename);
  assertBinding(sha256(readFileSync(packPath)), declaration.packSha256, "FULL_PACK");
  assert.deepEqual(packRecord.files.map(value => value.path).sort(), Object.keys(declaration.packFiles).sort(), "exact FULL manifest files including automatic README admission");
  mkdirSync(installed);
  json(join(installed, "package.json"), { private: true, type: "module" });
  success(command("install-full-pack", tools.node, [tools.npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", packPath], installed, { timeout: 180_000 }));
  assertBinding(inventory(join(installed, "node_modules/virtual-bash")), declaration.packFiles, "INSTALLED_FULL_PACK");
  for (const [filename, digest] of Object.entries(declaration.workerFiles)) assertBinding(declaration.packFiles[filename], digest, `WORKER_${filename}`);
  for (const filename of Object.keys(fixtureFiles)) if (filename.endsWith(".mjs") || filename.endsWith(".ts.data")) cpSync(join(owned, filename), join(installed, filename));
  json(join(installed, "declaration.json"), declaration);
  mkdirSync(join(installed, "node_modules/@types"), { recursive: true });
  cpSync(tools.nodeTypes, join(installed, "node_modules/@types/node"), { recursive: true });
  cpSync(tools.undiciTypes, join(installed, "node_modules/undici-types"), { recursive: true });

  function launch(directory, mode, id = "unused") {
    return command(`${mode}-${id}`, tools.node, ["--experimental-loader", "./loader.mjs", "./driver.mjs", mode, id, "./declaration.json"], directory, { env: { ...env, HTML_FIXTURE_ROOT: directory }, timeout: 15_000 });
  }
  function types(directory, filename) {
    const target = filename.replace(/\.data$/, "");
    writeFileSync(join(directory, target), readFileSync(join(directory, filename), "utf8").replaceAll("__HTML_OPTION__", declaration.agentOption), { flag: "wx" });
    const result = command(`types-${target}`, tools.node, [tools.tsc, "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--verbatimModuleSyntax", "--skipLibCheck", "false", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node", "--traceResolution", target], directory, { timeout: 60_000 });
    const resolutions = [...result.stdout.matchAll(/successfully resolved to '([^']+)'/g)].map(match => match[1]);
    assert.ok(resolutions.length > 0, "strict types must actually resolve declarations");
    for (const filename of resolutions) {
      assert.ok(filename.startsWith(`${directory}/node_modules/`), `BOUNDARY:TYPE_SOURCE_FALLBACK:${filename}`);
      assert.match(filename, /\.d\.(?:ts|mts|cts)$/, `declaration required: ${filename}`);
    }
    return result;
  }
  function layout(directory) {
    assertBinding(inventory(join(directory, "node_modules/virtual-bash")), declaration.packFiles, "PRE_LAYOUT_PACK");
    for (const [id] of runtimeCases) {
      const result = success(launch(directory, "case", id));
      const receipts = result.stdout.split("\n").filter(line => line.startsWith('{"receipt":')).map(line => JSON.parse(line));
      assert.equal(receipts.length, 1, "natural exit without one exact case receipt is NOT a pass");
      assert.equal(receipts[0].receipt, id);
      assert.equal(receipts[0].result, "PASS_FROZEN_ASSERTIONS_ONLY");
    }
    success(types(directory, "positive.ts.data"));
    for (const [filename, diagnostic] of [["negative-limit.ts.data", /negative-limit\.ts\(2,.*error TS2322/], ["negative-option.ts.data", /negative-option\.ts\(2,.*error TS2353/], ["negative-replace.ts.data", /negative-replace\.ts\(2,.*error TS2353/], ["negative-private.ts.data", /negative-private\.ts\(1,.*error TS2307/]]) {
      const result = failure(types(directory, filename), diagnostic, 2);
      assert.equal((result.stdout.match(/error TS\d+/g) ?? []).length, 1, "negative must fail at only its intended type boundary");
    }
    assertBinding(inventory(join(directory, "node_modules/virtual-bash")), declaration.packFiles, "POST_LAYOUT_PACK_APPEND_AWARE");
  }
  layout(installed);
  const moved = join(scratch, "physically-moved-consumer");
  renameSync(installed, moved);
  assert.equal(existsSync(installed), false);
  for (const filename of ["positive.ts", "negative-limit.ts", "negative-option.ts", "negative-replace.ts", "negative-private.ts"]) rmSync(join(moved, filename));
  layout(moved);

  function control(name, mutate) {
    const directory = join(scratch, `control-${name}`);
    cpSync(moved, directory, { recursive: true });
    assertBinding(inventory(join(directory, "node_modules/virtual-bash")), declaration.packFiles, "CONTROL_BASE_PACK");
    mutate(directory);
    json(join(scratch, `CONTROL-${name}-PRE.json`), { intendedBoundary: name, tree: inventory(directory), tools: declaration.toolExecutables, loader: fixtureFiles["loader.mjs"], driver: fixtureFiles["driver.mjs"] });
    return directory;
  }
  const missingExport = control("missing-export", directory => {
    const filename = join(directory, "node_modules/virtual-bash/package.json");
    const changedManifest = JSON.parse(readFileSync(filename));
    delete changedManifest.exports["./commands/html-to-markdown"];
    writeFileSync(filename, JSON.stringify(changedManifest));
  });
  assert.match(success(launch(missingExport, "missing-export")).stdout, /BOUNDARY:MISSING_EXPORT/);
  const missingDependency = control("missing-dependency", directory => renameSync(join(directory, "node_modules/virtual-bash"), join(directory, "removed-package")));
  assert.match(success(launch(missingDependency, "missing-dependency")).stdout, /BOUNDARY:MISSING_DEPENDENCY:virtual-bash/);
  const missingWorker = control("missing-worker", directory => rmSync(join(directory, "node_modules/virtual-bash/dist/commands/regex-execution/worker.js")));
  assert.match(success(launch(missingWorker, "missing-worker")).stdout, /BOUNDARY:MISSING_WORKER/);
  const poison = control("poison", directory => cpSync(join(owned, "poison.mjs"), join(directory, "node_modules/virtual-bash/dist/index.js")));
  failure(launch(poison, "poison"), /Error: HTML_POISON_SENTINEL_20260827/, 1);
  const fallback = control("source-fallback", directory => {
    const changedDeclaration = { ...declaration, forbiddenSourceUrl: pathToFileURL(join(poison, "node_modules/virtual-bash/dist/index.js")).href };
    writeFileSync(join(directory, "declaration.json"), JSON.stringify(changedDeclaration));
  });
  const fallbackResult = failure(launch(fallback, "source-fallback"), /BOUNDARY:SOURCE_FALLBACK/, 1);
  assert.ok(!fallbackResult.stderr.includes("Error: HTML_POISON_SENTINEL_20260827"), "sourceguard must reject BEFORE sentinel execution");
  const permissionTarget = join(scratch, "permission-target.txt");
  writeFileSync(permissionTarget, "fixture-readable", { flag: "wx" });
  json(join(scratch, "CONTROL-permission-PRE.json"), { target: permissionTarget, sha256: sha256(readFileSync(permissionTarget)), script: fixtureFiles["permission.mjs"], tools: declaration.toolExecutables });
  assert.match(success(command("permission-positive", tools.node, [join(moved, "permission.mjs"), permissionTarget], moved)).stdout, /PERMISSION_CONTROL_READ:fixture-readable/);
  failure(command("permission-negative", tools.node, ["--experimental-permission", `--allow-fs-read=${moved}`, join(moved, "permission.mjs"), permissionTarget], moved), /BOUNDARY:PERMISSION_DENIED:FileSystemRead/, 17);
  const guardControls = {};
  for (const [name, actual, expected] of [["SOURCE_ARCHIVE", "0".repeat(64), declaration.archiveSha256], ["FULL_PACK", "0".repeat(64), declaration.packSha256], ["APPEND_TREE", { ...declaration.packFiles, "unexpected-entry": "0".repeat(64) }, declaration.packFiles]]) {
    json(join(scratch, `CONTROL-${name}-PRE.json`), { actual, expected, guard: fixtureFiles["contract.mjs"] });
    assert.throws(() => assertBinding(actual, expected, name), error => error.message.includes(`BOUNDARY:${name}`));
    guardControls[name] = "qualified exact guard rejection; no product launch";
  }
  assertBinding(inventory(source), afterBuild, "POST_SOURCE_TREE_APPEND_AWARE");
  assertBinding(sha256(readFileSync(packPath)), declaration.packSha256, "POST_PACK");
  json(join(scratch, "RESULT.json"), { status: "FROZEN_ASSERTIONS_PASSED_PENDING_CLOSE_DISPOSITION", declaration, guardControls, steps, caveat: "Not title, whole-gate, old failed controls, all-producer, or superiority acceptance" });
} catch (error) {
  json(join(scratch, "FAILURE.json"), { message: String(error), stack: error.stack, steps, classification: "NOT_PASS; inspect raw; timeout/kill is supervisor failure, not natural product settlement" });
  throw error;
}
