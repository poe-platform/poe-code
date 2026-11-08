import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { withSecretStoreFileLock as nativeLock } from "./lock-entry.mjs";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { withSecretStoreFileLock: referenceLock } = await tsImport("../../auth-store/src/transaction-lock.ts", import.meta.url);
const native = createRequire(import.meta.url)("../dist/auth-store-rust.node");

const referenceTicket = value => {
  let ticket = null;
  try {
    if (value !== null && typeof value === "object" && "ticket" in value &&
        typeof value.ticket === "number" && Number.isSafeInteger(value.ticket) && value.ticket > 0)
      ticket = value.ticket;
  } catch { /* A malformed live claim remains in the choosing phase. */ }
  return ticket;
};
const nativeTicket = value => {
  try {
    return native.lockClaimTicket(value, candidate => {
      try { return candidate > 0; }
      catch { return false; }
    });
  } catch { return null; }
};

test("native claim admission matches live ticket types and safe integer boundaries", () => {
  assert.equal(typeof native.lockClaimTicket, "function");
  const values = [null, undefined, true, 1, "claim", {}, [], () => {}];
  for (const ticket of [null, undefined, 0, -0, -1, 0.5, 1, 2, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1", true, 1n, Symbol("ticket"), {}]) {
    values.push({ ticket }, Object.create({ ticket }), Object.assign([], { ticket }));
  }
  for (const value of values) assert.equal(nativeTicket(value), referenceTicket(value));
});

test("native claim admission preserves inherited getters, traps and changing reads", () => {
  const cycle = {}; cycle.self = cycle;
  const finalValues = [undefined, null, false, 1n, Symbol("accepted"), () => {}, cycle];
  for (const sequence of [[1, 1, 1, "last read"], ...finalValues.map(value => [1, 1, 1, value]), [1, -Number.MAX_SAFE_INTEGER, 1, "changed"], [1, -Number.MAX_SAFE_INTEGER - 1], [1, NaN], [1, "1"], [1, 1, 0], [1, 1, 1n, 3], ["1"], [1, 1, { valueOf: () => 1 }, 9]]) {
    const outcomes = [];
    for (const admit of [referenceTicket, nativeTicket]) {
      let reads = 0;
      const trace = [];
      const source = Object.create({ get ticket() { trace.push("get"); return sequence[reads++]; } });
      const value = new Proxy(source, { has(target, key) { trace.push(`has:${String(key)}`); return Reflect.has(target, key); } });
      outcomes.push({ ticket: admit(value), trace });
    }
    assert.deepEqual(outcomes[1], outcomes[0]);
    assert.equal(outcomes[1].ticket, outcomes[0].ticket);
  }
});

test("native claim admission does not stringify failures or read past a rejected field", () => {
  let stringifications = 0;
  const failure = { toString() { stringifications++; throw new Error("must not stringify"); } };
  for (const point of ["has", 1, 2, 3, 4, "positive"]) {
    const outcomes = [];
    for (const admit of [referenceTicket, nativeTicket]) {
      const trace = [];
      let reads = 0;
      const value = new Proxy({ get ticket() {
        trace.push(++reads);
        if (point === reads) throw failure;
        if (point === "positive" && reads === 3) return { valueOf() { trace.push("positive"); throw failure; } };
        return 1;
      } }, { has(target, key) { trace.push("has"); if (point === "has") throw failure; return Reflect.has(target, key); } });
      outcomes.push({ ticket: admit(value), trace });
    }
    assert.deepEqual(outcomes[1], outcomes[0]);
  }
  assert.equal(stringifications, 0);
});

test("public lock acquisition preserves claim JSON handling and selected publication tickets", async () => {
  for (const raw of ["", "{", "null", "[]", "{}", '{"ticket":null}', '{"ticket":"2"}', '{"ticket":0}', '{"ticket":0.5}', '{"ticket":2}', '{"ticket":9007199254740991}', '{"ticket":2,"ticket":4}', '{"ticket":1e400}']) {
    const outcomes = [];
    for (const lock of [referenceLock, nativeLock]) {
      const memory = createFsFromVolume(new Volume()).promises;
      const peer = `${process.pid}-peer.claim`;
      await memory.mkdir("/vault/lock", { recursive: true });
      await memory.writeFile(`/vault/lock/${peer}`, raw);
      let scans = 0, operationCalls = 0;
      const publications = [];
      const fs = { ...memory,
        readdir: async directory => {
          const names = await memory.readdir(directory);
          return ++scans > 1 ? names.filter(name => name !== peer) : names;
        },
        writeFile: async (target, value, options) => {
          if (target.endsWith(".tmp")) publications.push(value);
          return memory.writeFile(target, value, options);
        }
      };
      let outcome;
      try { outcome = { result: await lock(fs, "/vault/lock", async () => { operationCalls++; return 42; }, { timeoutMs: 0 }) }; }
      catch (error) { outcome = { error: error.message, code: error.code }; }
      outcomes.push({ outcome, publications, operationCalls, remaining: await memory.readdir("/vault/lock") });
    }
    assert.deepEqual(outcomes[1], outcomes[0], raw);
  }
});
