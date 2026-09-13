import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { applyFieldUpdate, readField, validateFieldOptions } from "./fields.js";
const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
function field(type = "slidenum") {
  return parseXmlPart(
    new TextEncoder().encode(
      `<a:fld xmlns:a="${ns}" id="{00000000-0000-0000-0000-000000000001}" type="${type}" custom="keep"><a:rPr lang="ar-SA"><a:cs typeface="Garden"/></a:rPr><a:pPr rtl="1"/><a:t>古い é 🐚</a:t></a:fld>`
    ),
    { maxBytes: 4096, maxNodes: 100, maxDepth: 20 }
  );
}
it.each(["slide-number", "date", "footer", "header"] as const)(
  "preserves the cached %s value without evaluation",
  (kind) => {
    const xml = field();
    const next = applyFieldUpdate(xml, xml.root, { kind, update: "preserve" });
    expect(readField(next, next.root).cachedText).toBe("古い é 🐚");
    expect(readField(next, next.root).kind).toBe(kind);
    expect(new TextDecoder().decode(next.bytes())).toContain('<a:cs typeface="Garden"/>');
  }
);
it("requires explicit date time and retains supplied mixed-script cache verbatim", () => {
  const xml = field("datetime4");
  expect(() => applyFieldUpdate(xml, xml.root, { update: "explicit", text: "Tomorrow" })).toThrow();
  const next = applyFieldUpdate(xml, xml.root, {
    update: "explicit",
    text: "明日 مرحبًا é 🐚",
    timestamp: new Date("2026-09-13T12:00:00Z")
  });
  expect(readField(next, next.root)).toMatchObject({
    fieldType: "datetime4",
    cachedText: "明日 مرحبًا é 🐚",
    kind: "date"
  });
  expect(new TextDecoder().decode(next.bytes())).toContain('<a:pPr rtl="1"/>');
  expect(new TextDecoder().decode(next.bytes())).not.toContain("2026-");
});
it.each([
  { text: "ignored" },
  { update: "explicit" },
  { update: "preserve", text: "ignored" },
  { update: "explicit", text: "x", timestamp: new Date(NaN) },
  { kind: "unknown" }
])("rejects invalid cached-value policy", (options) => {
  expect(() => validateFieldOptions(options as never, "set")).toThrow();
});
it("preserves unknown field metadata on preserve and rejects evaluating unknown fields", () => {
  const xml = field("vendorValue");
  expect(readField(xml, xml.root).kind).toBeNull();
  expect(applyFieldUpdate(xml, xml.root, { update: "preserve" }).bytes()).toEqual(xml.bytes());
  expect(() => applyFieldUpdate(xml, xml.root, { update: "explicit", text: "x" })).toThrow();
});
it.each(["\u0001", "\ud800", "\udfff", "\ufffe"])(
  "rejects invalid Unicode in caller cache before admission",
  (text) => {
    expect(() => validateFieldOptions({ update: "explicit", text }, "set")).toThrow();
  }
);
it("rejects unknown mutation actions and coercible kinds", () => {
  expect(() =>
    validateFieldOptions({ kind: { toString: () => "footer" } } as never, "set")
  ).toThrow();
  expect(() => validateFieldOptions({}, "replace" as never)).toThrow();
});
