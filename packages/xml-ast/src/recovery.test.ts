import assert from "node:assert/strict";
import { test } from "vitest";
import { parseXml } from "./index.js";
test("opt-in recovery preserves parsed content and reports malformed XML", () => {
  for (const source of ["<root><item>value", "<root><item>value</root>"]) {
    const diagnostics: string[] = [];
    const root = parseXml(source, { recover: message => diagnostics.push(message) });
    assert.equal(root.children[0]?.text, "value");
    assert.ok(diagnostics.length);
    assert.throws(() => parseXml(source), SyntaxError);
  }
  assert.equal(parseXml("<root>a &unknown; b</root>", { recover() {} }).text, "a  b");
});
test("recovery preserves resource and external entity restrictions", () => {
  assert.throws(() => parseXml("<root><item/>", { maxNodes: 1, recover() {} }), /limit/);
  assert.throws(() => parseXml('<!DOCTYPE root SYSTEM "file:///secret"><root/>', { recover() {} }), /forbidden/);
});
