import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./index.js";
test("metadata limits are optional", () => { assert.equal(settings().limits.maxDepth, Infinity); assert.equal(settings({ limits: { maxDepth: 2 } }).limits.maxDepth, 2); });
