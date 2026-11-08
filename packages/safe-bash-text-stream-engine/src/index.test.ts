import assert from "node:assert/strict";
import { test } from "node:test";
import { settings as format } from "./stream-format/shared.js";
import { settings as inspection } from "./stream-inspection/shared.js";
test("stream families reject invalid byte ceilings", () => { assert.throws(() => format({ limits: { maxInputBytes: -1 } }), RangeError); assert.throws(() => inspection({ limits: { maxInputBytes: -1 } }), RangeError); });
