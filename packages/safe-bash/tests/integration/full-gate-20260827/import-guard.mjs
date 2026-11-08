import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(process.env.FULL_GATE_ROOT);
const allowedTools = JSON.parse(process.env.FULL_GATE_TOOL_ROOTS ?? "[]").map(path => realpathSync(path));
const logs = process.env.FULL_GATE_IMPORTS; mkdirSync(logs, { recursive: true });
const seen = new Set();
const check = url => {
  if (url.startsWith("node:")) return;
  assert.ok(url.startsWith("file:"), `Unsupported module protocol: ${url}`);
  const path = realpathSync(fileURLToPath(url));
  assert.ok(path.startsWith(root + "/") || allowedTools.some(tool => path.startsWith(tool + "/")), `FROZEN_IMPORT_OUTSIDE: ${path}`);
  return path;
};
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context), path = check(result.url);
  if (path && !seen.has(path)) { seen.add(path); appendFileSync(join(logs, process.pid + ".ndjson"), JSON.stringify({ pid: process.pid, resolved: path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }) + "\n"); }
  return result;
} });
