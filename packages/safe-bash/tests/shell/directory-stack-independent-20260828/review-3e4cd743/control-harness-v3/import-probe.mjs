import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const admission = JSON.parse(readFileSync(process.env.DS_ADMISSION));
assert.equal(admission.candidate, "3e4cd743f1d4d2302b6b58a337740b3fde68462a");
process.stdout.write("IMPORT_ATTEMPT\n");
try {
  const api = await import(pathToFileURL(admission.publicEntry).href);
  assert.equal(typeof api.Shell, "function");
  process.stdout.write("IMPORT_PASS\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: "import-rejected", name: error?.name, code: error?.code, message: error?.message }) + "\n");
  process.exitCode = 1;
}
