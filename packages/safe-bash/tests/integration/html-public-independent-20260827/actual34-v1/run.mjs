import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { candidate, fileHash, frozen, git, here, inventory, json, packSha, parse, repository, sha256 } from "./common.mjs";
import { supervise } from "./supervisor.mjs";

const [recipeCommit] = process.argv.slice(2);
assert.equal(process.argv.length, 3); assert.match(recipeCommit, /^[a-f0-9]{40}$/u);
const manifest = parse(join(here, "MANIFEST.json"));
function recipeCheck() {
  for (const [path, expected] of Object.entries(manifest.files)) {
    assert.equal(fileHash(join(here, path)), expected, `RECIPE:${path}`);
    assert.equal(sha256(git(["show", `${recipeCommit}:${relative(repository, join(here, path))}`])), expected, `COMMITTED_RECIPE:${path}`);
  }
  assert.equal(sha256(git(["show", `${recipeCommit}:${relative(repository, join(here, "MANIFEST.json"))}`])), fileHash(join(here, "MANIFEST.json")));
}
recipeCheck();
const pin = parse(join(here, "PREAUTH.json"));
const qualification = parse(join(here, "qualification-01/RESULT.json"));
assert.equal(qualification.status, "HARNESS_ONLY_4_EXPECTED"); assert.equal(qualification.commit, recipeCommit);
assert.equal(qualification.manifestSha256, fileHash(join(here, "MANIFEST.json")));
const output = join(here, "execution-01");
mkdirSync(output);
const work = join(here, "node_modules/actual34-work");
assert.equal(existsSync(work), false); mkdirSync(work, { recursive: true });
const report = { schema: "html-actual34-execution/1", started: new Date().toISOString(), candidate, recipeCommit, manifestSha256: fileHash(join(here, "MANIFEST.json")), invocation: 1, retries: 0, runtime: [], types: [], controls: [], commands: [], layouts: [], unexpected: [], unexecuted: [], signals: [], status: "running", runtimeProfile: { node: pin.tools.node, layouts: ["installed", "physically-moved-consumer"], uniqueCases: 34, expectedReceipts: 68, types: 10, controlClasses: 10 }, wholeGate: false, du29: 0, expr104: 0 };
json(join(output, "INVOCATION.json"), report);
json(join(output, "QUALIFICATION.json"), { ...qualification, resultSha256: fileHash(join(here, "qualification-01/RESULT.json")) });
const tools = pin.tools;
const env = { PATH: `${dirname(tools.node.path)}:/usr/bin:/bin`, HOME: work, TMPDIR: work, LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: join(work, "npm-cache"), npm_config_userconfig: join(work, "empty.npmrc"), npm_config_globalconfig: join(work, "empty-global.npmrc"), npm_config_update_notifier: "false" };
writeFileSync(env.npm_config_userconfig, "", { flag: "wx" }); writeFileSync(env.npm_config_globalconfig, "", { flag: "wx" });
let sequence = 0;
function protectedCheck() {
  for (const [path, row] of Object.entries(pin.protectedFiles)) assert.equal(fileHash(join(repository, path)), row.sha256, `PROTECTED:${path}`);
  for (const [name, tool] of Object.entries(tools)) {
    const actual = ["typescript", "nodeTypes", "undiciTypes", "npmRoot"].includes(name) ? sha256(JSON.stringify(inventory(tool.path))) : fileHash(tool.path);
    assert.equal(actual, tool.sha256, `TOOL:${name}`);
  }
  return { at: new Date().toISOString(), protectedFiles: Object.keys(pin.protectedFiles).length, tools: Object.keys(tools).length, status: "unchanged", appendScope: "Original protected files only, not foreign-owned directory additions. Actual installed/moved/control recursive file inventories below reject added files and symlinks, not empty directories." };
}
async function command(name, args, cwd, extraEnv = {}, timeoutMs = 15000) {
  const directory = join(output, `${String(++sequence).padStart(3, "0")}-${name}`);
  const raw = await supervise(directory, tools.node.path, args, { cwd, env: { ...env, ...extraEnv }, timeoutMs });
  report.commands.push({ name, raw: relative(output, join(directory, "RAW.json")), code: raw.code, pid: raw.pid, closed: raw.closed, remainingGroup: raw.ps.members });
  return raw;
}
const success = raw => { assert.equal(raw.code, 0, raw.stderr.slice(-1600)); return raw; };
function negative(raw, pattern, code) { assert.equal(raw.code, code, raw.stderr.slice(-1600)); assert.match(`${raw.stdout}\n${raw.stderr}`, pattern); return raw; }
function packCheck(directory, boundary) { assert.deepEqual(inventory(join(directory, "node_modules/virtual-bash")), pin.package.memberHashes, boundary); }
function caseReceipt(raw, id) {
  const receipts = raw.stdout.split("\n").filter(line => line.startsWith('{"receipt":')).map(line => JSON.parse(line));
  assert.equal(receipts.length, 1); assert.equal(receipts[0].receipt, id); assert.equal(receipts[0].result, "PASS_FROZEN_ASSERTIONS_ONLY");
  return receipts[0];
}
function actualLoads(raw, directory) {
  const rows = raw.stderr.split("\n").filter(line => line.startsWith("HTML_ACTUAL_LOAD:")).map(line => JSON.parse(line.slice("HTML_ACTUAL_LOAD:".length)));
  const expected = parse(join(directory, "load-map.json"));
  for (const row of rows) assert.equal(row.sha256, expected[row.path], `BOUNDARY:LOAD_RECEIPT:${row.path}`);
  return rows;
}
function loadMap(directory) {
  const files = inventory(directory);
  delete files["load-map.json"];
  writeFileSync(join(directory, "load-map.json"), `${JSON.stringify(files)}\n`);
  return files;
}
async function launch(directory, mode, id = "unused", script = "driver.mjs") {
  const before = inventory(directory);
  const raw = await command(`${basename(directory)}-${mode}-${id}`, ["--experimental-loader", "./loader.mjs", "--experimental-loader", "./audit-loader.mjs", `./${script}`, mode, id, "./declaration.json"], directory, { HTML_FIXTURE_ROOT: directory });
  assert.deepEqual(inventory(directory), before, "BOUNDARY:CONSUMER_MUTATION");
  if (/BOUNDARY:(?:ACTUAL_LOAD_HASH|LOAD_RECORD_LIMIT|UNEXPECTED_HOST|WORKER_HASH|WORKER_LAYOUT)/u.test(raw.stderr)) throw new Error(`BOUNDARY:INTEGRITY_OR_EFFECT:${mode}:${id}`);
  if (mode !== "source-fallback" && raw.stderr.includes("BOUNDARY:SOURCE_FALLBACK")) throw new Error(`BOUNDARY:INTEGRITY_OR_EFFECT:unexpected-source-fallback:${mode}:${id}`);
  const loads = actualLoads(raw, directory);
  assert.ok(loads.some(row => row.path === script), "BOUNDARY:MISSING_DRIVER_LOAD");
  return { raw, loads };
}
try {
  json(join(output, "PRE-PROTECTED.json"), protectedCheck());
  const { runtimeCases, controlCases, assertBinding, validateDeclaration } = await import("../contract.mjs");
  assert.equal(runtimeCases.length, 34);
  const declaration = validateDeclaration(parse(pin.receiptPath));
  const packPath = join(work, "package.tgz");
  const bytes = Buffer.from(readFileSync(join(repository, pin.package.base64), "utf8").trim(), "base64");
  assertBinding(sha256(bytes), packSha, "FULL_PACK");
  writeFileSync(packPath, bytes, { flag: "wx" });
  json(join(output, "PACKAGE-PRE.json"), { sha256: fileHash(packPath), bytes: bytes.length, members: pin.package.memberHashes, source: pin.package.base64, acceptedBuild: pin.composition.partialCommit, archiveProof: pin.composition.partial.archives, exactBuildInputs: pin.composition.partial.inputs });
  const installed = join(work, "installed"); mkdirSync(installed);
  json(join(installed, "package.json"), { private: true, type: "module" });
  success(await command("install-full-pack", [tools.npm.path, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", packPath], installed, {}, 180000));
  packCheck(installed, "BOUNDARY:INSTALLED_FULL_PACK");
  assert.deepEqual(JSON.parse(readFileSync(join(installed, "node_modules/virtual-bash/package.json"))).dependencies ?? {}, {});
  for (const [path, hash] of Object.entries(declaration.workerFiles)) assert.equal(pin.package.memberHashes[path], hash);
  for (const path of pin.fixturePaths) if (path.endsWith(".mjs") || path.endsWith(".ts.data")) cpSync(join(repository, path), join(installed, basename(path)));
  for (const path of ["audit-loader.mjs", "root-export-control.mjs"]) cpSync(join(here, path), join(installed, path));
  json(join(installed, "declaration.json"), declaration);
  mkdirSync(join(installed, "node_modules/@types"), { recursive: true });
  cpSync(tools.nodeTypes.path, join(installed, "node_modules/@types/node"), { recursive: true });
  cpSync(tools.undiciTypes.path, join(installed, "node_modules/undici-types"), { recursive: true });
  const typeCases = [["positive.ts.data", 0, null], ["negative-limit.ts.data", 2, /negative-limit\.ts\(2,.*error TS2322/u], ["negative-option.ts.data", 2, /negative-option\.ts\(2,.*error TS2353/u], ["negative-replace.ts.data", 2, /negative-replace\.ts\(2,.*error TS2353/u], ["negative-private.ts.data", 2, /negative-private\.ts\(1,.*error TS2307/u]];
  async function layout(directory) {
    packCheck(directory, "BOUNDARY:PRE_LAYOUT_PACK");
    const before = loadMap(directory);
    json(join(output, `${basename(directory)}-PRE-INVENTORY.json`), { directory, files: before, loadMapSha256: fileHash(join(directory, "load-map.json")), workerFiles: declaration.workerFiles });
    for (const [id] of runtimeCases) {
      const { raw, loads } = await launch(directory, "case", id);
      const row = { layout: basename(directory), node: process.version, id, code: raw.code, status: "fail", loads, raw: report.commands.at(-1).raw };
      assert.ok(loads.some(load => load.path === "node_modules/virtual-bash/dist/index.js"), "BOUNDARY:MISSING_PRODUCT_LOAD");
      if (raw.code === 0) {
        row.receipt = caseReceipt(raw, id); row.status = "pass-frozen-assertions";
      } else { row.error = raw.stderr.split("\n").filter(line => !line.startsWith("HTML_ACTUAL_LOAD:")).join("\n"); report.unexpected.push({ kind: "runtime", layout: row.layout, id, error: row.error }); }
      report.runtime.push(row);
      json(join(output, `${basename(directory)}-${id}-VERDICT.json`), row);
      console.log(JSON.stringify({ layout: row.layout, id, status: row.status, code: row.code, error: row.error?.slice(-1200) }));
    }
    for (const [filename, code, pattern] of typeCases) {
      const target = filename.replace(/\.data$/u, "");
      writeFileSync(join(directory, target), readFileSync(join(directory, filename), "utf8").replaceAll("__HTML_OPTION__", declaration.agentOption), { flag: "wx" });
      const pre = inventory(directory);
      const raw = await command(`${basename(directory)}-types-${target}`, [tools.tsc.path, "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--verbatimModuleSyntax", "--skipLibCheck", "false", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node", "--traceResolution", target], directory, {}, 60000);
      assert.deepEqual(inventory(directory), pre, "BOUNDARY:TYPE_CONSUMER_MUTATION");
      const resolutions = [...raw.stdout.matchAll(/successfully resolved to '([^']+)'/gu)].map(match => match[1]);
      assert.ok(resolutions.length > 0, "BOUNDARY:NO_TYPE_RESOLUTIONS");
      for (const path of resolutions) { assert.ok(path.startsWith(`${directory}/node_modules/`), `BOUNDARY:TYPE_SOURCE_FALLBACK:${path}`); assert.match(path, /\.d\.(?:ts|mts|cts)$/u); }
      const row = { layout: basename(directory), filename, code: raw.code, expectedCode: code, status: "fail", raw: report.commands.at(-1).raw, resolutions: Object.fromEntries([...new Set(resolutions)].map(path => [relative(directory, path), fileHash(path)])) };
      try {
        assert.equal(raw.code, code);
        if (pattern) { assert.match(raw.stdout, pattern); assert.equal((raw.stdout.match(/error TS\d+/gu) ?? []).length, 1); }
        else assert.equal((raw.stdout.match(/error TS\d+/gu) ?? []).length, 0);
        row.status = "expected";
      } catch (error) { row.error = error.message; report.unexpected.push({ kind: "types", layout: row.layout, filename, error: error.message }); }
      report.types.push(row); json(join(output, `${basename(directory)}-${target}-VERDICT.json`), row);
    }
    packCheck(directory, "BOUNDARY:POST_LAYOUT_PACK");
    const post = inventory(directory);
    json(join(output, `${basename(directory)}-POST-INVENTORY.json`), { directory, files: post });
    report.layouts.push({ name: basename(directory), packageFiles: 830, beforeSha256: sha256(JSON.stringify(before)), afterSha256: sha256(JSON.stringify(post)) });
  }
  await layout(installed);
  const moved = join(work, "physically-moved-consumer");
  const beforeMove = inventory(installed); renameSync(installed, moved); assert.equal(existsSync(installed), false);
  assert.deepEqual(inventory(moved), beforeMove);
  json(join(output, "PHYSICAL-MOVE.json"), { from: installed, to: moved, oldAbsent: true, exactInventorySha256: sha256(JSON.stringify(beforeMove)), packageSha256: packSha, at: new Date().toISOString() });
  for (const [filename] of typeCases) rmSync(join(moved, filename.replace(/\.data$/u, "")));
  await layout(moved);
  const passed = id => report.runtime.some(row => row.layout === basename(moved) && row.id === id && row.status === "pass-frozen-assertions");
  async function control(id, task, prerequisite = "P01") {
    if (!passed(prerequisite)) { report.controls.push({ id, status: "blocked", prerequisite }); return; }
    const row = { id, status: "unexpected" };
    try { row.details = await task(); row.status = "expected"; }
    catch (error) { row.error = { message: error.message, stack: error.stack }; report.unexpected.push({ kind: "control", id, error: row.error }); if (/BOUNDARY:(?:INTEGRITY|UNREAPED|LAUNCH|SUPERVISOR|UNNATURAL|CONSUMER_MUTATION|MISSING_DRIVER_LOAD)/u.test(error.message)) throw error; }
    finally { report.controls.push(row); json(join(output, `${id}-VERDICT.json`), row); }
  }
  function mutant(name, mutate) {
    const directory = join(work, `control-${name}`); cpSync(moved, directory, { recursive: true });
    packCheck(directory, "BOUNDARY:CONTROL_BASE_PACK"); mutate(directory); loadMap(directory);
    json(join(output, `CONTROL-${name}-PRE.json`), { directory, files: inventory(directory), loader: fileHash(join(directory, "loader.mjs")), driver: fileHash(join(directory, "driver.mjs")) });
    return directory;
  }
  await control("C01-missing-export", async () => {
    const outcomes = [];
    for (const key of ["./commands/html-to-markdown", "."]) {
      const directory = mutant(key === "." ? "missing-root" : "missing-export", root => {
        const path = join(root, "node_modules/virtual-bash/package.json"), manifest = parse(path); delete manifest.exports[key]; writeFileSync(path, JSON.stringify(manifest));
      });
      const { raw } = await launch(directory, "missing-export", "unused", key === "." ? "root-export-control.mjs" : "driver.mjs");
      assert.match(success(raw).stdout, key === "." ? /BOUNDARY:MISSING_ROOT_EXPORT/u : /BOUNDARY:MISSING_EXPORT/u); outcomes.push({ key, code: raw.code });
    }
    return outcomes;
  });
  for (const [id, boundary, expected] of [["C02-wrong-source", "SOURCE_ARCHIVE", declaration.archiveSha256], ["C03-wrong-pack", "FULL_PACK", declaration.packSha256]]) await control(id, async () => {
    json(join(output, `${id}-INPUT.json`), { actual: "0".repeat(64), expected, guardSha256: fileHash(join(frozen, "contract.mjs")) });
    assert.throws(() => assertBinding("0".repeat(64), expected, boundary), error => error.message.includes(`BOUNDARY:${boundary}`)); return { boundary, kind: "frozen exact guard negative; no archive replay" };
  });
  await control("C04-missing-dependency", async () => {
    const directory = mutant("missing-dependency", root => renameSync(join(root, "node_modules/virtual-bash"), join(root, "removed-package")));
    assert.match(success((await launch(directory, "missing-dependency")).raw).stdout, /BOUNDARY:MISSING_DEPENDENCY:virtual-bash/u);
  });
  await control("C05-missing-worker", async () => {
    const directory = mutant("missing-worker", root => rmSync(join(root, "node_modules/virtual-bash/dist/commands/regex-execution/worker.js")));
    const { raw } = await launch(directory, "missing-worker"); assert.match(success(raw).stdout, /BOUNDARY:MISSING_WORKER/u); assert.match(raw.stdout, /WORKER_CONSTRUCT:/u);
  }, "P12");
  let poison;
  await control("C06-poison-sentinel", async () => {
    poison = mutant("poison", root => cpSync(join(frozen, "poison.mjs"), join(root, "node_modules/virtual-bash/dist/index.js")));
    const target = pathToFileURL(join(poison, "node_modules/virtual-bash/dist/index.js")).href;
    const unguarded = negative(await command("poison-present-unguarded", ["--input-type=module", "--eval", `await import(${JSON.stringify(target)})`], poison), /Error: HTML_POISON_SENTINEL_20260827/u, 1);
    const guarded = negative((await launch(poison, "poison")).raw, /Error: HTML_POISON_SENTINEL_20260827/u, 1);
    return { target, unguarded: unguarded.code, installedSentinel: guarded.code };
  });
  await control("C07-source-fallback", async () => {
    assert.equal(report.controls.find(row => row.id === "C06-poison-sentinel")?.status, "expected", "sentinel must execute before boundary denial");
    const directory = mutant("source-fallback", root => writeFileSync(join(root, "declaration.json"), JSON.stringify({ ...declaration, forbiddenSourceUrl: pathToFileURL(join(poison, "node_modules/virtual-bash/dist/index.js")).href })));
    const { raw } = await launch(directory, "source-fallback"); negative(raw, /BOUNDARY:SOURCE_FALLBACK/u, 1);
    assert.ok(!raw.stderr.includes("Error: HTML_POISON_SENTINEL_20260827"));
  });
  await control("C08-permission-denial", async () => {
    const target = join(work, "permission-target.txt"); writeFileSync(target, "fixture-readable", { flag: "wx" });
    json(join(output, "PERMISSION-TARGET-PRE.json"), { target, sha256: fileHash(target), script: fileHash(join(moved, "permission.mjs")), node: tools.node });
    assert.match(success(await command("permission-positive", [join(moved, "permission.mjs"), target], moved)).stdout, /PERMISSION_CONTROL_READ:fixture-readable/u);
    negative(await command("permission-negative", ["--experimental-permission", `--allow-fs-read=${moved}`, join(moved, "permission.mjs"), target], moved), /BOUNDARY:PERMISSION_DENIED:FileSystemRead/u, 17);
  });
  await control("C09-types-negative", async () => { assert.equal(report.types.length, 10); assert.ok(report.types.every(row => row.status === "expected")); return { positives: 2, individualNegatives: 8 }; });
  await control("C10-append-tree", async () => {
    const directory = mutant("append-tree", root => writeFileSync(join(root, "node_modules/virtual-bash/unexpected-entry"), "frozen append control", { flag: "wx" }));
    assert.throws(() => assertBinding(inventory(join(directory, "node_modules/virtual-bash")), declaration.packFiles, "APPEND_TREE"), error => error.message.includes("BOUNDARY:APPEND_TREE"));
  });
  assert.deepEqual(report.controls.map(row => row.id).sort(), [...controlCases].sort());
  packCheck(moved, "BOUNDARY:FINAL_MOVED_PACK"); assert.equal(fileHash(packPath), packSha);
  report.status = report.unexpected.length || report.controls.some(row => row.status !== "expected") ? "FROZEN_REVIEW_FAILED" : "FROZEN_ASSERTIONS_PASSED_WITH_ORIGINAL_UNSCORED_LIMITS";
} catch (error) {
  report.status = "STOP_DEPENDENTS"; report.fatal = { message: error.message, stack: error.stack };
  console.error(JSON.stringify({ status: report.status, error: report.fatal })); process.exitCode = 1;
} finally {
  try { report.protectedPost = protectedCheck(); recipeCheck(); }
  catch (error) { report.status = "INTEGRITY_HOLD"; report.postError = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  const allIds = Array.from({ length: 9 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`).concat(Array.from({ length: 14 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`), Array.from({ length: 11 }, (_, index) => `L${String(index + 1).padStart(2, "0")}`));
  report.unexecuted = ["installed", "physically-moved-consumer"].flatMap(layout => allIds.filter(id => !report.runtime.some(row => row.layout === layout && row.id === id)).map(id => ({ layout, id })));
  report.finished = new Date().toISOString();
  report.counts = { runtimeExecuted: report.runtime.length, runtimePassed: report.runtime.filter(row => row.status === "pass-frozen-assertions").length, runtimeFailed: report.runtime.filter(row => row.status === "fail").length, runtimeUnexecuted: report.unexecuted.length, typesExecuted: report.types.length, typesExpected: report.types.filter(row => row.status === "expected").length, controlClassesExecuted: report.controls.filter(row => row.status !== "blocked").length, controlClassesExpected: report.controls.filter(row => row.status === "expected").length };
  json(join(output, "RESULT.json"), report);
  console.log(JSON.stringify({ status: report.status, counts: report.counts, unexpected: report.unexpected.length }));
  if (report.status !== "FROZEN_ASSERTIONS_PASSED_WITH_ORIGINAL_UNSCORED_LIMITS") process.exitCode = 1;
}
