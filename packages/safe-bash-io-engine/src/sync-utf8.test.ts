import assert from "node:assert/strict";
import { test } from "node:test";
import { evalSyncCat, evalSyncHeadTail, evalSyncTee, evalSyncWc } from "./internal.js";

test("synchronous text commands preserve valid UTF-8 including its BOM", () => {
  const text = "\uFEFF雪\n";
  const input = new TextEncoder().encode(text);
  assert.equal(evalSyncTee(input, []), text);
  assert.equal(evalSyncHeadTail("head", input, []), text);
  assert.equal(evalSyncHeadTail("tail", input, []), text);
  assert.ok(evalSyncCat(input, ["-n"])?.endsWith(text));
  assert.equal(evalSyncWc(input, ["-m"], false)?.trim(), "3");
});

test("synchronous text commands defer invalid or split UTF-8 to the byte executor", () => {
  const invalid = new Uint8Array([0xff, 0x0a]);
  assert.equal(evalSyncTee(invalid, []), undefined);
  assert.equal(evalSyncCat(invalid, ["-n"]), undefined);
  assert.equal(evalSyncHeadTail("head", invalid, []), undefined);
  assert.equal(evalSyncHeadTail("tail", invalid, []), undefined);
  assert.equal(evalSyncWc(invalid, ["-m"], false), undefined);
  const valid = new TextEncoder().encode("雪");
  assert.equal(evalSyncHeadTail("head", valid, ["-c", "1"]), undefined);
  assert.equal(evalSyncHeadTail("tail", valid, ["-c", "1"]), undefined);
});
