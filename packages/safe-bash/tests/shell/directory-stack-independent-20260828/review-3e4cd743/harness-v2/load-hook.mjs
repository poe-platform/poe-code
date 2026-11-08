import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkBytes, inside } from "./integrity.mjs";

const admission = JSON.parse(readFileSync(process.env.DS_ADMISSION, "utf8"));
assert(["authorized-product-layout-v1", "synthetic-import-fixture-v1"].includes(admission.kind));
if (admission.kind === "synthetic-import-fixture-v1") assert(admission.publicEntry.includes("/executor-preparation-v1/synthetic-work/"), "synthetic mode cannot load product");
function admitted(url) {
  assert(url.startsWith("file:"), `non-file module refused: ${url}`);
  const path = fileURLToPath(url);
  const identity = admission.files[path];
  assert(identity, `unadmitted module: ${path}`);
  checkBytes(path, identity);
  return path;
}
function builtin(url, parentURL) {
  const parent = parentURL?.startsWith("file:") ? fileURLToPath(parentURL) : "";
  if (parent && admission.productRoots.some((root) => inside(root, parent))) assert(!["node:child_process", "node:module"].includes(url), "product native/require fallback refused");
  assert(admission.builtins.includes(url), `unadmitted builtin: ${url}`);
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("node:")) {
    builtin(specifier, context.parentURL);
    return nextResolve(specifier, context);
  }
  const result = await nextResolve(specifier, context);
  if (result.url.startsWith("node:")) { builtin(result.url, context.parentURL); return result; }
  const path = admitted(result.url);
  appendFileSync(admission.tracePath, JSON.stringify({ event: "resolve", specifier, parentURL: context.parentURL ?? null, path }) + "\n");
  return result;
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("node:")) return nextLoad(url, context);
  const path = admitted(url);
  const result = await nextLoad(url, context);
  checkBytes(path, admission.files[path]);
  appendFileSync(admission.tracePath, JSON.stringify({ event: "load", path, sha256: admission.files[path].sha256 }) + "\n");
  return result;
}
