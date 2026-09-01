import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import * as fs from "node:fs";
import { nativeGnuBinding, nativeAppleBinding, verifyNativeExecutable, type NativeGnuOptions } from "../../../native-profile.js";

export function withNativeScratch<Value>(operation: (temporary: string) => Value): Value {
  const base = realpathSync(tmpdir());
  if (process.env.FULL_GATE_ROOT) {
    const owned = realpathSync(process.env.FULL_GATE_ROOT);
    assert(base === owned || base.startsWith(owned + sep), "native scratch is outside the admitted gate root");
  }
  const temporary = mkdtempSync(join(base, "safe-bash-patch-scratch-"));
  try { return operation(temporary); }
  finally { rmSync(temporary, { recursive: true }); }
}

export type OracleTool = "diff" | "patch";
export type OracleProfile = "gnu" | "apple-calibration";

export const pins = {
  gnu: {
    diff: { path: "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff", version: "diff (GNU diffutils) 3.12", sha256: "f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9" },
    patch: { path: "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch", version: "GNU patch 2.8", sha256: "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00" },
  },
  "apple-calibration": {
    diff: { path: "/usr/bin/diff", version: "Apple diff (based on FreeBSD diff)", sha256: "214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede" },
    patch: { path: "/usr/bin/patch", version: "patch 2.0-12u11-Apple", sha256: "ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84" },
  },
} as const;

const verified = new Map<string, { path: string; realpath: string; version: string; dialect: string; sha256: string }>();
const qualifiedVerified = new WeakMap<object, typeof verified>();

export function oracleIdentity(tool: OracleTool, profile: OracleProfile = "gnu", options: NativeGnuOptions = {}) {
  const pin = pins[profile][tool];
  const variable = `${profile === "gnu" ? "DIFF_PATCH_NATIVE" : "DIFF_PATCH_APPLE"}_${tool.toUpperCase()}`;
  {
    const override = options.path ?? process.env[variable];
    const bindingOptions = { ...options, ...(override === undefined ? {} : { path: override }) };
    const binding = profile === "gnu" ? nativeGnuBinding(tool, bindingOptions) : nativeAppleBinding(tool, bindingOptions);
    if (binding) {
      const fileSystem = options.fileSystem ?? fs;
      const canonical = fileSystem.realpathSync(binding.path);
      assert.equal(canonical, binding.path, "linked GNU native executable refused");
      const stat = fileSystem.lstatSync(canonical, { bigint: true });
      const key = [profile, tool, canonical, binding.sha256, binding.version, binding.size, stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
      const cache: typeof verified = qualifiedVerified.get(fileSystem) ?? new Map();
      const cached = cache.get(key);
      if (cached) return cached;
      let versionOutput = "";
      const admitted = verifyNativeExecutable(binding, canonical, { ...options, run: (executable, args, settings) => {
        const result = options.run ? options.run(executable, args, settings) : spawnSync(executable, [...args], settings as SpawnSyncOptionsWithStringEncoding);
        versionOutput = result.stdout;
        return result;
      } });
      const identity = { path: admitted.path, realpath: canonical, version: versionOutput.trim(), dialect: profile === "gnu" ? "gnu" : tool === "patch" ? "apple-patch-2.0-12u11" : "bsd", sha256: admitted.sha256 };
      cache.set(key, identity);
      qualifiedVerified.set(fileSystem, cache);
      return identity;
    }
  }
  const path = process.env[variable] ?? pin.path;
  assert(isAbsolute(path), `${variable} must be a nonempty absolute executable path; no fallback is permitted`);
  const canonical = realpathSync(path);
  const stat = statSync(canonical, { bigint: true });
  assert(stat.isFile(), `${variable} must name a regular executable`);
  accessSync(canonical, constants.X_OK);
  const key = [profile, tool, path, canonical, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  const cached = verified.get(key);
  if (cached) return cached;
  const sha256 = createHash("sha256").update(readFileSync(canonical)).digest("hex");
  assert.equal(sha256, pin.sha256, `${variable}: pinned executable SHA-256 mismatch; new builds require independently reviewed proof`);
  const result = withNativeScratch(temporary => spawnSync(canonical, ["--version"], {
    encoding: "utf8", shell: false, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 65_536,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", TMPDIR: temporary },
  }));
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split("\n")[0], pin.version, `${variable}: pinned version mismatch`);
  const identity = { path, realpath: canonical, version: result.stdout.trim(), dialect: profile === "gnu" ? "gnu" : tool === "patch" ? "apple-patch-2.0-12u11" : "bsd", sha256 };
  verified.set(key, identity);
  return identity;
}

export function oraclePath(tool: OracleTool, profile: OracleProfile = "gnu"): string {
  return oracleIdentity(tool, profile).path;
}
