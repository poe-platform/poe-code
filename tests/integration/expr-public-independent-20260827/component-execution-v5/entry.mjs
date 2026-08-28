import { join } from "node:path";
import { existsSync } from "node:fs";
import { directory, putJson, json } from "./common.mjs";
import { authenticate, inputs } from "./auth.mjs";
import { admit } from "./entry-state.mjs";
import { verdict } from "./verdict.mjs";

const commit = process.argv[2], errors = [];
let proof;
process.once("SIGTERM", () => { globalThis.exprStop = "outer supervisor requested termination"; errors.push({ message: globalThis.exprStop }); });
const optional = name => existsSync(join(directory, name)) ? json(join(directory, name)) : undefined;
try {
  proof = authenticate(commit, "PRE");
  admit({ commit, proof, inputs });
  console.log(JSON.stringify({ checkpoint: "v5-bound-proof-admitted", P01: proof.P01.status, reusedReader: 16, reusedRepair: 28, newControls: 38 }));
  await import("./run.mjs");
} catch (error) { errors.push({ message: error.message, stack: error.stack }); console.log(JSON.stringify({ checkpoint: "v5-entry-held", error: error.stack })); }
finally {
  let finalization;
  try { authenticate(commit, "POST"); finalization = { status: "pass", newEntryChecks: true, predecessorPreserved: true }; }
  catch (error) { errors.push({ message: error.message, stack: error.stack }); finalization = { status: "fail", error: error.stack }; }
  putJson(join(directory, "FINALIZATION.json"), finalization);
  const result = verdict({ report: optional("REPORT.json"), admission: proof?.reader, repair: proof?.repair, traceControls: optional("TRACE-CONTROLS.json"), finalization });
  if (errors.length) { result.status = "HELD"; result.exitCode = 1; result.reasons.push("entry-error"); }
  putJson(join(directory, "VERDICT.json"), { schema: "expr-v5-required-phase-verdict/1", commit, ...result, errors, durableBeforeExit: true });
  console.log(JSON.stringify({ checkpoint: "v5-aggregate-before-exit", ...result }));
  process.exitCode = result.exitCode;
}
