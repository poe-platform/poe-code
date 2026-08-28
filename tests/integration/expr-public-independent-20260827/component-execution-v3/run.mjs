import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { directory, repository, owner, candidate, legacyDirectory, digest, read, json, put, putJson, inventory, copyInventory } from "./common.mjs";

import { admitted } from "./admission.mjs";

assert.ok(admitted, "qualified v3 admission required");
const { inputs, layouts, selected, load, commit: freezeCommit } = admitted;
const runDirectory = join(directory, "work/run-001");
mkdirSync(dirname(runDirectory), { recursive: true }); mkdirSync(runDirectory);
const rawDirectory = join(runDirectory, "raw"); mkdirSync(rawDirectory);
const buildDirectory = join(runDirectory, "build"), tools = join(runDirectory, "tools");
const report = { schema: "expr-independent-component-v3", authorizationDate: "2026-08-28", startedAt: new Date().toISOString(), freezeCommit,
  inputsSha256: digest(read(join(legacyDirectory, "INPUTS.json"))), candidate, tree: inputs.tree, scope: "EXPRPUBLICCOMPONENT only; no accepted-DU or whole76 claim", P01: { status: "unrun" },
  contexts: [], checks: [], failures: [], commands: [], holds: ["accepted-DU75 remains HELD/unrescored", "HTML accepted by root separately; not rerun or certified here", "whole76 HELD", "original acceptance-gated consumer HELD"],
  originalFilesProductPasses: 0, sourceScope: "Nine expr/shared-regex sources retain accepted c3 bytes. Candidate shell/cancellation.ts is separate lifecycle scope, not TEMP acceptance; actual public loads are reported below.", executionDirectory: runDirectory };
