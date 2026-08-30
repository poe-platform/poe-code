import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { requireAuthority } from "./integrity.mjs";
import { authenticateAuthority } from "./executor.mjs";

const admission = JSON.parse(readFileSync(process.env.DS_ADMISSION, "utf8"));
if (admission.kind !== "synthetic-import-fixture-v1") { requireAuthority(admission.authority); authenticateAuthority(admission.authority, admission.trustedRootCommit); }
else assert(admission.publicEntry.includes("/executor-preparation-v1/synthetic-work/"));
process.stdout.write("IMPORT_ATTEMPT\n");
try {
  await import(pathToFileURL(admission.publicEntry).href);
  process.stdout.write(JSON.stringify({ imported: true }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ imported: false, name: error?.name, code: error?.code, message: error?.message }) + "\n");
}
