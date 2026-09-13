import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Presentation } from "./presentation-model.js";
import { Inches } from "./length.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const xmlLimits = { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 };

it("exposes owned part and package views without read side effects", async () => {
  const deck = await Presentation();
  const before = await deck.save();
  const part = deck.part;
  expect(part).toBe(deck.part);
  expect(part.partname).toBe("/ppt/presentation.xml");
  expect(part.content_type).toBe(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
  );
  expect(part.package.get_part(part.partname)).toBe(part);
  expect(part.package.get_part("/absent.xml")).toBeNull();
  expect(part.package.parts).toContain(part);
  expect(Object.isFrozen(part.package.parts)).toBe(true);
  expect(part.rels.some((edge) => edge.type.endsWith("/slideMaster"))).toBe(true);
  expect(Object.isFrozen(part.rels)).toBe(true);
  expect(Object.isFrozen(part.rels[0])).toBe(true);
  expect(part.package.parts.some((p) => p.partname.includes(".rels"))).toBe(false);
  expect(part.package.parts.some((p) => p.partname === "/[Content_Types].xml")).toBe(false);
  expect(await deck.save()).toEqual(before);
});

it("reads current model bytes and owns both sides of bounded blob replacement", async () => {
  const deck = await Presentation();
  const part = deck.part;
  deck.slide_width = new Inches(12);
  let doc = parseXmlPart(part.blob, xmlLimits);
  const size = doc.root.children.find((n) => n.name.localName === "sldSz")!;
  expect(size.attributes.find((a) => a.name.localName === "cx")?.value).toBe("10972800");
  doc = doc.merge(size, { attributes: [{ namespace: "", localName: "cx", value: "10058400" }] });
  const bytes = doc.bytes();
  part.blob = bytes;
  bytes.fill(0);
  expect(deck.slide_width?.inches).toBe(11);
  const read = part.blob;
  read.fill(0);
  expect((await Presentation(await deck.save())).slide_width?.inches).toBe(11);
});

it("rejects malformed, graph-breaking, structural and unsupported blob writes atomically", async () => {
  const deck = await Presentation();
  const before = deck.part.blob;
  expect(() => {
    deck.part.blob = "xml" as never;
  }).toThrowError(expect.objectContaining({ code: "invalid-type" }));
  expect(() => {
    deck.part.blob = new TextEncoder().encode("<broken>");
  }).toThrow();
  const doc = parseXmlPart(before, xmlLimits);
  const size = doc.root.children.find((n) => n.name.localName === "sldSz")!;
  const invalid = doc.merge(size, { attributes: [{ namespace: "", localName: "cx", value: "0" }] });
  expect(() => {
    deck.part.blob = invalid.bytes();
  }).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
  expect(() => {
    deck.part.blob = doc.spliceChildren(doc.root, 0, 1, []).bytes();
  }).toThrow();
  const properties = deck.part.package.get_part("/docProps/core.xml")!;
  const propertyBytes = properties.blob;
  expect(() => {
    properties.blob = propertyBytes;
  }).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  expect(deck.part.blob).toEqual(before);
});

it("enforces canonical lookup, byte limits, cancellation and stale publication", async () => {
  const controller = new AbortController();
  const deck = await Presentation(undefined, { signal: controller.signal });
  for (const name of ["../private", "/../private", "file:///private", 1, null])
    expect(() => deck.part.package.get_part(name as never)).toThrow();
  expect(() => {
    deck.part.blob = new Uint8Array(8_388_609);
  }).toThrowError(expect.objectContaining({ code: "resource-limit" }));
  const sink = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const saving = deck.save(sink);
  const doc = parseXmlPart(deck.part.blob, xmlLimits);
  deck.part.blob = doc
    .merge(doc.root, { attributes: [{ namespace: "", localName: "saveSubsetFonts", value: "1" }] })
    .bytes();
  await expect(saving).rejects.toMatchObject({ code: "stale-selection" });
  expect(sink.write).not.toHaveBeenCalled();
  controller.abort();
  expect(() => deck.part.blob).toThrowError(expect.objectContaining({ code: "cancelled" }));
});

it("keeps owner state and authority inaccessible to JavaScript consumers", async () => {
  const deck = await Presentation();
  expect(Object.keys(deck)).toEqual([]);
  for (const key of ["state", "context", "inputPath"])
    expect((deck as unknown as Record<string, unknown>)[key]).toBeUndefined();
  expect(() => {
    (deck as unknown as { part: unknown }).part = {};
  }).toThrow();
});

