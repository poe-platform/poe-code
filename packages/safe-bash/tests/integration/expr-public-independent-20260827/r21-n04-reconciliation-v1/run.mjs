import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { directory, repository, candidate, read, json, digest, inventory, put, putJson, copyInventory } from "./common.mjs";
import { inputs } from "./auth.mjs";
import { supervise } from "./transport.mjs";
import { qualifyValidator, validateType } from "./validator.mjs";
import { extractResolutions, qualifyResolutions } from "./resolution.mjs";

const harness = ["boundary-child.mjs", "guard-negative.mjs", "guard.mjs", "observer.mjs", "worker-guard.mjs", "silent-worker.mjs", "cases.json"];
const labels = ["installed-node22", "installed-node24", "moved-node22", "moved-node24"];
const declarationSuffixes = ["dist/index.d.ts", "dist/commands/expr/index.d.ts"];
const compilerSuffixes = ["node_modules/typescript/bin/tsc", "node_modules/typescript/lib/_tsc.js"];
const runtimeControls = ["control-valid-public", "control-valid-direct", "control-nul-command-public", "control-nonstring-public"];
const observations = ["observe-public-0", "observe-direct-0", "observe-public-1", "observe-direct-1"];

function members(packBytes) {
  assert.equal(packBytes.length, 727526); assert.equal(digest(packBytes), "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd");
  const tar = gunzipSync(packBytes, { maxOutputLength: 16777216 }), rows = [], names = new Set();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/su, "");
    const prefix = text(345, 155), name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
    assert.ok(name.startsWith("package/")); const path = name.slice(8);
    assert.ok(path && !path.split("/").some(part => ["..", ".", "", "AGENTS.md"].includes(part)));
    assert.ok(!names.has(path)); names.add(path); assert.ok([0, 48].includes(header[156]));
    const size = Number.parseInt(text(124, 12).trim(), 8), mode = Number.parseInt(text(100, 8).trim(), 8) & 0o777;
    assert.equal(header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0), Number.parseInt(text(148, 8).trim(), 8));
    const bytes = Buffer.from(tar.subarray(offset + 512, offset + 512 + size)); assert.equal(bytes.length, size);
    rows.push({ path, bytes, mode, sha256: digest(bytes) }); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(rows.length, 834);
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.path, row.sha256])), inputs.packageFiles);
  return rows;
}
function priorControlSource(row) {
  const declarations = row.declarations.map(value => ({ path: `${row.receipt.cwd}/${value.path}`, sha256: value.sha256 }));
  const tools = row.receipt.bindings.filter(value => compilerSuffixes.some(suffix => value.path.endsWith(suffix)));
  assert.equal(tools.length, 2);
  const spec = { id: row.id, filename: `${row.layout}-${row.id}.ts`, cwd: row.receipt.cwd, args: [...row.receipt.args], executable: row.receipt.executable, executableSha256: row.receipt.executableSha256,
    inputSha256: row.inputSha256, declarations: structuredClone(declarations), tools: structuredClone(tools) };
  const binding = { status: "qualified", consumer: row.receipt.cwd, runtimeSha256: row.receipt.executableSha256, declarations: structuredClone(declarations), tools: structuredClone(tools),
    traceSha256: row.rawBindings.find(value => value.path === `${row.layout}-type-positive.stdout.raw`).sha256, forbiddenResolution: false, naturalSettlement: true };
  assert.equal(row.receipt.stdout, row.stdout); assert.equal(row.receipt.stderr, row.stderr);
  return { receipt: structuredClone(row.receipt), spec, binding };
}

