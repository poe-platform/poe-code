import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions } from "./options.js";

test("Zstandard accepts automatic and single thread selection", () => {
  for (const args of [["-T0"], ["-T", "0"], ["--threads=0"], ["--threads", "0"], ["-T1"]]) assert.doesNotThrow(() => parseOptions("zstd", args));
  assert.throws(() => parseOptions("zstd", ["-T2"]));
});
