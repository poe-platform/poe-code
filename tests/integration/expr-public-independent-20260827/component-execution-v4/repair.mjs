import assert from "node:assert/strict";
import { mkdirSync, lstatSync, existsSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, legacyDirectory, read, digest, put, putJson, inventory } from "./common.mjs";
import { casesPath, casesSha256, frozenCases } from "./fixture.mjs";
import { aggregateControls, repairControlCount } from "./verdict.mjs";

export function compilerFlags(build, tools, emission, compiler) {
  return ["--permission", `--allow-fs-read=${build}`, `--allow-fs-read=${tools}`, `--allow-fs-write=${emission}`, compiler, "-p", "tsconfig.build.json"];
}
export function createEmission(filename) {
  assert.equal(existsSync(filename), false, "emission directory must be fresh");
  mkdirSync(filename, { mode: 0o755 });
  assert.equal(lstatSync(filename).mode & 0o777, 0o755);
  assert.deepEqual(inventory(filename), []);
}
export async function qualifyRepair({ run, save, inputs, tools, compiler, runDirectory }) {
  const result = { schema: "expr-minimal-repair-controls-v4/1", planned: repairControlCount, pass: 0, status: "running", controls: [] };
  const controlRoot = join(runDirectory, "repair-controls");
  const probe = join(directory, "probe.mjs");
  const parse = value => JSON.parse(value.stdout.trim());
  async function control(id, callback) {
    const row = { id, status: "running" }; result.controls.push(row);
    try { await callback(row); row.status = "pass"; result.pass++; }
    catch (error) { row.status = "fail"; row.error = { message: error.message, stack: error.stack }; throw error; }
    finally { save(`repair-control-${id}`, row); }
  }
  try {
    frozenCases();
    for (const runtime of inputs.runtimes) {
      const version = runtime.version.startsWith("v22") ? "node22" : "node24";
      const base = join(controlRoot, version);
      const source = join(base, "src/canary.ts");
      put(source, "export const permissionCanary = 1;\n");
      put(join(base, "tool-canary.txt"), "owned tool stand-in\n");
      putJson(join(base, "tsconfig.build.json"), { compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", rootDir: "src", outDir: "dist", declaration: true, declarationMap: true, sourceMap: true, types: [], skipLibCheck: true }, files: ["src/canary.ts"] });
      await control(`${version}-permission`, async row => {
        const emission = join(base, "canary-emission"); createEmission(emission);
        const paths = { emission, deniedCanaries: [source, join(base, "outside.txt"), join(base, "tool-canary.txt")], deniedBindings: [casesPath, join(repository, "src/index.ts"), compiler, runtime.executable, join(repository, "package.json"), join(base, "tsconfig.build.json")] };
        const receipt = await run(`repair-${row.id}`, runtime.executable, ["--permission", `--allow-fs-read=${directory}`, `--allow-fs-read=${legacyDirectory}`, `--allow-fs-write=${emission}`, probe, "permission", row.id, JSON.stringify(paths)], base);
        row.receipt = parse(receipt); assert.equal(receipt.status, 0); assert.equal(receipt.naturalSettlement, true); assert.equal(row.receipt.boundaryReached, true); assert.equal(row.receipt.status, "pass");
        assert.equal(read(source).toString(), "export const permissionCanary = 1;\n"); assert.equal(existsSync(join(base, "outside.txt")), false); assert.equal(read(join(base, "tool-canary.txt")).toString(), "owned tool stand-in\n");
      });
      for (const mode of ["wrong-binding", "absent-directory", "positive-emission"]) {
        await control(`${version}-${mode}`, async row => {
          const target = join(base, mode); mkdirSync(target);
          put(join(target, "src/canary.ts"), read(source)); put(join(target, "tsconfig.build.json"), read(join(base, "tsconfig.build.json")));
          const emission = join(target, "dist"), wrong = join(target, "wrong-output");
          if (mode !== "absent-directory") createEmission(emission);
          if (mode === "wrong-binding") createEmission(wrong);
          const before = inventory(target).filter(entry => entry.path !== "dist" && !entry.path.startsWith("dist/"));
          const receipt = await run(`repair-${row.id}`, runtime.executable, compilerFlags(target, tools, mode === "wrong-binding" ? wrong : emission, compiler), target);
          row.boundary = "actual TypeScript compiler emission";
          assert.equal(receipt.naturalSettlement, true);
          const diagnostics = receipt.stdout.split("\n").filter(line => line.includes("error TS")); row.diagnostics = diagnostics;
          if (mode === "positive-emission") {
            assert.equal(receipt.status, 0); assert.equal(diagnostics.length, 0);
            const files = inventory(emission); row.emitted = files;
            assert.deepEqual(files.map(entry => entry.path), ["canary.d.ts", "canary.d.ts.map", "canary.js", "canary.js.map"]);
            for (const suffix of ["d.ts.map", "js.map"]) assert.deepEqual(JSON.parse(read(join(emission, `canary.${suffix}`))).sources, ["../src/canary.ts"]);
          } else {
            assert.equal(receipt.status, 2); assert.equal(diagnostics.length, 4);
            assert.ok(diagnostics.every(line => line.includes("TS5033") && line.includes(emission) && line.includes("restricted")));
            assert.ok(!existsSync(emission) || inventory(emission).length === 0);
          }
          assert.deepEqual(inventory(target).filter(entry => entry.path !== "dist" && !entry.path.startsWith("dist/")), before);
        });
      }
    }
    const malformed = join(controlRoot, "altered-cases.json"); put(malformed, Buffer.concat([read(casesPath), Buffer.from(" \n")]));
    for (const id of ["positive", "missing", "hash-mismatch"]) {
      await control(`cases-${id}`, async row => {
        const filename = id === "positive" ? casesPath : id === "missing" ? join(controlRoot, "missing-cases.json") : malformed;
        const receipt = await run(`repair-${row.id}`, inputs.runtimes[0].executable, ["--permission", `--allow-fs-read=${directory}`, `--allow-fs-read=${legacyDirectory}`, probe, "cases", id, filename], controlRoot);
        row.receipt = parse(receipt); assert.equal(receipt.naturalSettlement, true); assert.equal(row.receipt.boundaryReached, true);
        assert.equal(receipt.status, id === "positive" ? 0 : 1);
        if (id === "missing") assert.equal(row.receipt.error?.code, "ENOENT");
        if (id === "hash-mismatch") assert.ok(row.receipt.error?.message.includes("EXPR_CASES_HASH"));
      });
    }
    for (const id of aggregateControls) {
      await control(`aggregate-${id}`, async row => {
        const receipt = await run(`repair-${row.id}`, inputs.runtimes[0].executable, ["--permission", `--allow-fs-read=${directory}`, probe, "aggregate", id], controlRoot);
        row.receipt = parse(receipt); assert.equal(receipt.naturalSettlement, true); assert.equal(row.receipt.boundaryReached, true); assert.equal(row.receipt.status, "pass");
        assert.equal(receipt.status, id === "positive" ? 0 : 1); assert.equal(row.receipt.verdict.exitCode, receipt.status);
        assert.equal(row.receipt.verdict.reasons.length === 0, id === "positive");
      });
    }
    assert.equal(result.controls.length, repairControlCount); assert.equal(result.pass, repairControlCount);
    assert.equal(digest(read(casesPath)), casesSha256);
    result.status = "qualified";
  } catch (error) { result.status = "HELD"; result.error = { message: error.message, stack: error.stack }; }
  finally { save("repair-controls", result); putJson(join(directory, "REPAIR-CONTROLS.json"), result); }
  return result;
}
