import assert from "node:assert/strict";
import { test } from "node:test";
import { floorDivide } from "./time-env/calendar.js";
test("negative epochs use floor division", () => { assert.equal(floorDivide(-1n, 1000000000n), -1n); assert.equal(floorDivide(1000000001n, 1000000000n), 1n); });
