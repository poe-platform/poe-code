import { describe, expect, it } from "vitest";
import { ShapeIdAllocator } from "./shape-id.js";
import { parseXmlPart } from "./xml.js";

const namespace = "http://schemas.openxmlformats.org/presentationml/2006/main";
function drawing(ids: string[], strict = false) {
  const ns = strict ? "http://purl.oclc.org/ooxml/presentationml/main" : namespace;
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:spTree xmlns:p="${ns}" xmlns:x="urn:other"><x:cNvPr id="999"/>${ids.map((id) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}"/></p:nvGrpSpPr></p:grpSp>`).join("")}</p:spTree>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 16 }
  );
}

describe("drawing identity allocation", () => {
  it.each([false, true])("uses maximum nested identity plus one in strict=%s", (strict) => {
    const doc = drawing(["1", "8", "3"], strict);
    const allocator = new ShapeIdAllocator(() => doc);
    expect(allocator.turbo_add_enabled).toBe(false);
    expect(allocator.next()).toBe(9);
    expect(allocator.next()).toBe(9);
  });
  it("starts empty drawings at one and falls back to the first free positive identity", () => {
    expect(new ShapeIdAllocator(() => drawing([])).next()).toBe(1);
    expect(new ShapeIdAllocator(() => drawing(["0", "1", "3", "4294967295"])).next()).toBe(2);
  });
  it("reserves consecutive turbo identities and resets when disabled", () => {
    const doc = drawing(["1", "8"]);
    const allocator = new ShapeIdAllocator(() => doc);
    allocator.turbo_add_enabled = true;
    expect(allocator.turbo_add_enabled).toBe(true);
    expect([allocator.next(), allocator.next()]).toEqual([9, 10]);
    allocator.turbo_add_enabled = false;
    expect(allocator.turbo_add_enabled).toBe(false);
    expect(allocator.next()).toBe(9);
  });
  it("rescans changed owner XML rather than trusting a competing cached handle", () => {
    let doc = drawing(["1"]);
    const first = new ShapeIdAllocator(() => doc);
    const second = new ShapeIdAllocator(() => doc);
    first.turbo_add_enabled = second.turbo_add_enabled = true;
    expect(first.next()).toBe(2);
    doc = drawing(["1", "2", "20"]);
    expect(second.next()).toBe(21);
    expect(first.next()).toBe(21);
    doc = drawing(["1", "2", "20", "21"]);
    expect(first.next()).toBe(22);
  });
  it.each(["", "-1", "1.5", "1e2", " 1", "4294967296", "NaN"])(
    "rejects malformed existing identity %s",
    (id) => {
      expect(() => new ShapeIdAllocator(() => drawing([id])).next()).toThrowError(
        expect.objectContaining({ code: "invalid-opc" })
      );
    }
  );
  it("rejects duplicate numeric identities and does not mutate input", () => {
    const doc = drawing(["1", "01"]);
    const before = doc.bytes();
    expect(() => new ShapeIdAllocator(() => doc).next()).toThrowError(
      expect.objectContaining({ code: "invalid-opc" })
    );
    expect(doc.bytes()).toEqual(before);
  });
  it.each([null, 0, "true", undefined])("rejects nonboolean turbo configuration %s", (value) => {
    const allocator = new ShapeIdAllocator(() => drawing([]));
    expect(() => {
      allocator.turbo_add_enabled = value as unknown as boolean;
    }).toThrowError(expect.objectContaining({ code: "invalid-type" }));
    expect(allocator.turbo_add_enabled).toBe(false);
  });
});

it("keeps turbo reservations across validated appends and rejects foreign nested IDs", () => {
  let doc = drawing(["1", "8"]);
  const allocator = new ShapeIdAllocator(() => doc);
  allocator.turbo_add_enabled = true;
  expect(allocator.next()).toBe(9);
  const added = allocator.append(
    doc.root,
    (id) => `<p:sp xmlns:p="${namespace}"><p:nvSpPr><p:cNvPr id="${id}"/></p:nvSpPr></p:sp>`
  );
  expect(added.id).toBe(10);
  doc = added.xml;
  expect(allocator.next()).toBe(11);
  const before = doc.bytes();
  expect(() =>
    allocator.append(
      doc.root,
      (id) =>
        `<p:grpSp xmlns:p="${namespace}"><p:nvGrpSpPr><p:cNvPr id="${id}"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="8"/></p:nvSpPr></p:sp></p:grpSp>`
    )
  ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
  expect(doc.bytes()).toEqual(before);
});

it.each([
  { ids: [], next: 1 },
  { ids: ["0"], next: 1 },
  { ids: ["1"], next: 2 },
  { ids: ["2"], next: 3 },
  { ids: ["1", "3"], next: 4 }
])("allocates the next positive ID for $ids", ({ ids, next }) => {
  expect(new ShapeIdAllocator(() => drawing(ids)).next()).toBe(next);
});
