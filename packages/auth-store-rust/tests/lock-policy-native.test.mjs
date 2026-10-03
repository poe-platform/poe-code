import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { withSecretStoreFileLock as own } from "./lock-entry.mjs";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { withSecretStoreFileLock: reference } = await tsImport("../../auth-store/src/transaction-lock.ts", import.meta.url);
const native = createRequire(import.meta.url)("../dist/auth-store-rust.node");

test("native claim admission preserves canonical JavaScript PID validation and ignored names", () => {
  const ownName = "123-own.claim";
  const expected = name => {
    if (name === ownName || !name.endsWith(".claim")) return { value: null };
    const prefix = name.slice(0, name.indexOf("-")), pid = Number(prefix);
    return Number.isSafeInteger(pid) && pid >= 1 && String(pid) === prefix
      ? { value: pid }
      : { error: "Malformed secret-store transaction lock owner" };
  };
  const names = [ownName, "ignored", ".claim", "123.claim", "-1-claim.claim"];
  for (const prefix of ["", "0", "00", "01", "1", "1.0", "1e1", "+1", " 1", "1 ", "0x10", "NaN", "Infinity", "9007199254740991", "9007199254740992", "9".repeat(100), "雪", "\ud800", ...Array.from({ length: 256 }, (_, i) => String(i * i))]) {
    for (const suffix of ["peer.claim", ".claim", "雪\ud800.claim", "peer.claim.tmp"]) names.push(`${prefix}-${suffix}`);
  }
  for (const name of names) assert.deepEqual(native.lockOwner(name, ownName), expected(name), name);
});

test("native raw locks preserve timeout errors, abort precedence and callback outcomes", async () => {
  const invalid = new Error("aborted lock");
  for (const timeoutMs of [undefined, null, Infinity, 0, -0, 0.25, 2_147_483_647, -1, NaN, -Infinity, 2_147_483_648, "1", 1n, false, {}, Symbol("timeout")]) {
    for (const aborted of [false, true]) {
      const outcomes = [];
      for (const lock of [reference, own]) {
        const fs = createFsFromVolume(new Volume()).promises;
        let calls = 0;
        try {
          outcomes.push({ result: await lock(fs, "/vault/locks", async () => { calls++; return "callback result"; }, { timeoutMs, signal: aborted ? AbortSignal.abort(invalid) : undefined }), calls });
        } catch (error) {
          outcomes.push({ name: error.name, message: error.message, code: error.code, original: error === invalid, calls });
        }
      }
      assert.deepEqual(outcomes[1], outcomes[0]);
    }
  }
});

test("native lock path admission preserves root handling, symlink diagnostics and callback order", async () => {
  for (const directory of ["/", "/locks", "/var/locks", "/var/tmp/locks", "/vault/雪/../lock", "/vault/\ud800/lock"]) {
    for (const symlink of [false, true]) {
      const outcomes = [];
      for (const lock of [reference, own]) {
        const calls = [], stop = new Error("stop after path admission");
        const fs = {
          lstat: async target => { calls.push(["lstat", target]); return { isSymbolicLink: () => symlink }; },
          mkdir: async (...args) => { calls.push(["mkdir", ...args]); throw stop; }
        };
        let outcome;
        try { await lock(fs, directory, async () => { throw new Error("must not enter"); }); }
        catch (error) { outcome = { name: error.name, message: error.message, original: error === stop }; }
        outcomes.push({ calls, outcome });
      }
      assert.deepEqual(outcomes[1], outcomes[0]);
    }
  }
});
