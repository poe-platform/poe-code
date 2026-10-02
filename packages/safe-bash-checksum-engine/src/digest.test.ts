import assert from "node:assert/strict";
import test from "node:test";
import { createHash, digest } from "./index.js";

test("incremental SHA-256 preserves the reference LLM fragment identity", () => {
  const hash = createHash("sha256");
  try {
    for (const part of ["caf", "é ", "😀"]) hash.update(new TextEncoder().encode(part));
    assert.equal(Buffer.from(hash.digest()).toString("hex"), "043764df773ac7ceea6175e1498893e6ee33e79885288417cc1d75cba6094827");
  } finally {
    hash.destroy();
  }
});

test("streamed BLAKE2b-128 preserves the reference LLM schema identity", async () => {
  const bytes = new TextEncoder().encode('{"x":"' + "\\u00e9".repeat(20000) + '"}');
  const input = (async function* () {
    for (let offset = 0; offset < bytes.length; offset += 997) {
      yield bytes.subarray(offset, offset + 997);
    }
  })();
  assert.deepEqual(await digest(input, "blake2b", new AbortController().signal, undefined, 128), {
    hex: "4c6f10b401febdc3058862abb2c77ffb",
    length: 120008n,
  });
});

test("cancelled streamed digests close their input without consuming later chunks", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel checksum");
  let closed = false;
  let continued = false;
  const input = (async function* () {
    try {
      yield new Uint8Array(65536);
      controller.abort(reason);
      yield new Uint8Array(65536);
      continued = true;
    } finally {
      closed = true;
    }
  })();
  await assert.rejects(digest(input, "blake2b", controller.signal, undefined, 128), error => error === reason);
  assert.equal(closed, true);
  assert.equal(continued, false);
});
