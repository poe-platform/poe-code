import assert from "node:assert/strict";
import { test } from "node:test";
import { options } from "./internal.js";
test("options retain repeated values and literal operands", () => { const parsed = options(["-aa", "-b", "one", "-b", "two", "--", "-x"], "ab:"); assert.deepEqual([...parsed.flags], ["a", "b"]); assert.deepEqual(parsed.values.get("b"), ["one", "two"]); assert.deepEqual(parsed.operands, ["-x"]); });
