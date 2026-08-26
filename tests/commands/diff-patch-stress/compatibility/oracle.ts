import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

export type OracleTool = "diff" | "patch";

export function oraclePath(tool: OracleTool): string {
  const variable = `DIFF_PATCH_NATIVE_${tool.toUpperCase()}`;
  const path = process.env[variable] ?? `/usr/bin/${tool}`;
  assert(isAbsolute(path), `${variable} must be a nonempty absolute executable path; no fallback is permitted`);
  return path;
}

export function oracleIdentity(tool: OracleTool) {
  const path = oraclePath(tool);
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8", timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" },
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const version = `${result.stdout}${result.stderr}`.trim();
  const dialect = /GNU/u.test(version) ? "gnu"
    : tool === "patch" && version.split("\n")[0] === "patch 2.0-12u11-Apple" ? "apple-patch-2.0-12u11"
    : /Apple|FreeBSD|BSD/u.test(version) ? "bsd" : "other";
  return { path, realpath: realpathSync(path), version, dialect, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}
