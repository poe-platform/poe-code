import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const preseal = JSON.parse(fs.readFileSync(path.join(root, "PREP-PRESEAL.json")));
assert.ok(Date.now() < Date.parse(preseal.deadline));
for (const row of preseal.inputs) {
  const filename = path.join(root, row.path), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"), row.sha256);
}
const { runControls } = await import("./staged/new/controls.mjs");
const { classifyTypes, classifyCases, classifyMutant, classifyRestore } = await import("./staged/new/classify.mjs");
const recipe = JSON.parse(fs.readFileSync(path.join(root, "staged/metadata/RECIPE.json")));
const work = process.argv[2];
assert.equal(work, "/private/tmp/safe-bash-b2-r6-harmless-controls");
fs.mkdirSync(work, { mode: 0o700 });
const harmless = await runControls({ work, recipe });
const natural = { exitCode: 0, exitSignal: null, exited: true, closed: true, signalCount: 0 };
const positive = [{ id: "fixture", pass: true, cleanupFailure: false }, { summary: { cases: 1, pass: 1 } }];
const results = [];
function rejected(name, action) { assert.throws(action); results.push({ name, rejected: true }); }
classifyCases(natural, positive, ["fixture"]);
results.push({ name: "explicit-false-cleanup-count", accepted: true });
for (const reason of [false, 0, null, ""]) rejected(`cleanupError-presence-${JSON.stringify(reason)}`, () => classifyCases(natural, [{ ...positive[0], cleanupError: reason }, positive[1]], ["fixture"]));
rejected("no-close", () => classifyCases({ ...natural, closed: false }, positive, ["fixture"]));
rejected("signalled", () => classifyCases({ ...natural, signalCount: 1 }, positive, ["fixture"]));
const filename = path.join(work, "bad.mts");
const text = recipe.expectedDiagnostics.map(row => `${filename}(${row.line},${row.column}): error TS${row.code}: ${row.message}`).join("\n");
rejected("type-zero-not-negative-credit", () => classifyTypes(natural, text, filename, recipe.expectedDiagnostics, true));
rejected("type-wrong-origin", () => classifyTypes({ ...natural, exitCode: 2 }, text, filename + "x", recipe.expectedDiagnostics, true));
const mutation = recipe.mutations[0], failure = recipe.mutantFailures[mutation.id];
const output = [{ id: mutation.case, pass: false, error: failure }, { summary: { cases: 1, fail: 1 } }];
rejected("mutant-no-loaded-proof", () => classifyMutant({ ...natural, exitCode: 1 }, output, [], mutation, failure));
rejected("restore-no-loaded-proof", () => classifyRestore(natural, [{ id: mutation.case, pass: true }, { summary: { cases: 1, pass: 1 } }], [], mutation));
const report = { status: "PURE_AND_HARMLESS_CONTROLS_PASS", harmless, independentPredicates: results, actualCompiler: 0, productImports: 0, actualWorkers: 0, qualification: "Four real harmless Node children only; fabricated diagnostic and trace data are not actual compiler or loaded product mutation proof" };
fs.writeFileSync(path.join(root, "CONTROLS.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ status: report.status, children: 4, independentPredicates: results.length }));
