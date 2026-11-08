import { join } from "node:path";
import { existsSync } from "node:fs";
import { directory, putJson, json } from "./common.mjs";
import { start, finalize } from "./admission.mjs";
import { verdict } from "./verdict.mjs";

const commit = process.argv[2], errors = [];
process.once("SIGTERM", () => {
  globalThis.exprStop = "outer supervisor requested termination";
  errors.push({ message: globalThis.exprStop });
});
const optional = name => existsSync(join(directory, name)) ? json(join(directory, name)) : undefined;
try {
  await start(commit);
  console.log(JSON.stringify({ checkpoint: "v4-reader-reuse-authenticated-new-inputs-admitted", previousControls: 16, newReaderControls: 0 }));
  await import("./run.mjs");
} catch (error) {
  errors.push({ code: error.code, message: error.message, stack: error.stack });
  console.log(JSON.stringify({ checkpoint: "v4-entry-held", error: error.stack }));
} finally {
  try { await finalize(commit); }
  catch (error) {
    errors.push({ code: error.code, message: error.message, stack: error.stack });
    if (!existsSync(join(directory, "FINALIZATION.json"))) putJson(join(directory, "FINALIZATION.json"), { status: "fail", error: error.stack });
  }
  const outcome = verdict({ report: optional("REPORT.json"), admission: optional("ADMISSION.json"), repair: optional("REPAIR-CONTROLS.json"), finalization: optional("FINALIZATION.json") });
  if (errors.length) { outcome.status = "HELD"; outcome.exitCode = 1; outcome.reasons.push("entry-error"); }
  putJson(join(directory, "VERDICT.json"), { schema: "expr-v4-required-phase-verdict/1", commit, ...outcome, errors, beforeProcessExit: true });
  console.log(JSON.stringify({ checkpoint: "v4-aggregate-verdict-before-exit", ...outcome }));
  process.exitCode = outcome.exitCode;
}
