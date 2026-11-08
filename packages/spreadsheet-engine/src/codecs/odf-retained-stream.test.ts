import { expect, it, vi } from "vitest";
import type { ImportedValue } from "@poe-code/spreadsheet-ast";
import { defaultSsconvertLimits } from "../engine.js";
import { createOdfXml, odfNamespaces } from "./odf-write-support.js";

function context(signal = new AbortController().signal, outputBytes = defaultSsconvertLimits.outputBytes) {
  return { signal, limits: { ...defaultSsconvertLimits, outputBytes }, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
}
const node = (name: string, text = "", children: ImportedValue[] = []) => ({ name, namespace: odfNamespaces.text!, text, children });

it("yields retained XML before visiting the complete subtree and bounds escaped text fragments", () => {
  let visited = 0;
  const children = Array.from({ length: 1000 }, () => ({ name: "p", namespace: odfNamespaces.text!,
    get text() { visited++; return "<&🦀".repeat(1000); } }));
  const xml = createOdfXml(context(), true), cursor = xml.retainedFragments(node("section", "", children));
  expect(cursor.next().value).toBe("<text:section");
  expect(visited).toBeLessThan(10);
  let size = 0;
  for (const fragment of cursor) { expect(fragment.length).toBeLessThanOrEqual(16384); size += fragment.length; }
  expect(size).toBeGreaterThan(1000000);
});

it.each([false, true])("preserves mixed content, direct children and extension filtering (extended=%s)", extended => {
  const raw = { ...node("p", "ignored", [node("span", "<&🦀"), { name: "extra", namespace: odfNamespaces.gnm!, text: "extension" }]),
    content: [{ kind: "text", text: "prefix" }, { kind: "element", index: 0 }, { kind: "element", value: node("span", "direct") },
      { kind: "element", index: 1 }, { kind: "text", text: "\r\n\t" }] };
  const expected = '<text:p>prefix<text:span>&lt;&amp;🦀</text:span><text:span>direct</text:span>' +
    (extended ? '<gnm:extra>extension</gnm:extra>' : '') + '&#13;&#10;&#9;</text:p>';
  expect([...createOdfXml(context(), extended).retainedFragments(raw)].join("")).toBe(expected);
  expect(createOdfXml(context(), extended).retained(raw)).toBe(expected);
});

it("preserves hyperlink whitespace and translation without allocating a full whitespace field", () => {
  const raw = { ...node("a", "", [{ ...node("s"), attributes: [{ name: "c", namespace: odfNamespaces.text!, value: "40000" }] }, node("tab"), node("line-break")]),
    attributes: [{ name: "href", namespace: odfNamespaces.xlink!, value: "old" }] };
  const chunks = [...createOdfXml(context(), false).retainedFragments(raw, 0, () => "new")];
  expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThanOrEqual(16384);
  expect(chunks.join("")).toBe('<text:a xlink:href="new">' + ' '.repeat(40000) + '&#9;&#10;</text:a>');
});

it("enforces aggregate UTF-8 bytes and rejects cycles and malformed children", () => {
  const raw = node("p", "é🦀"), size = Buffer.byteLength('<text:p>é🦀</text:p>');
  expect([...createOdfXml(context(undefined, size), false).retainedFragments(raw)].join("")).toBe('<text:p>é🦀</text:p>');
  expect(() => [...createOdfXml(context(undefined, size - 1), false).retainedFragments(raw)]).toThrow("output bytes limit");
  const cyclic = node("p"); cyclic.children.push(cyclic);
  expect(() => [...createOdfXml(context(), false).retainedFragments(cyclic)]).toThrow("cyclic");
  expect(() => [...createOdfXml(context(), false).retainedFragments({ ...raw, content: [{ kind: "element", index: 4 }] })]).toThrow("child index");
});

it("isolates interleaved cursors and releases active ancestry after return or cancellation", () => {
  const controller = new AbortController(), xml = createOdfXml(context(controller.signal), true), raw = node("p", "text");
  const first = xml.retainedFragments(raw), second = xml.retainedFragments(raw);
  expect(first.next().value).toBe("<text:p"); expect(second.next().value).toBe("<text:p");
  first.return(); expect([...second].join("")).toBe(">text</text:p>");
  const third = xml.retainedFragments(raw); third.next(); const reason = new Error("cancel"); controller.abort(reason);
  expect(() => third.next()).toThrow(reason);
});

it("bounds escaped attribute fragments as well as text content", () => {
  const value = '<&🦀'.repeat(20000), raw = { ...node("p"), attributes: [{ name: "title", namespace: "", value }] };
  const xml = createOdfXml(context(), false), chunks = [...xml.retainedFragments(raw)];
  expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThanOrEqual(16384);
  expect(chunks.join("")).toBe('<text:p title="' + '&lt;&amp;🦀'.repeat(20000) + '"/>');
});


it("bounds the validated XML-name cache across distinct retained elements", () => {
  const add = Set.prototype.add;
  const spy = vi.spyOn(Set.prototype, "add").mockImplementation(function(this: Set<unknown>, value) {
    if (typeof value === "string" && value.startsWith("text:unique")) expect(this.size).toBeLessThan(128);
    return add.call(this, value);
  });
  try {
    const xml = createOdfXml(context(), false);
    for (const fragment of xml.retainedFragments(node("section", "", Array.from({ length: 1000 }, (_, index) => node(`unique${index}`)))))
      expect(fragment.length).toBeLessThanOrEqual(16384);
  } finally { spy.mockRestore(); }
});
