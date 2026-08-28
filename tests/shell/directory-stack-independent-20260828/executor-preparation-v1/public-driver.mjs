import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkBytes, requireAuthority } from "./integrity.mjs";
import { runPublicCase } from "./public-cases.mjs";
import { authenticateAuthority } from "./executor.mjs";

const admission = JSON.parse(readFileSync(process.env.DS_ADMISSION, "utf8"));
assert.equal(admission.kind, "authorized-product-layout-v1", "synthetic identity is never a product authority");
requireAuthority(admission.authority);
authenticateAuthority(admission.authority, admission.trustedRootCommit);
assert.equal(admission.layout, process.argv[2]);
assert(["source", "installed", "moved"].includes(admission.layout));
if (admission.layout === "moved") assert(!existsSync(admission.originalConsumer), "original consumer must be absent");
checkBytes(admission.publicEntry, admission.files[admission.publicEntry]);
const cases = JSON.parse(readFileSync(new URL("../freeze-v1/cases.json", import.meta.url), "utf8")).cases;
const requested = cases.find((row) => row.id === process.argv[3]);
assert(requested && admission.authority.caseIds.includes(requested.id), "unadmitted row");
const api = await import(pathToFileURL(admission.publicEntry).href);
for (const name of ["Shell", "createMemoryFileSystem", "agentCommands", "FsError", "ShellLimitError"]) assert.equal(typeof api[name], "function", `public API missing: ${name}`);
try {
  const result = await runPublicCase(api, requested);
  process.stdout.write(JSON.stringify({ kind: "pass", ...result, layout: admission.layout }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: error?.name === "AssertionError" ? "assertion-failure" : "harness-failure", id: requested.id, error: { name: error?.name, message: error?.message, stack: error?.stack }, layout: admission.layout }) + "\n");
  process.exitCode = 1;
}
