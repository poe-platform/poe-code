import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export { fileHash, inventory, json, sha256 } from "../admission-v2/core.mjs";
export const here = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(here, "../../../..");
export const frozen = resolve(here, "..");
export const candidate = "aff899aa94ed0c57a936b08fd36d185688f5c0bb";
export const freeze = "54f1e4d819e0d3cde422c1f305a84474932e3bac";
export const author = "aa4374b0ab5f0789e51026b7c6fe163c044a9a6c";
export const coreSha = "446c14f2e12753b8933aa307f7ce8b0dec90dd251bbd613e64a484c26397340d";
export const packSha = "d9c1a97388357c5cb0c810cf2fa5181dc7bebff49efe517db414a5833096eed7";
export const bindingPath = resolve(frozen, "admission-v2/binding-04/BINDINGS.json");
export const parse = path => JSON.parse(readFileSync(path));
export function git(args) {
  const result = spawnSync("/usr/bin/git", ["--no-replace-objects", ...args], { cwd: repository, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LC_ALL: "C" }, timeout: 15000, maxBuffer: 16 * 1024 ** 2 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
