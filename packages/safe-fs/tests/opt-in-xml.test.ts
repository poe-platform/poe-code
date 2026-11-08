import assert from "node:assert/strict";
import { it as test } from "vitest";
import { parseXml, XmlLimitError } from "../src/xml.js";

test("XML defaults admit depth above former cap without enabling other budgets", () => {
  const source = "<x>".repeat(65) + "ok" + "</x>".repeat(65);
  assert.equal(parseXml(source).name, "x");
  assert.equal(parseXml(source, { maxTextLength: 2 }).name, "x");
  assert.throws(() => parseXml(source, { maxDepth: 64 }), XmlLimitError);
});

test("the shared byte collector accepts an unlimited internal budget", async () => {
  const { collectBytes, toByteSource } = await import("../src/contracts/io.js");
  const bytes = await collectBytes(toByteSource("abcd"), { maxBytes: Infinity });
  assert.equal(new TextDecoder().decode(bytes), "abcd");
});
