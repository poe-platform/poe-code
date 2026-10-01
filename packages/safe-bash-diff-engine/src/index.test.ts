import assert from "node:assert/strict";
import test from "node:test";
import { ToolError } from "./shared.js";
test("diff diagnostics retain the requested exit code", () => {
 const error = new ToolError("invalid patch", 1);
 assert.equal(error.message, "invalid patch");
 assert.equal(error.exitCode, 1);
});
