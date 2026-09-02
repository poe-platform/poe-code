import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

test("escaped separators survive byte-chunk boundaries", async () => {
  const { shell } = setup();
  const bytes = new TextEncoder().encode("é\\ é\\\n rest\ntail");
  const stdin = { async *[Symbol.asyncIterator]() { for (const byte of bytes) yield new Uint8Array([byte]); } };
  assert.equal((await shell.exec('read first second; args "$first" "$second"; pass', { stdin })).stdout, '["é é","rest"]tail');
});