export async function execute(commit, proof) {
  const runDirectory = join(directory, "work/run-001"), rawDirectory = join(runDirectory, "raw"), tools = join(runDirectory, "tools");
  mkdirSync(dirname(runDirectory), { recursive: true }); mkdirSync(runDirectory); mkdirSync(rawDirectory);
  const report = { schema: "expr-r21-n04-result/1", authorizationDate: "2026-08-28", commit, startedAt: new Date().toISOString(), candidate, P01: proof.P01,
    reusedControls: { reader: 16, repair: 28, trace: 38, replayed: 0 }, planned: json(join(directory, "PINS.json")).counts,
    controls: [], observations: [], types: [], children: [], checks: [], failures: [], held: false,
    holds: ["original v5 100/104 runtime and32/40 types unchanged", "R21 original expectation unchanged; observations not rescored", "original accepted-DU gate HELD", "no whole76/fullgate certification", "HTML separately root-accepted; not rerun"], executionDirectory: runDirectory };
  const save = (name, value) => putJson(join(rawDirectory, `${name}.json`), value);
  let consumer, baseline, toolsBaseline;
  const recipeBaseline = json(join(directory, "RECIPE-SEAL.json")).entries;
  function protect(name) {
    try {
      for (const row of recipeBaseline) { assert.equal(digest(read(join(directory, row.path))), row.sha256); assert.equal(lstatSync(join(directory, row.path)).mode & 0o777, row.mode); }
      const allowed = [...recipeBaseline.map(row => row.path), "RECIPE-SEAL.json", ...json(join(directory, "PINS.json")).generated];
      for (const name of readdirSync(directory)) assert.ok(allowed.includes(name), `undeclared recipe entry ${name}`);
      for (const runtime of inputs.runtimes) assert.equal(digest(read(runtime.executable)), runtime.sha256);
      if (consumer && baseline) assert.deepEqual(inventory(consumer), baseline, "consumer hash/mode/new-entry guard");
      if (toolsBaseline) assert.deepEqual(inventory(tools), toolsBaseline, "tool hash/mode/new-entry guard");
      report.checks.push({ name, status: "pass", newEntries: true });
    } catch (error) { report.held = true; report.checks.push({ name, status: "fail", error: error.stack }); throw error; }
  }
  async function run(name, runtime, args, options = {}) {
    assert.equal(report.held, false, "integrity/cleanup failure closes dependent admission");
    protect(`${name}-pre`);
    const receipt = await supervise({ name, executable: runtime.executable, executableSha256: runtime.sha256, args, cwd: consumer, home: runDirectory, rawDirectory, timeout: 15000, ...options });
    report.children.push(receipt);
    protect(`${name}-post`);
    try {
      for (const channel of ["stdout", "stderr"]) {
        const output = receipt.output[channel], bytes = read(output.path);
        assert.equal(bytes.length, output.bytes); assert.equal(digest(bytes), output.sha256);
      }
    } catch (error) { report.held = true; throw error; }
    if (!receipt.closed || !receipt.naturalSettlement || receipt.artifactCompleteness !== "full-observed-child-streams") {
      report.held = true; throw new Error(`child closure/full raw required: ${name}`);
    }
    return receipt;
  }
  function recordFailure(name, error) { report.failures.push({ name, error: error.stack }); }
  async function control(name, action) {
    try { const details = await action(); report.controls.push({ id: name, status: "pass", ...details }); return true; }
    catch (error) { report.controls.push({ id: name, status: "fail", error: error.stack }); recordFailure(name, error); return false; }
  }
  const compiler = join(tools, compilerSuffixes[0]);
  const specFor = (label, id, runtime) => {
    const filename = `${label}-${id}.ts`, config = join(consumer, `${label}-${id}.json`);
    return { id, filename, cwd: consumer, args: ["--permission", `--allow-fs-read=${consumer}`, `--allow-fs-read=${tools}`, compiler, "-p", config, "--pretty", "false"], executable: runtime.executable, executableSha256: runtime.sha256,
      inputSha256: digest(read(join(directory, `${id}.ts.fixture`))), declarations: declarationSuffixes.map(suffix => ({ path: join(consumer, "node_modules/virtual-bash", suffix), sha256: inputs.packageFiles[suffix] })), tools: compilerSuffixes.map(suffix => ({ path: join(tools, suffix), sha256: digest(read(join(tools, suffix))) })) };
  };
  function install(packMembers) {
    consumer = join(runDirectory, "installed/consumer");
    for (const row of packMembers) put(join(consumer, "node_modules/virtual-bash", row.path), row.bytes, row.mode);
    const metadata = json(join(consumer, "node_modules/virtual-bash/package.json"));
    assert.equal(metadata.name, "virtual-bash"); assert.deepEqual(metadata.dependencies ?? {}, {});
    assert.deepEqual(metadata.exports["./commands/expr"], { types: "./dist/commands/expr/index.d.ts", import: "./dist/commands/expr/index.js" });
    for (const name of harness) put(join(consumer, name), read(join(directory, name)));
    putJson(join(consumer, "package.json"), { private: true, type: "module" });
    put(join(consumer, "positive.ts"), read(join(directory, "positive.ts.fixture")));
    for (const label of labels) {
      const target = label.startsWith("installed") ? consumer : join(runDirectory, "moved package with spaces/consumer");
      for (const id of ["N04", "combined", "positive"]) {
        const filename = id === "positive" ? "positive.ts" : `${label}-${id}.ts`;
        if (id !== "positive") put(join(consumer, filename), read(join(directory, `${id}.ts.fixture`)));
        putJson(join(consumer, `${label}-${id}.json`), { compilerOptions: { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false, types: ["node"], typeRoots: [join(tools, "node_modules/@types")] }, files: [join(target, filename)] });
      }
    }
  }
  function bind(phase) {
    const rows = inventory(consumer), expected = Object.fromEntries(rows.filter(row => row.kind === "file" && (row.path.startsWith("node_modules/virtual-bash/") || harness.includes(row.path))).map(row => [join(consumer, row.path), row.sha256]));
    const binding = { candidate, commit, expected, forbiddenSource: pathToFileURL(join(repository, "src/commands/expr/index.ts")).href };
    putJson(join(consumer, "binding.json"), binding); save(`binding-${phase}`, binding);
    baseline = inventory(consumer); save(`consumer-${phase}-before`, baseline);
  }
  function childRecord(receipt, id) {
    try {
    assert.equal(receipt.status, 0, receipt.stderr.slice(-1000));
    const record = JSON.parse(receipt.stdout.trim()); assert.equal(record.id, id);
    const loads = receipt.stderr.split("\n").filter(line => line.startsWith("EXPR_MAIN_LOAD ")).map(line => JSON.parse(line.slice(15)));
    assert.ok(loads.length > 0, "actual module loads required");
    const binding = json(join(consumer, "binding.json"));
    for (const load of loads) assert.equal(load.sha256, binding.expected[load.path]);
    if (id !== "source-fallback-guard") {
      for (const suffix of ["dist/index.js", "dist/commands/expr/index.js", "dist/shell/runtime.js"]) assert.ok(loads.some(row => row.path === join(consumer, "node_modules/virtual-bash", suffix)), suffix);
      if (record.error || !record.cleanupSettled || !record.observer.workers.every(worker => worker.closed) || /EXPR_DENY|EXPR_RESOLVE_ERROR/u.test(receipt.stderr)) { report.held = true; throw new Error("invocation closure/load integrity not established"); }
    }
    return { ...record, actualLoads: loads, receipt: receipt.name };
    } catch (error) { report.held = true; throw error; }
  }
  async function boundaryRun(label, runtime, id) {
    const args = ["--permission", `--allow-fs-read=${consumer}`, `--allow-fs-read=${tools}`, "--allow-worker", "--import", join(consumer, "guard.mjs"), join(consumer, "boundary-child.mjs"), id];
    return childRecord(await run(`${label}-${id}`, runtime, args, { prelaunch: [...harness.map(name => join(consumer, name)), join(consumer, "binding.json")] }), id);
  }
  try {
    const inspection = json(join(directory, "INSPECTION.json"));
    const validatorControls = qualifyValidator(inspection.N04.rows.filter(row => row.layout === "installed-node22").map(priorControlSource), (name, value) => save(`validator-${name}`, value));
    assert.equal(validatorControls.length, 42); report.controls.push(...validatorControls);
    report.controls.push(...qualifyResolutions(inspection.N04.rows[0]));
    save("validator-and-resolution-controls", report.controls);
    for (const tool of inputs.toolRoots.filter(row => row.name !== "npm")) copyInventory(tool.source, join(tools, tool.destination), tool.entries);
    toolsBaseline = inventory(tools); save("tools-before", toolsBaseline);
    const packMembers = members(proof.packBytes); save("package-members", packMembers.map(({ bytes, ...row }) => ({ ...row, bytes: bytes.length })));
    install(packMembers); bind("installed");
    for (const phase of ["installed", "moved"]) {
      if (phase === "moved") {
        protect("before-physical-move");
        const previous = consumer, next = join(runDirectory, "moved package with spaces/consumer");
        mkdirSync(dirname(next), { recursive: true }); renameSync(previous, next); consumer = next;
        assert.equal(existsSync(previous), false); assert.deepEqual(inventory(consumer), baseline);
        save("physical-move", { previous, consumer, originalAbsent: true, method: "renameSync whole consumer, verified unchanged inventory before rebinding" });
        unlinkSync(join(consumer, "binding.json")); baseline = undefined; bind("moved");
      }
      for (const runtime of inputs.runtimes) {
        const label = `${phase}-node${runtime.version.startsWith("v22") ? "22" : "24"}`;
        let boundaryQualified = true;
        for (const id of runtimeControls) {
          const passed = await control(`${label}-${id}`, async () => {
            const record = await boundaryRun(label, runtime, id);
            assert.equal(record.cleanupSettled, true); assert.equal(record.observer.workers.length, 0);
            const valid = id.startsWith("control-valid");
            assert.equal(record.invocations, valid ? 1 : 0);
            assert.equal(record.wrapperInvocations, id.includes("-public") ? 1 : 0);
            assert.deepEqual(record.seenArguments, valid ? [[[55]]] : []);
            const diagnostic = valid ? "" : "shell: line 1: invoke requires a command and literal string arguments without NUL\n";
            assert.deepEqual(record.result, { exitCode: valid ? 0 : 1, stdoutHex: valid ? "370a" : "", stderrHex: Buffer.from(diagnostic).toString("hex"), diagnostic });
            return { record };
          });
          boundaryQualified &&= passed;
          assert.equal(report.held, false);
        }
        const guardQualified = await control(`${label}-source-fallback-guard`, async () => {
          const result = await run(`${label}-source-fallback-guard`, runtime, ["--permission", `--allow-fs-read=${consumer}`, `--allow-fs-read=${tools}`, "--import", join(consumer, "guard.mjs"), join(consumer, "guard-negative.mjs")], { prelaunch: [join(consumer, "guard.mjs"), join(consumer, "guard-negative.mjs"), join(consumer, "binding.json")] });
          assert.match(result.stderr, /EXPR_DENY/u); return { record: childRecord(result, "source-fallback-guard") };
        });
        assert.equal(report.held, false);
        if (boundaryQualified && guardQualified) for (const id of observations) {
          try {
            const record = await boundaryRun(label, runtime, id);
            report.observations.push({ label, ...record, argumentUnitsPreserved: record.seenArguments.every(seen => JSON.stringify(seen) === JSON.stringify(record.inputCodeUnits)) });
            assert.equal(record.status, "observation-not-rescored");
            assert.ok(Number.isInteger(record.result.exitCode));
          } catch (error) { recordFailure(`${label}-${id}`, error); }
          assert.equal(report.held, false);
        }
        let binding;
        const traceQualified = await control(`${label}-fresh-positive-trace-binding`, async () => {
          const config = join(consumer, `${label}-positive.json`);
          const receipt = await run(`${label}-positive-trace-binding`, runtime, ["--permission", `--allow-fs-read=${consumer}`, `--allow-fs-read=${tools}`, compiler, "-p", config, "--pretty", "false", "--traceResolution"], { trace: true, requiredPaths: declarationSuffixes.map(suffix => join(consumer, "node_modules/virtual-bash", suffix)), prelaunch: [compiler, join(tools, compilerSuffixes[1]), config, join(consumer, "positive.ts")] });
          assert.equal(receipt.status, 0); assert.equal(receipt.output.stderr.bytes, 0);
          for (const channel of Object.values(receipt.output)) { assert.equal(channel.analysis.complete, true); assert.equal(channel.analysis.forbiddenResolution, false); assert.deepEqual(channel.analysis.diagnostics, []); }
          assert.ok(receipt.output.stdout.analysis.found.every(Boolean));
          const resolutions = await extractResolutions(receipt.output.stdout.path, consumer);
          const spec = specFor(label, "N04", runtime);
          binding = { status: "qualified", consumer, runtimeSha256: runtime.sha256, declarations: structuredClone(spec.declarations), tools: structuredClone(spec.tools), traceSha256: receipt.output.stdout.sha256, forbiddenResolution: false, naturalSettlement: receipt.naturalSettlement, resolutions, receipt: receipt.name };
          save(`${label}-type-binding`, binding); return { binding };
        });
        assert.equal(report.held, false);
        if (traceQualified && guardQualified) for (const id of ["N04", "combined"]) {
          const row = { label, id, status: "unrun" }; report.types.push(row);
          try {
            const spec = specFor(label, id, runtime); save(`${label}-${id}-spec`, spec);
            const receipt = await run(`${label}-type-${id}`, runtime, spec.args, { prelaunch: [compiler, join(tools, compilerSuffixes[1]), join(consumer, `${label}-${id}.json`), join(consumer, spec.filename)] });
            row.status = "fail"; row.executed = true; row.receipt = receipt.name;
            validateType(receipt, spec, binding); row.status = "pass"; row.diagnostics = receipt.stdout.trimEnd().split("\n");
          } catch (error) { row.error = error.stack; recordFailure(`${label}-${id}`, error); }
          assert.equal(report.held, false);
        }
        console.log(JSON.stringify({ checkpoint: "layout-completed", label, observations: report.observations.filter(row => row.label === label).length, types: report.types.filter(row => row.label === label).map(row => `${row.id}:${row.status}`) }));
      }
    }
  } catch (error) { recordFailure("runner", error); }
  finally {
    try { protect("finally-input-tools-package-newentries"); } catch (error) { recordFailure("final-integrity", error); }
    report.finishedAt = new Date().toISOString();
    report.counts = { observations: report.observations.length, targetExecuted: report.types.filter(row => row.executed).length, targetPass: report.types.filter(row => row.status === "pass").length, targetFail: report.types.filter(row => row.status === "fail").length,
      controlsPass: report.controls.filter(row => row.status === "pass").length, controlsFail: report.controls.filter(row => row.status === "fail").length, children: report.children.length, naturalChildren: report.children.filter(row => row.naturalSettlement).length, forcedChildren: report.children.filter(row => !row.naturalSettlement).length,
      workers: [...report.observations, ...report.controls.map(row => row.record).filter(Boolean)].reduce((total, row) => total + (row.observer?.workers.length ?? 0), 0), checks: report.checks.length };
    report.counts.targetUnrun = 8 - report.counts.targetExecuted;
    report.counts.observationsUnrun = 16 - report.counts.observations;
    report.counts.controlsUnrun = 72 - report.controls.length;
    report.allChildrenClosed = report.children.every(row => row.closed);
    report.status = !report.held && !report.failures.length && report.counts.observations === 16 && report.counts.targetPass === 8 && report.counts.controlsPass === 72 && report.counts.children === 48 && report.counts.forcedChildren === 0 && report.allChildrenClosed ? "TARGETED_QUALIFIED_ORIGINAL_HOLDS_UNCHANGED" : "HELD";
    save("REPORT", report); putJson(join(directory, "REPORT.json"), report);
  }
  return report;
}
