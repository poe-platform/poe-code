import { existsSync } from "node:fs";
import { join } from "node:path";
import { directory, putJson, json } from "./common.mjs";
import { authenticate } from "./auth.mjs";
import { execute } from "./run.mjs";
import { archiveRaw } from "./evidence.mjs";

const commit = process.argv[2], errors = [];
process.once("SIGTERM", () => { globalThis.exprStop = "outer stop requested"; errors.push({ message: globalThis.exprStop }); });
let report;
try {
  const proof = authenticate(commit, "PRE");
  console.log(JSON.stringify({ checkpoint: "prebindings-admitted", recipe: commit, P01: proof.P01.status, planned: json(join(directory, "PINS.json")).counts }));
  report = await execute(commit, proof);
} catch (error) { errors.push({ message: error.message, stack: error.stack }); console.log(JSON.stringify({ checkpoint: "entry-held", error: error.stack })); }
finally {
  let status = "pass";
  try { authenticate(commit, "POST"); } catch (error) { status = "fail"; errors.push({ message: error.message, stack: error.stack }); }
  try { await archiveRaw(commit); } catch (error) { status = "fail"; errors.push({ message: error.message, stack: error.stack }); }
  putJson(join(directory, "FINALIZATION.json"), { status, errors, recipeCommit: commit, newEntryChecks: true });
  if (!report && existsSync(join(directory, "REPORT.json"))) report = json(join(directory, "REPORT.json"));
  process.exitCode = status === "pass" && errors.length === 0 && report?.status === "TARGETED_QUALIFIED_ORIGINAL_HOLDS_UNCHANGED" ? 0 : 1;
  console.log(JSON.stringify({ checkpoint: "targeted-entry-closed", exitCode: process.exitCode, counts: report?.counts, errors }));
}
