import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

const binding = JSON.parse(readFileSync(new URL("./binding.json", import.meta.url)));
const expected = binding.expected;
const receipt = (kind, detail) => process.stderr.write(`${kind} ${JSON.stringify(detail)}\n`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === binding.forbiddenSource) { receipt("EXPR_DENY", { specifier, parentURL: context.parentURL }); throw new Error("EXPR_FORBIDDEN_SOURCE"); }
    try { return next(specifier, context); }
    catch (error) { receipt("EXPR_RESOLVE_ERROR", { specifier, parentURL: context.parentURL, code: error.code }); throw error; }
  },
  load(url, context, next) {
    if (!url.startsWith("file:")) return next(url, context);
    const path = fileURLToPath(url);
    if (!expected[path]) { receipt("EXPR_DENY", { path }); throw new Error(`EXPR_UNBOUND_LOAD ${path}`); }
    const result = next(url, context);
    assert.ok(result.source !== null && result.source !== undefined);
    const sha256 = createHash("sha256").update(result.source).digest("hex");
    assert.equal(sha256, expected[path], path);
    receipt(isMainThread ? "EXPR_MAIN_LOAD" : "EXPR_WORKER_LOAD", { path, sha256 });
    return result;
  },
});
