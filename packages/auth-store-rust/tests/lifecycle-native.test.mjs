import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { withSecretStoreFileLock as own } from "./lock-entry.mjs";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { withSecretStoreFileLock: reference } = await tsImport("../../auth-store/src/transaction-lock.ts", import.meta.url);
const native = createRequire(import.meta.url)("../dist/auth-store-rust.node");

test("native lock lifecycle bounds waits without changing deadline edge behavior", () => {
  assert.equal(typeof native.NativeLockLifecycle, "function");
  for (const deadline of [0, 0.25, 10, Infinity, -Infinity, NaN]) {
    const lifecycle = new native.NativeLockLifecycle(deadline);
    for (const now of [0, 0.125, 1, 10, Infinity, -Infinity, NaN]) {
      const remaining = deadline - now;
      const expected = remaining <= 0
        ? { error: "Timed out waiting for secret-store transaction lock" }
        : { value: Math.min(10, remaining) };
      assert.deepEqual(lifecycle.waitDelay(now), expected);
    }
  }
});

test("public lock lifecycle preserves cleanup ownership, order and opaque failure identity", async () => {
  for (const scenario of ["success", "claim-collision", "claim-partial", "publication-collision", "publication-partial", "rename-failure", "rename-partial", "operation-failure", "cleanup-failure"]) {
    const outcomes = [];
    for (const lock of [reference, own]) {
      const memory = createFsFromVolume(new Volume()).promises;
      const operationFailure = { reason: "original operation" };
      const ioFailure = Object.assign(new Error("original I/O"), { code: scenario.endsWith("collision") ? "EEXIST" : "EIO" });
      const cleanupFailure = new Error("original cleanup");
      const trace = [];
      const role = target => target.endsWith(".tmp") ? "temporary" : "claim";
      let operationCalls = 0;
      const fs = { ...memory,
        writeFile: async (target, value, options) => {
          const artifact = role(target); trace.push(`write:${artifact}`);
          if (scenario === "claim-collision" && artifact === "claim" || scenario === "publication-collision" && artifact === "temporary") {
            await memory.writeFile(target, "another owner's file"); throw ioFailure;
          }
          await memory.writeFile(target, value, options);
          if (scenario === "claim-partial" && artifact === "claim" || scenario === "publication-partial" && artifact === "temporary") throw ioFailure;
        },
        rename: async (...args) => {
          trace.push("rename");
          if (scenario === "rename-failure") throw ioFailure;
          await memory.rename(...args);
          if (scenario === "rename-partial") throw ioFailure;
        },
        unlink: async target => {
          trace.push(`unlink:${role(target)}`);
          if (scenario === "cleanup-failure") throw cleanupFailure;
          return memory.unlink(target);
        }
      };
      const classify = error => error === operationFailure ? "operation" : error === ioFailure ? "io" : error === cleanupFailure ? "cleanup" : { name: error.name, message: error.message };
      let outcome;
      try {
        outcome = { result: await lock(fs, "/vault/lock", async () => {
          operationCalls++; trace.push("operation");
          if (scenario === "operation-failure" || scenario === "cleanup-failure") throw operationFailure;
          return 42;
        }) };
      } catch (error) {
        outcome = error instanceof AggregateError ? { name: error.name, message: error.message, errors: error.errors.map(classify) } : { error: classify(error) };
      }
      const remaining = await Promise.all((await memory.readdir("/vault/lock")).map(async name => [role(name), await memory.readFile(`/vault/lock/${name}`, "utf8")]));
      outcomes.push({ outcome, trace, operationCalls, remaining });
    }
    assert.deepEqual(outcomes[1], outcomes[0], scenario);
  }
});
