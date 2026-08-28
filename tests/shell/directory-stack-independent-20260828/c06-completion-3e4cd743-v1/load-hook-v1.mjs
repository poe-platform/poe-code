import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkFile } from "./integrity-v1.mjs";
const admission = JSON.parse(readFileSync(process.env.C06_ADMISSION, "utf8"));
assert.equal(admission.candidate, "3e4cd743f1d4d2302b6b58a337740b3fde68462a");
function file(url) { assert(url.startsWith("file:")); const path = fileURLToPath(url); assert(admission.files[path], "foreign module refused: " + path); checkFile(path, admission.files[path]); return path; }
function builtin(url, parentURL) { assert(admission.builtins.includes(url)); if (parentURL?.startsWith("file:") && fileURLToPath(parentURL).startsWith(admission.productRoot + "/")) assert(!["node:child_process", "node:module"].includes(url), "native/require product fallback refused"); }
export async function resolve(specifier, context, nextResolve) { if (specifier.startsWith("node:")) { builtin(specifier, context.parentURL); return nextResolve(specifier, context); } const result = await nextResolve(specifier, context); if (result.url.startsWith("node:")) builtin(result.url, context.parentURL); else { const path = file(result.url); appendFileSync(admission.tracePath, JSON.stringify({ event: "resolve", specifier, parentURL: context.parentURL, path }) + "\n"); } return result; }
export async function load(url, context, nextLoad) { if (url.startsWith("node:")) return nextLoad(url, context); const path = file(url), result = await nextLoad(url, context); checkFile(path, admission.files[path]); appendFileSync(admission.tracePath, JSON.stringify({ event: "load", path, sha256: admission.files[path].sha256 }) + "\n"); return result; }
