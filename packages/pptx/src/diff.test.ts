import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { comparePresentations } from "./diff.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
let base: Uint8Array;
beforeAll(async () => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  base = await createPresentation(
    {
      properties: { title: "Original" },
      slides: [
        {
          name: "First",
          shapes: [{ name: "Caption", text: "Early", x: 10, y: 20, width: 100, height: 50 }]
        },
        { name: "Second" }
      ]
    },
    context
  );
});
afterAll(() => vi.restoreAllMocks());
function revised(edit: (parts: Map<string, Uint8Array>) => void) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", base);
  const parts = new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
  edit(parts);
  return storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
}
function xmlEdit(
  parts: Map<string, Uint8Array>,
  name: string,
  edit: (xml: ReturnType<typeof parseXmlPart>) => ReturnType<typeof parseXmlPart>
) {
  parts.set(name, edit(parseXmlPart(parts.get(name)!, context.xmlLimits)).bytes());
}

describe("presentation comparison", () => {
  it("returns equality as data and rejects unavailable effective formatting explicitly", async () => {
    const result = await comparePresentations(base, base, {}, context);
    expect(result).toMatchObject({
      equal: true,
      mode: "structural",
      formatting: "raw",
      changes: []
    });
    await expect(
      comparePresentations(base, base, { mode: "effective-formatting" }, context)
    ).rejects.toMatchObject({ code: "unsupported-profile" });
  });
  it("distinguishes slide reordering from identity replacement", async () => {
    const reordered = revised((parts) =>
      xmlEdit(parts, "ppt/presentation.xml", (xml) => {
        const list = xml.root.children.find((x) => x.name.localName === "sldIdLst")!;
        return xml.reorderChildren(list, [...list.children].reverse());
      })
    );
    const moved = await comparePresentations(base, reordered, {}, context);
    expect(moved.changes.filter((x) => x.category === "slides")).toMatchObject([
      { id: "slide/256/position", kind: "changed", before: 1, after: 2 },
      { id: "slide/257/position", kind: "changed", before: 2, after: 1 }
    ]);
    const replaced = revised((parts) =>
      xmlEdit(parts, "ppt/presentation.xml", (xml) => {
        const list = xml.root.children.find((x) => x.name.localName === "sldIdLst")!;
        return xml.merge(list.children[0]!, {
          attributes: [{ namespace: "", localName: "id", value: "999" }]
        });
      })
    );
    const result = await comparePresentations(base, replaced, {}, context);
    expect(
      result.changes.filter((x) => x.category === "slides").map((x) => [x.id, x.kind])
    ).toEqual([
      ["slide/256", "removed"],
      ["slide/999", "added"]
    ]);
  });
  it("reports original text, property and raw geometry values in category order", async () => {
    const changed = await createPresentation(
      {
        properties: { title: "Revised" },
        slides: [
          {
            name: "First",
            shapes: [{ name: "Caption", text: "Later", x: 30, y: 20, width: 100, height: 50 }]
          },
          { name: "Second" }
        ]
      },
      context
    );
    const result = await comparePresentations(base, changed, {}, context);
    expect(result.equal).toBe(false);
    expect(
      result.changes
        .filter((x) => ["text", "properties", "geometry"].includes(x.category))
        .map((x) => x.category)
    ).toEqual(["text", "properties", "geometry"]);
    expect(result.changes.find((x) => x.category === "text")).toMatchObject({
      before: "Early",
      after: "Later",
      kind: "changed"
    });
    expect(result.changes.find((x) => x.category === "properties")).toMatchObject({
      before: { value: "Original" },
      after: { value: "Revised" }
    });
    expect(result.changes.find((x) => x.category === "geometry")?.id).toBe(
      "slide/256/shape/2/geometry"
    );
  });
  it("compares media bytes independently of part names without decoding them", async () => {
    const payload = new TextEncoder().encode("opaque media bytes");
    const add = (name: string, bytes: Uint8Array) =>
      revised((parts) => {
        parts.set(name, bytes);
        xmlEdit(parts, "[Content_Types].xml", (xml) =>
          xml.spliceChildren(xml.root, xml.root.children.length, 0, [
            `<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="bin" ContentType="image/unknown"/>`
          ])
        );
      });
    expect(
      (
        await comparePresentations(
          add("one.bin", payload),
          add("two.bin", payload),
          { mode: "media" },
          context
        )
      ).equal
    ).toBe(true);
    const result = await comparePresentations(
      base,
      add("one.bin", payload),
      { mode: "media" },
      context
    );
    const hash = createHash("sha256").update(payload).digest("hex");
    expect(result.changes).toMatchObject([
      { id: `media/${hash}`, kind: "added", after: { sha256: hash, bytes: 18, count: 1 } }
    ]);
  });
  it("reports opaque bytes and raw package member changes conservatively", async () => {
    const changed = revised((parts) => {
      parts.set("opaque.bin", new Uint8Array([1, 8, 3]));
      xmlEdit(parts, "[Content_Types].xml", (xml) =>
        xml.spliceChildren(xml.root, xml.root.children.length, 0, [
          '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="bin" ContentType="application/octet-stream"/>'
        ])
      );
    });
    const result = await comparePresentations(base, changed, {}, context);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ id: "part/%2Fopaque.bin", category: "opaque", kind: "added" })
    );
    expect(
      (await comparePresentations(base, changed, { mode: "raw" }, context)).changes
    ).toContainEqual(expect.objectContaining({ category: "raw", kind: "added" }));
    expect((await comparePresentations(base, changed, { mode: "text" }, context)).equal).toBe(true);
  });
  it("reports relationship target changes with owner and edge identities", async () => {
    const link = (target: string) =>
      revised((parts) =>
        xmlEdit(parts, "ppt/_rels/presentation.xml.rels", (xml) =>
          xml.spliceChildren(xml.root, xml.root.children.length, 0, [
            `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="jump" Type="urn:link" Target="${target}" TargetMode="External"/>`
          ])
        )
      );
    const result = await comparePresentations(
      link("https://example.invalid/first"),
      link("https://example.invalid/second"),
      { mode: "relationships" },
      context
    );
    expect(result.changes).toMatchObject([
      {
        category: "relationships",
        kind: "changed",
        before: { target: "https://example.invalid/first" },
        after: { target: "https://example.invalid/second" }
      }
    ]);
  });
  it("retains text identity across renamed slide parts and observes text reordering", async () => {
    const renamed = revised((parts) => {
      parts.set("ppt/slides/renamed.xml", parts.get("ppt/slides/slide1.xml")!);
      parts.delete("ppt/slides/slide1.xml");
      parts.set(
        "ppt/slides/_rels/renamed.xml.rels",
        parts.get("ppt/slides/_rels/slide1.xml.rels")!
      );
      parts.delete("ppt/slides/_rels/slide1.xml.rels");
      xmlEdit(parts, "[Content_Types].xml", (xml) =>
        xml.merge(
          xml.root.children.find((x) =>
            x.attributes.some((a) => a.value === "/ppt/slides/slide1.xml")
          )!,
          {
            attributes: [{ namespace: "", localName: "PartName", value: "/ppt/slides/renamed.xml" }]
          }
        )
      );
      xmlEdit(parts, "ppt/_rels/presentation.xml.rels", (xml) =>
        xml.merge(
          xml.root.children.find((x) => x.attributes.some((a) => a.value === "slides/slide1.xml"))!,
          { attributes: [{ namespace: "", localName: "Target", value: "slides/renamed.xml" }] }
        )
      );
    });
    expect((await comparePresentations(base, renamed, { mode: "text" }, context)).equal).toBe(true);
    expect(
      (await comparePresentations(base, renamed, {}, context)).changes.filter((x) =>
        ["slides", "text", "geometry"].includes(x.category)
      )
    ).toEqual([]);
    expect((await comparePresentations(base, renamed, { mode: "raw" }, context)).equal).toBe(false);
    const order = await createPresentation(
      {
        slides: [
          {
            shapes: [
              { text: "A", x: 0, y: 0, width: 1, height: 1 },
              { text: "B", x: 0, y: 0, width: 1, height: 1 }
            ]
          }
        ]
      },
      context
    );
    const parts = new Map(inspectZip(order).map((x) => [x.name, x.payload]));
    xmlEdit(parts, "ppt/slides/slide1.xml", (xml) => {
      const tree = xml.root.children
        .find((x) => x.name.localName === "cSld")!
        .children.find((x) => x.name.localName === "spTree")!;
      return xml.reorderChildren(tree, [
        ...tree.children.filter((x) => x.name.localName !== "sp"),
        ...tree.children.filter((x) => x.name.localName === "sp").reverse()
      ]);
    });
    const reordered = storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
    const result = await comparePresentations(order, reordered, { mode: "text" }, context);
    expect(result).toMatchObject({
      equal: false,
      changes: [
        {
          id: "text/order",
          category: "text",
          kind: "changed",
          before: ["slide/256/shape/2/text", "slide/256/shape/3/text"],
          after: ["slide/256/shape/3/text", "slide/256/shape/2/text"]
        }
      ]
    });
  });
  it("validates options before reading capabilities and honors cancellation and byte ceilings", async () => {
    const read = vi.fn();
    await expect(
      comparePresentations({ read }, base, { mode: "unknown" as never }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(read).not.toHaveBeenCalled();
    await expect(
      comparePresentations(base, base, {}, { ...context, signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ code: "cancelled" });
    await expect(
      comparePresentations(
        base,
        base,
        {},
        { ...context, limits: { ...context.limits, maxBytes: 4 } }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
});