it("binds XML reads and attribute edits to the live presentation owner", async () => {
  const deck = await Presentation();
  const root = deck.element;
  expect(root.tag.localName).toBe("presentation");
  expect(root).toBe(deck.element);
  expect(root).toBe(deck.part.element);
  expect(root.get({ namespace: "", localName: "missing" })).toBeNull();
  root.set({ namespace: "", localName: "saveSubsetFonts" }, "1");
  expect(deck.element.get({ namespace: "", localName: "saveSubsetFonts" })).toBe("1");
  const size = deck.element.children.find((node) => node.tag.localName === "sldSz")!;
  size.set({ namespace: "", localName: "cx" }, "10058400");
  expect(deck.slide_width?.inches).toBe(11);
  expect(() => root.tag).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  const stale = deck.element;
  deck.slide_width = new Inches(12);
  expect(() => stale.children).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  expect(
    deck.element.children
      .find((node) => node.tag.localName === "sldSz")
      ?.get({ namespace: "", localName: "cx" })
  ).toBe("10972800");
  expect(
    (await Presentation(await deck.save())).element.get({
      namespace: "",
      localName: "saveSubsetFonts"
    })
  ).toBe("1");
});

it("rejects graph-breaking XML writes without changing or invalidating the current view", async () => {
  const deck = await Presentation();
  const size = deck.element.children.find((node) => node.tag.localName === "sldSz")!;
  expect(() => size.set({ namespace: "", localName: "cx" }, "0")).toThrowError(
    expect.objectContaining({ code: "invalid-opc" })
  );
  expect(size.get({ namespace: "", localName: "cx" })).toBe("9144000");
  const sink = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const saving = deck.save(sink);
  size.set({ namespace: "", localName: "cx" }, "10058400");
  await expect(saving).rejects.toMatchObject({ code: "stale-selection" });
  expect(sink.write).not.toHaveBeenCalled();
});

it.each(["0", "914399", "51206401", "NaN", "1.5", "-1", "", "9007199254740992"])(
  "rejects invalid authored slide dimensions %s before committing",
  async (value) => {
    const deck = await Presentation();
    const before = deck.part.blob;
    const document = parseXmlPart(before, xmlLimits);
    const size = document.root.children.find((node) => node.name.localName === "sldSz")!;
    const bytes = document
      .merge(size, { attributes: [{ namespace: "", localName: "cx", value }] })
      .bytes();
    expect(() => {
      deck.part.blob = bytes;
    }).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
    expect(deck.part.blob).toEqual(before);
  }
);

it("reads binary parts and external relationship metadata without activation", async () => {
  const original = await (await Presentation()).save();
  const binary = new Uint8Array([4, 8, 15, 16, 23, 42]);
  const entries = inspectZip(original).map((entry) => {
    let bytes: Uint8Array = entry.payload;
    if (entry.name === "[Content_Types].xml") {
      const document = parseXmlPart(bytes, xmlLimits);
      bytes = document
        .spliceChildren(document.root, document.root.children.length, 0, [
          '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/custom.bin" ContentType="application/octet-stream"/>'
        ])
        .bytes();
    }
    if (entry.name === "ppt/_rels/presentation.xml.rels") {
      const document = parseXmlPart(bytes, xmlLimits);
      bytes = document
        .spliceChildren(document.root, document.root.children.length, 0, [
          '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="outside" Type="https://example.invalid/resource" Target="https://example.invalid/data" TargetMode="External"/>'
        ])
        .bytes();
    }
    return { name: entry.name, bytes };
  });
  const input = storedArchive([...entries, { name: "custom.bin", bytes: binary }]);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network authority"));
  try {
    const deck = await Presentation(input);
    const part = deck.part.package.get_part("/custom.bin")!;
    expect(part.content_type).toBe("application/octet-stream");
    expect(part.blob).toEqual(binary);
    expect(part.rels).toEqual([]);
    expect(() => part.element).toThrowError(
      expect.objectContaining({ code: "property-unavailable" })
    );
    expect(() => {
      part.blob = binary;
    }).toThrowError(expect.objectContaining({ code: "unsupported-profile" }));
    expect(deck.part.rels.find((edge) => edge.id === "outside")).toEqual({
      id: "outside",
      type: "https://example.invalid/resource",
      target: "https://example.invalid/data",
      mode: "external"
    });
    deck.element.set({ namespace: "", localName: "saveSubsetFonts" }, "1");
    expect(
      inspectZip(await deck.save()).find((entry) => entry.name === "custom.bin")?.payload
    ).toEqual(binary);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

it("does not revive an old XML handle when later edits restore identical bytes", async () => {
  const deck = await Presentation();
  const original = deck.part.blob;
  const handle = deck.element;
  deck.slide_width = new Inches(11);
  deck.slide_width = new Inches(10);
  expect(deck.part.blob).toEqual(original);
  expect(() => handle.tag).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
});
