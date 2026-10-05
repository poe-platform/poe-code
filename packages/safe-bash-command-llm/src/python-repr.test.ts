import assert from "node:assert/strict";
import test from "node:test";
import {pythonRepr} from "./python-repr.js";

test("Python tool controls preserve nested values, quoting and printable Unicode", async () => {
  const value = {values: [null, true, false, 1, 0.000001, 1e21], quotes: ["don't", 'both\'"', "line\n\t\\"], unicode: "é😀\u0000\u0085\ud800"};
  let result = "";
  for await (const bytes of pythonRepr(value, new AbortController().signal)) result += new TextDecoder().decode(bytes);
  assert.equal(result, "{'values': [None, True, False, 1, 1e-06, 1e+21], 'quotes': [\"don't\", 'both\\'\"', 'line\\n\\t\\\\'], 'unicode': 'é😀\\x00\\x85\\ud800'}");
});

test("large repr values use bounded chunks and remain cancellable", async () => {
  const controller = new AbortController(); let size = 0;
  await assert.rejects(async () => {
    for await (const bytes of pythonRepr({value: "😀".repeat(10000)}, controller.signal)) {
      assert.ok(bytes.length <= 8192); size += bytes.length;
      if (size > 10000) controller.abort(new Error("stop repr"));
    }
  }, {message: "stop repr"});
  assert.ok(size < 20000);
});
