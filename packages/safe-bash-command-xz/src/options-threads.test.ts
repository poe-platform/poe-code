import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions } from "./options.js";

test("XZ accepts automatic and single thread selection", () => {
  for (const args of [["-T0"], ["-T", "0"], ["--threads=0"], ["--threads", "0"], ["-T1"]]) assert.doesNotThrow(() => parseOptions("xz", args));
  assert.throws(() => parseOptions("xz", ["-T2"]));
});
