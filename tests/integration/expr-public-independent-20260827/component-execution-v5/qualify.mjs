import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, put, putJson, digest, read } from "./common.mjs";
import { limits, traceVerdict } from "./transport.mjs";
import { aggregateControls, newControlCount } from "./verdict.mjs";

export async function qualify({ run, save, inputs, tools, compiler, runDirectory }) {
  const results = [];
  async function control(id, callback) {
    const row = { id, status: "unrun", executed: false, productType: false };
    try { await callback(row); row.status = "pass"; }
    catch (error) { row.status = row.executed ? "fail" : "unrun"; row.error = error.stack; }
    save(`qualification-${id}`, row); results.push(row);
    console.log(JSON.stringify({ checkpoint: "v5-qualification", id, status: row.status, error: row.error?.slice(0, 500) }));
  }
  for (const runtime of inputs.runtimes) {
    const label = runtime.version.startsWith("v22") ? "node22" : "node24";
    for (const id of ["compiler-positive", "compiler-late-error", "compiler-forbidden", "overflow", "nonzero", "line-overflow", "diagnostic-overflow", "ordinary-cap"]) {
      await control(`${label}-${id}`, async row => {
        const target = join(runDirectory, "qualification", `${label}-${id}`), filename = join(target, "fixture.ts"), configPath = join(target, "tsconfig.json");
        const fixture = id === "compiler-late-error" ? 'export const value: string = 1;\n' : id === "compiler-forbidden" ? 'import { value } from "./src/forbidden.js"; export { value };\n' : 'export const value: string = "ok";\n';
        put(filename, fixture);
        if (id === "compiler-forbidden") put(join(target, "src/forbidden.ts"), 'export const value: string = "owned controlled source";\n');
        putJson(configPath, { compilerOptions: { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false, types: ["node"], typeRoots: [join(tools, "node_modules/@types")] }, files: [filename] });
        const producer = join(directory, "producer.mjs"), before = digest(read(filename));
        const result = await run(`qualification-${label}-${id}-child`, runtime.executable, ["--permission", `--allow-fs-read=${target}`, `--allow-fs-read=${tools}`, `--allow-fs-read=${producer}`, producer, id, compiler, configPath], target, 15000,
          { trace: id !== "ordinary-cap", prelaunch: [producer, compiler, filename, configPath], qualificationControl: true });
        row.executed = true; row.receipt = result.name; row.result = { status: result.status, closed: result.closed, supervision: result.supervision, naturalSettlement: result.naturalSettlement, capturedBytes: result.capturedBytes, observedBytes: result.observedBytes, previewBytes: result.previewBytes, output: result.output, traceVerdict: id === "ordinary-cap" ? undefined : traceVerdict(result) };
        assert.equal(digest(read(filename)), before); assert.equal(result.closed, true); assert.equal(result.durableBeforeAssertions, true);
        if (["overflow", "line-overflow", "diagnostic-overflow", "ordinary-cap"].includes(id)) {
          const reasons = { overflow: "trace-artifact-ceiling-64MiB", "line-overflow": "trace-incomplete-line-overflow", "diagnostic-overflow": "trace-diagnostic-retention-overflow", "ordinary-cap": "combined-output-cap-1MiB" };
          assert.equal(result.supervision, reasons[id]); assert.equal(result.signal, "SIGKILL"); assert.equal(result.naturalSettlement, false);
          if (id === "overflow") { assert.equal(result.capturedBytes, limits.trace); assert.equal(result.artifactCompleteness, "captured-prefix-truncated"); assert.ok(result.observedBytes > limits.trace); }
          if (id === "ordinary-cap") assert.equal(result.capturedBytes, limits.preview);
          result.commandSummary.expectedSupervision = true;
        } else {
          assert.equal(result.naturalSettlement, true); assert.equal(result.artifactCompleteness, "full-observed-child-streams"); assert.ok(result.capturedBytes > limits.preview); assert.equal(result.previewBytes, limits.preview);
          assert.ok(result.output.stderr.bytes > 0); assert.ok(!result.stdout.includes("error TS")); assert.ok(!result.stdout.includes("successfully resolved"));
          const expected = { "compiler-positive": [0, "pass"], "compiler-late-error": [2, "type-diagnostics"], "compiler-forbidden": [0, "forbidden-resolution"], nonzero: [7, "nonzero-child"] };
          assert.equal(result.status, expected[id][0]); assert.equal(traceVerdict(result), expected[id][1]);
          if (id === "compiler-late-error") assert.deepEqual(result.output.stdout.analysis.diagnostics.map(line => /\((\d+),\d+\): error (TS\d+)/u.exec(line)?.slice(1)), [["1", "TS2322"]]);
        }
      });
    }
  }
  for (const id of aggregateControls) await control(`aggregate-${id}`, async row => {
    const probe = join(directory, "aggregate-probe.mjs"), result = await run(`qualification-aggregate-${id}-child`, inputs.runtimes[0].executable, ["--permission", `--allow-fs-read=${directory}`, probe, id], directory, 15000, { prelaunch: [probe, join(directory, "verdict.mjs")], qualificationControl: true });
    row.executed = true; row.receipt = result.name; assert.equal(result.closed, true); assert.equal(result.naturalSettlement, true);
    const payload = JSON.parse(result.stdout); row.payload = payload;
    assert.equal(result.status, id === "positive" ? 0 : 1); assert.equal(payload.result.exitCode, result.status); assert.equal(payload.result.status, id === "positive" ? "PASS component-only" : "HELD");
  });
  const pass = results.filter(row => row.status === "pass").length;
  const qualification = { status: pass === newControlCount && results.length === newControlCount ? "qualified" : "HELD", planned: newControlCount, pass, fail: results.filter(row => row.status === "fail").length, unrun: results.filter(row => !row.executed).length, rows: results, productTypes: 0 };
  putJson(join(directory, "TRACE-CONTROLS.json"), qualification);
  return qualification;
}
