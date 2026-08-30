import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runPublicCase } from "./public-cases.mjs";
import { gapIds, runGap } from "./gaps.mjs";
import { sha256 } from "./integrity.mjs";

const admission = JSON.parse(readFileSync(process.env.DS_ADMISSION));
assert.equal(admission.candidate, "3e4cd743f1d4d2302b6b58a337740b3fde68462a");
assert.equal(admission.kind, "authorized-product-layout-v1");
assert.equal(sha256(readFileSync(admission.casesPath)), admission.casesSha256);
assert.equal(sha256(readFileSync(admission.inventoryPath)), admission.inventorySha256);
if (admission.layout === "moved") assert(!existsSync(admission.originalConsumer));
const cases = JSON.parse(readFileSync(admission.casesPath)).cases;
const row = cases.find(entry => entry.id === process.argv[2]); assert(row);
process.stdout.write(JSON.stringify({ event: "IMPORT_ATTEMPT", layout: admission.layout }) + "\n");
const api = await import(pathToFileURL(admission.publicEntry).href);
assert.equal(typeof api.Shell, "function");
try {
  const result = gapIds.includes(row.id) ? await runGap(api, row, JSON.parse(readFileSync(admission.inventoryPath))) : await runPublicCase(api, row);
  process.stdout.write(JSON.stringify({ kind: "pass", id: row.id, layout: admission.layout, result }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: error?.name === "AssertionError" ? "assertion-failure" : "harness-failure", id: row.id, layout: admission.layout, error: { name: error?.name, message: error?.message, stack: error?.stack, actual: error?.actual, expected: error?.expected }, observation: error?.observation }, (key, value) => value instanceof Uint8Array ? { base64: Buffer.from(value).toString("base64") } : value) + "\n");
  process.exitCode = 1;
}
