import { start, finalize } from "./admission.mjs";

const commit = process.argv[2];
try {
  await start(commit);
  console.log(JSON.stringify({ checkpoint: "v3-reader-admission-qualified" }));
  await import("./run.mjs");
} catch (error) {
  process.exitCode = 1;
  console.log(JSON.stringify({ checkpoint: "v3-held", code: error.code, error: error.stack }));
} finally {
  try { await finalize(commit); }
  catch (error) { process.exitCode = 1; console.log(JSON.stringify({ checkpoint: "v3-finalization-failed", error: error.stack })); }
}