const save = (name, value) => putJson(join(rawDirectory, `${name}.json`), value);
function check(name, callback) {
  try { callback(); report.checks.push({ name, status: "pass", productPass: false }); return true; }
  catch (error) { report.checks.push({ name, status: "fail", error: error.stack }); report.failures.push({ name, error: error.message }); console.log(JSON.stringify({ checkpoint: "failure", name, error: error.message })); return false; }
}
async function run(name, executable, args, cwd, timeout = 15000) {
  const started = Date.now(), stdout = [], stderr = [];
  let bytes = 0, supervision = null, spawnError;
  const environment = { PATH: `${dirname(executable)}:/usr/bin:/bin`, HOME: runDirectory, TMPDIR: runDirectory, LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: join(runDirectory, "npm-cache"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
  const result = await new Promise(resolve => {
    const child = spawn(executable, args, { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    function kill(reason) { if (!supervision) { supervision = reason; try { process.kill(-child.pid, "SIGKILL"); } catch {} } }
    const timer = setTimeout(() => kill("timeout-supervised-negative-or-failure-not-natural"), Math.max(1, timeout));
    const collect = target => chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) kill("combined-output-cap-1MiB"); else target.push(Buffer.from(chunk)); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", error => { spawnError = error.message; });
    child.once("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, closed: true, error: spawnError }); });
  });
  const receipt = { name, executable, executableSha256: inputs.runtimes.find(value => value.executable === executable)?.sha256, args, cwd, environment, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ...result, supervision, naturalSettlement: supervision === null && result.signal === null && !result.error, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  save(name, receipt); report.commands.push({ name, status: result.status, durationMs: receipt.durationMs, supervision, naturalSettlement: receipt.naturalSettlement, closed: result.closed });
  return receipt;
}
function authenticateOriginal() {
  for (const entry of inputs.original) assert.equal(digest(read(join(repository, entry.path))), entry.sha256, entry.path);
  assert.deepEqual(inventory(join(repository, owner, "component-admission-v1")), inputs.admissionFiles);
  for (const runtime of inputs.runtimes) assert.equal(digest(read(runtime.executable)), runtime.sha256);
  for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
}
function selectedView() {
  const rows = inventory(buildDirectory).filter(row => row.path !== "node_modules" && !row.path.startsWith("node_modules/") && row.path !== "dist" && !row.path.startsWith("dist/"));
  return rows;
}
function members(packBytes) {
  const tar = gunzipSync(packBytes, { maxOutputLength: 16 * 1024 * 1024 }), rows = [], names = new Set();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/su, "");
    const prefix = text(345, 155), name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
    assert.ok(name.startsWith("package/")); const path = name.slice(8);
    assert.ok(path && !path.split("/").some(part => ["..", ".", "", "AGENTS.md"].includes(part)));
    assert.ok(!names.has(path)); names.add(path);
    assert.ok([0, 48].includes(header[156]), `nonregular tar member ${path}`);
    const size = Number.parseInt(text(124, 12).trim(), 8), mode = Number.parseInt(text(100, 8).trim(), 8) & 0o777;
    const expectedChecksum = Number.parseInt(text(148, 8).trim(), 8);
    const checksum = header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0); assert.equal(checksum, expectedChecksum);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    const bytes = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    rows.push({ path, mode, bytes, sha256: digest(bytes) }); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(rows.length, 834);
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.path, row.sha256]).sort(([left], [right]) => left.localeCompare(right))), Object.fromEntries(Object.entries(inputs.packageFiles).sort(([left], [right]) => left.localeCompare(right))));
  return rows;
}
const harnessFiles = ["child.mjs", "consumer-component.mjs", "observer.mjs", "silent-worker.mjs", "guard.mjs", "worker-guard.mjs", "cases.json"];
function stageHarness(consumer) {
  for (const name of harnessFiles) put(join(consumer, name), read(join(legacyDirectory, name)));
  putJson(join(consumer, "package.json"), { private: true, type: "module" });
  for (const name of ["positive", "negative"]) put(join(consumer, `${name}.ts`), read(join(legacyDirectory, `${name}.ts.fixture`)));
}
function bind(consumer, name, forbiddenSource = undefined) {
  const entries = inventory(consumer), expected = Object.fromEntries(entries.filter(row => row.kind === "file" && (row.path.startsWith("node_modules/virtual-bash/") || harnessFiles.includes(row.path))).map(row => [join(consumer, row.path), row.sha256]).sort(([left], [right]) => left.localeCompare(right)));
  const planned = layouts.layouts.find(layout => layout.name === name); assert.ok(planned); assert.equal(planned.consumer, consumer); assert.equal(planned.forbiddenSource, forbiddenSource); assert.deepEqual(expected, planned.expected); assert.equal(digest(JSON.stringify(expected)), planned.expectedSha256);
  const value = { candidateQualifiedBeforeRun: true, componentProfile: "EXPR_COMPONENT_ACCEPTED_DU75_HELD", du75AcceptedBeforeRun: false, baselineNames: json(join(directory, "cases.json")).baselineNames, expected, forbiddenSource, candidate, freezeCommit };
  putJson(join(consumer, "binding.json"), value); save(`binding-${name}`, value);
}
function childReceipt(result) { return result.stdout.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => value?.id); }
function assertChild(result) { assert.equal(result.status, 0, result.stderr.slice(-1500)); assert.equal(result.naturalSettlement, true); assert.equal(childReceipt(result)?.status, "pass", result.stdout.slice(-2000)); }
function cloneConsumer(source, target) {
  copyInventory(source, target, inventory(source).filter(row => row.path !== "binding.json"));
}
const compiler = join(tools, "node_modules/typescript/bin/tsc");
async function context(phase, runtime, consumer) {
  assert.equal(report.integrityHeld, undefined, "earlier integrity/lifecycle failure holds dependents");
  const label = `${phase}-node${runtime.version.startsWith("v22") ? "22" : "24"}`, started = Date.now();
  const state = { label, phase, runtime: runtime.version, cases: Array.from({ length: 26 }, (_, index) => ({ id: `R${String(index + 1).padStart(2, "0")}`, status: "unrun" })), controls: [], types: [] };
  report.contexts.push(state);
  const packageBefore = inventory(join(consumer, "node_modules/virtual-bash"));
  save(`${label}-package-before`, packageBefore);
  const timeRemaining = () => Math.max(1, Math.min(15000, 120000 - (Date.now() - started)));
  async function execute(id, target = consumer, guarded = true) {
    assert.ok(Date.now() - started < 120000, `${label} context bound exceeded`);
    const flags = guarded ? ["--permission", `--allow-fs-read=${target}`, `--allow-fs-read=${tools}`, "--allow-worker", "--import", join(target, "guard.mjs")] : [];
    return run(`${label}-${id}`, runtime.executable, [...flags, join(target, "child.mjs"), id], target, timeRemaining());
  }
  async function control(id, callback) {
    try { await callback(); state.controls.push({ id, status: "pass" }); return true; }
    catch (error) { state.controls.push({ id, status: "fail", error: error.stack }); report.failures.push({ name: `${label}-${id}`, error: error.message }); console.log(JSON.stringify({ checkpoint: "control-failure", context: label, id, error: error.message.slice(0, 700) })); return false; }
  }
  const ordinaryQualified = await control("ordinary", async () => {
    const result = await execute("ordinary"); assertChild(result);
    for (const path of ["dist/index.js", "dist/commands/expr/index.js"]) assert.ok(result.stderr.includes(join(consumer, "node_modules/virtual-bash", path)));
    assert.equal(childReceipt(result).observer.workers.length, 1);
  });
  const heldReleaseQualified = ordinaryQualified && await control("held-release", async () => assertChild(await execute("held-release")));
  const heldWithholdQualified = ordinaryQualified && await control("held-withhold", async () => assertChild(await execute("held-withhold")));
  const controlRoot = join(runDirectory, "controls", label);
  async function mutation(id, change) {
    const target = join(controlRoot, id, "consumer"); cloneConsumer(consumer, target); await change(target); bind(target, `${label}-${id}`); return target;
  }
  await control("root-negative", async () => {
    const target = await mutation("root-negative", target => {
      const path = join(target, "node_modules/virtual-bash/dist/index.js"), content = read(path).toString(), line = 'export * from "./commands/expr/index.js";';
      assert.equal(content.split(line).length, 2); writeFileSync(path, content.replace(line, ""));
    });
    const result = await execute("root-negative", target); assertChild(result); assert.ok(result.stderr.includes(join(target, "node_modules/virtual-bash/dist/index.js")));
  });
  await control("subpath-negative", async () => {
    const target = await mutation("subpath-negative", target => { const path = join(target, "node_modules/virtual-bash/package.json"), metadata = json(path); delete metadata.exports["./commands/expr"]; writeFileSync(path, JSON.stringify(metadata)); });
    const result = await execute("subpath-negative", target); assertChild(result); assert.ok(result.stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED"));
  });
  await control("subpath-restored", async () => assertChild(await execute("subpath-restored")));
  await control("source-fallback", async () => {
    const target = join(controlRoot, "source-fallback", "consumer"); cloneConsumer(consumer, target);
    const poison = join(controlRoot, "source-fallback", "src", "poison.mjs"); put(poison, 'throw new Error("EXPR_SOURCE_POISON_EXECUTED");\n');
    const sourceURL = pathToFileURL(poison).href, entry = join(target, "node_modules/virtual-bash/dist/index.js");
    writeFileSync(entry, read(entry).toString() + `\nimport ${JSON.stringify(sourceURL)};\n`);
    bind(target, `${label}-source-fallback`, sourceURL);
    const unguarded = await run(`${label}-source-poison-unguarded`, runtime.executable, [join(target, "child.mjs"), "source-poison"], target, timeRemaining());
    assert.equal(unguarded.status, 1); assert.equal(unguarded.naturalSettlement, true); assert.match(childReceipt(unguarded)?.error?.message ?? "", /^EXPR_SOURCE_POISON_EXECUTED$/u);
    const guarded = await execute("source-poison", target);
    assert.equal(guarded.status, 1); assert.equal(guarded.naturalSettlement, true); assert.equal(childReceipt(guarded)?.error?.message, "EXPR_FORBIDDEN_SOURCE"); assert.ok(guarded.stderr.includes(`EXPR_DENY {"specifier":${JSON.stringify(sourceURL)}`)); assert.ok(!guarded.stdout.includes("EXPR_SOURCE_POISON_EXECUTED"));
  });
  await control("worker-negative", async () => {
    assert.ok(ordinaryQualified);
    const target = await mutation("worker-negative", target => unlinkSync(join(target, "node_modules/virtual-bash/dist/commands/regex-execution/matching.js")));
    const result = await execute("worker-negative", target); assertChild(result);
    const worker = childReceipt(result).observer.workers[0]; assert.equal(worker.closed, true); assert.ok(worker.stderr.includes("matching.js")); assert.ok(worker.stderr.includes("EXPR_RESOLVE_ERROR") || worker.stderr.includes("EXPR_UNBOUND_LOAD"));
  });
  await control("worker-restored", async () => assertChild(await execute("worker-restored")));
  const negative = read(join(legacyDirectory, "negative.ts.fixture")).toString();
  const targets = ["positive", "negative", ...Array.from({ length: 6 }, (_, index) => `N0${index + 1}`), "combined", "broken-declaration"];
  for (const id of targets) {
    const row = { id, status: "unrun" }; state.types.push(row);
    try {
      assert.ok(Date.now() - started < 120000, "context deadline before type invocation");
      let target = consumer, filename = id === "positive" || id === "negative" ? `${id}.ts` : `${label}-${id}.ts`;
      if (id.startsWith("N")) put(join(target, filename), negative.replace(new RegExp(`// @ts-expect-error ${id}[^\\n]*`, "u"), ""));
      else if (id === "combined") put(join(target, filename), negative.replace(/\/\/ @ts-expect-error[^\n]*/gu, ""));
      else if (id === "broken-declaration") {
        target = join(controlRoot, id, "consumer"); cloneConsumer(consumer, target); filename = "positive.ts";
        const path = join(target, "node_modules/virtual-bash/dist/commands/expr/index.d.ts"), content = read(path).toString();
        assert.ok(content.includes("ExprCommandsOptions, ExprLimits")); writeFileSync(path, content.replace("ExprCommandsOptions, ExprLimits", "ExprCommandsOptions"));
      }
      const config = { compilerOptions: { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false, types: ["node"], typeRoots: [join(tools, "node_modules/@types")] }, files: [join(target, filename)] };
      const configPath = join(target, `${label}-${id}.json`); putJson(configPath, config);
      const trace = id === "positive" || id === "broken-declaration";
      const result = await run(`${label}-type-${id}`, runtime.executable, ["--permission", `--allow-fs-read=${target}`, `--allow-fs-read=${tools}`, compiler, "-p", configPath, "--pretty", "false", ...(trace ? ["--traceResolution"] : [])], target, timeRemaining());
      row.executed = true; assert.equal(result.naturalSettlement, true);
      const diagnostics = result.stdout.split("\n").filter(line => /error TS\d+/u.test(line)); row.diagnostics = diagnostics;
      assert.ok(!diagnostics.some(line => /TS2307|TS2688/u.test(line)), "missing module/type library does not qualify");
      if (id === "positive" || id === "negative") { assert.equal(result.status, 0); assert.equal(diagnostics.length, 0); }
      else if (id === "broken-declaration") { assert.equal(result.status, 2); assert.ok(diagnostics.some(line => /TS2305.*ExprLimits/u.test(line))); }
      else {
        assert.equal(result.status, 2);
        const expected = [[5, "TS2353"], [7, "TS2353"], [9, "TS2322"], [11, "TS2353"], [13, "TS2322"], [15, "TS2322"]];
        const actual = diagnostics.map(line => { const match = /\((\d+),\d+\): error (TS\d+)/u.exec(line); assert.ok(match); return [Number(match[1]), match[2]]; });
        assert.deepEqual(actual, id === "combined" ? expected : [expected[Number(id.slice(1)) - 1]]);
      }
      if (trace) {
        for (const path of ["dist/index.d.ts", "dist/commands/expr/index.d.ts"]) assert.ok(result.stdout.includes(join(target, "node_modules/virtual-bash", path)));
        assert.ok(!result.stdout.split("\n").some(line => line.includes("successfully resolved") && line.includes("/src/")), "source fallback in compiler trace");
      }
      row.status = "pass";
    } catch (error) { row.status = row.executed ? "fail" : "unrun"; row.error = error.stack; report.failures.push({ name: `${label}-type-${id}`, error: error.message }); console.log(JSON.stringify({ checkpoint: "type-failure", context: label, id, error: error.message.slice(0, 700) })); }
  }
  for (const row of state.cases) {
    if (report.integrityHeld || !ordinaryQualified || state.controls.some(control => control.status !== "pass") || state.types.some(type => type.status !== "pass") || row.id === "R26" && !(heldReleaseQualified && heldWithholdQualified)) { row.reason = "required observer/binding/control qualification failed"; continue; }
    try {
      const result = await execute(row.id); row.executed = true; row.naturalSettlement = result.naturalSettlement;
      const observed = childReceipt(result);
      if (!result.closed || !result.naturalSettlement || !observed?.observer?.workers?.every(worker => worker.closed) || /EXPR_UNBOUND_LOAD|EXPR_HASH_MISMATCH|EXPR_DENY/u.test(result.stderr)) report.integrityHeld = `${label}-${row.id}: closure/binding not established`;
      assert.equal(report.integrityHeld, undefined);
      assertChild(result); row.status = "pass";
      if (["R25", "R26"].includes(row.id)) row.details = childReceipt(result).details;
    } catch (error) { row.status = row.executed ? "fail" : "unrun"; row.error = error.stack; report.failures.push({ name: `${label}-${row.id}`, error: error.message }); console.log(JSON.stringify({ checkpoint: "case-failure", context: label, id: row.id, error: error.message.slice(0, 700) })); }
  }
  assert.ok(check(`${label}-package-post-newentry-mode-hash-guard`, () => assert.deepEqual(inventory(join(consumer, "node_modules/virtual-bash")), packageBefore)), "package integrity failure holds dependents");
  state.durationMs = Date.now() - started;
  console.log(JSON.stringify({ checkpoint: "context-completed", label, counts: Object.fromEntries(["pass", "fail", "unrun"].map(status => [status, state.cases.filter(row => row.status === status).length])), controls: state.controls.map(row => `${row.id}:${row.status}`), types: state.types.map(row => `${row.id}:${row.status}`), durationMs: state.durationMs }));
}

try {
  authenticateOriginal();
  assert.equal(selected.length, 357);
  assert.deepEqual(selected, inputs.selected);
  for (const entry of selected) {
    assert.equal(entry.mode, "100644"); assert.equal(entry.type, "blob"); assert.ok(!entry.path.split("/").includes("AGENTS.md"));
    const bytes = await load(candidate, entry.path); assert.equal(digest(bytes), entry.sha256); put(join(buildDirectory, entry.path), bytes);
  }
  const sourceBefore = selectedView(); save("build-source-before", sourceBefore);
  for (const tool of inputs.toolRoots) copyInventory(tool.source, join(tools, tool.destination), tool.entries);
  for (const tool of inputs.toolRoots.filter(value => value.name !== "npm")) copyInventory(tool.source, join(buildDirectory, tool.destination), tool.entries);
  const toolsBefore = inventory(tools), buildBefore = inventory(buildDirectory); save("tools-before", toolsBefore); save("build-complete-before", buildBefore);
  const build = await run("P01-build", inputs.runtimes[0].executable, ["--permission", `--allow-fs-read=${buildDirectory}`, `--allow-fs-read=${tools}`, `--allow-fs-write=${join(buildDirectory, "dist")}`, compiler, "-p", "tsconfig.build.json"], buildDirectory);
  report.P01 = { status: "fail", buildExecuted: true, buildStatus: build.status, independentInputs: selected.length, exactPackRequired: inputs.package.tarballSha256 };
  let packBytes;
  if (build.status === 0 && build.naturalSettlement) {
    const packDirectory = join(runDirectory, "pack"); mkdirSync(packDirectory);
    const packed = await run("P01-pack", inputs.runtimes[0].executable, [join(tools, "npm/bin/npm-cli.js"), "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", packDirectory], buildDirectory);
    report.P01.packExecuted = true; report.P01.packStatus = packed.status;
    if (packed.status === 0 && packed.naturalSettlement) {
      packBytes = read(join(packDirectory, JSON.parse(packed.stdout)[0].filename));
      report.P01.actualPackSha256 = digest(packBytes); report.P01.packBytes = packBytes.length;
      put(join(rawDirectory, "independent-pack.tgz.base64"), packBytes.toString("base64") + "\n");
      if (digest(packBytes) === inputs.package.tarballSha256) { members(packBytes); report.P01.status = "pass"; }
    }
  }
  save("build-complete-after", inventory(buildDirectory));
  assert.deepEqual(inventory(buildDirectory).filter(row => row.path !== "dist" && !row.path.startsWith("dist/")), buildBefore);
  assert.deepEqual(selectedView(), sourceBefore);
  for (const tool of inputs.toolRoots.filter(value => value.name !== "npm")) assert.deepEqual(inventory(join(buildDirectory, tool.destination)), tool.entries);
  console.log(JSON.stringify({ checkpoint: "P01-build-pack", ...report.P01 }));
  if (report.P01.status !== "pass") {
    report.failures.push({ name: "P01", error: "independent build/exact pack proof failed; authorpack cannot repair P01" });
    packBytes = read(inputs.package.authorTarballLocation); assert.equal(digest(packBytes), inputs.package.tarballSha256);
    report.runtimeArtifact = "separately authenticated authorpack; P01 remains failed";
  } else report.runtimeArtifact = "independently rebuilt exact fullpack";
  assert.equal(packBytes.length, 727526);
  const packMembers = members(packBytes);
  save("runtime-package-members", packMembers.map(({ bytes, ...row }) => ({ ...row, bytes: bytes.length })));
  if (report.P01.status !== "pass") put(join(rawDirectory, "authenticated-authorpack.tgz.base64"), packBytes.toString("base64") + "\n");
  let consumer = join(runDirectory, "installed", "consumer");
  for (const row of packMembers) put(join(consumer, "node_modules/virtual-bash", row.path), row.bytes, row.mode);
  const metadata = json(join(consumer, "node_modules/virtual-bash/package.json"));
  assert.equal(metadata.name, "virtual-bash"); assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.deepEqual(metadata.exports["./commands/expr"], { types: "./dist/commands/expr/index.d.ts", import: "./dist/commands/expr/index.js" });
  stageHarness(consumer); bind(consumer, "installed");
  for (const runtime of inputs.runtimes) await context("installed", runtime, consumer);
  const previous = consumer; consumer = join(runDirectory, "moved package with spaces", "consumer"); mkdirSync(dirname(consumer), { recursive: true }); renameSync(previous, consumer); assert.equal(existsSync(previous), false);
  unlinkSync(join(consumer, "binding.json")); bind(consumer, "moved");
  save("physical-move", { previous, current: consumer, originalAbsent: !existsSync(previous), method: "renameSync whole consumer/package; no source/build access in child flags" });
  for (const runtime of inputs.runtimes) await context("moved", runtime, consumer);
  check("tools-post-newentry-mode-hash-guard", () => assert.deepEqual(inventory(tools), toolsBefore));
  check("selected-source-post-newentry-mode-hash-guard", () => assert.deepEqual(selectedView(), sourceBefore));
  check("complete-build-input-post-newentry-mode-hash-guard", () => assert.deepEqual(inventory(buildDirectory).filter(row => row.path !== "dist" && !row.path.startsWith("dist/")), buildBefore));
} catch (error) { report.failures.push({ name: "runner", error: error.stack }); console.log(JSON.stringify({ checkpoint: "runner-failure", error: error.stack })); }
finally {
  check("original-nine-admission-five-and-tools-readonly-postcheck", authenticateOriginal);
  report.finishedAt = new Date().toISOString();
  report.allProcessChildrenClosed = report.commands.every(command => command.closed);
  report.readerQualification = { status: "qualified", controls: 16, receipt: "ADMISSION.json" };
  const actualRows = report.contexts.flatMap(value => value.cases);
  report.counts = { plannedRuntimeContexts: 4, plannedRuntimeAssertions: 104, executed: actualRows.filter(value => value.executed).length, pass: actualRows.filter(value => value.status === "pass").length, fail: actualRows.filter(value => value.status === "fail").length, unrun: 104 - actualRows.filter(value => value.executed).length,
    controlsExecuted: report.contexts.reduce((total, value) => total + value.controls.length, 0), controlsPass: report.contexts.reduce((total, value) => total + value.controls.filter(row => row.status === "pass").length, 0), typeInvocations: report.contexts.reduce((total, value) => total + value.types.filter(row => row.executed).length, 0), typePass: report.contexts.reduce((total, value) => total + value.types.filter(row => row.status === "pass").length, 0) };
  save("REPORT", report);
  const entries = inventory(rawDirectory).filter(row => row.kind === "file").map(row => ({ ...row, base64: read(join(rawDirectory, row.path)).toString("base64") }));
  const payload = Buffer.from(JSON.stringify({ schema: "expr-independent-raw-v1", entries })); const compressed = gzipSync(payload, { level: 9 });
  put(join(directory, "RAW.json.gz.base64"), compressed.toString("base64") + "\n");
  putJson(join(directory, "REPORT.json"), report);
  putJson(join(directory, "MANIFEST.json"), { schema: "expr-independent-evidence-v3", freezeCommit, inputsSha256: report.inputsSha256, payloadSha256: digest(payload), payloadBytes: payload.length, compressedSha256: digest(compressed), compressedBytes: compressed.length, entries: entries.map(({ base64, ...row }) => row), counts: report.counts, P01: report.P01, holds: report.holds });
  console.log(JSON.stringify({ checkpoint: "evidence-written", counts: report.counts, failures: report.failures.length, manifestSha256: digest(read(join(directory, "MANIFEST.json"))), reportSha256: digest(read(join(directory, "REPORT.json"))) }));
}
