import assert from "node:assert/strict";
import test from "node:test";
import { createXmllintCommand, type XmllintLimits } from "./index.js";

test("XmllintLimits configures the public command factory", () => {
  const limits: Partial<XmllintLimits> = { maxInputBytes: 16 };
  assert.equal(createXmllintCommand({ limits }).name, "xmllint");
});
