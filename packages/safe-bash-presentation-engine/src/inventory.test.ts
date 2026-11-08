import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createHash } from "node:crypto";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readSelectionIndex } from "./index.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encode = (value: string) => new TextEncoder().encode(value);
const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 65536,
    maxMembers: 50,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 50, maxRelationships: 50 }
};
function fixture(
  reverse: boolean,
  show = "0",
  alter?: (entries: { name: string; bytes: Uint8Array }[]) => void
) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const xml = (name: string, value: string) => entries.push({ name, bytes: encode(value) });
  const rels = (name: string, rows: [string, string, string][]) =>
    xml(
      name,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join("")}</Relationships>`
    );
  const shape = (id: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Tile"/></p:nvSpPr></p:sp>`;
  const drawing = (tag: string, count: number, attrs = "") =>
    `<p:${tag} xmlns:p="${p}" ${attrs}><p:cSld><p:spTree>${Array.from({ length: count }, (_, i) => shape(i + 1)).join("")}</p:spTree></p:cSld></p:${tag}>`;
  xml(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="image/png"/></Types>'
  );
  rels("_rels/.rels", [["main", "officeDocument", "deck.xml"]]);
  xml(
    "deck.xml",
    `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="901" r:id="first"/><p:sldId id="402" r:id="second"/></p:sldIdLst></p:presentation>`
  );
  rels("_rels/deck.xml.rels", [
    ["second", "slide", "a.xml"],
    ["first", "slide", "z.xml"],
    ["m1", "slideMaster", "m1.xml"],
    ["m2", "slideMaster", "m2.xml"]
  ]);
  xml("z.xml", drawing("sld", 2, `show="${show}"`));
  xml("a.xml", drawing("sld", 1));
  for (const [slide, n] of [
    ["z", 1],
    ["a", 2]
  ] as const) {
    rels(`_rels/${slide}.xml.rels`, [
      ["layout", "slideLayout", `l${n}.xml`],
      ["notes", "notesSlide", `n${n}.xml`],
      ["image", "image", "asset.bin"]
    ]);
    xml(`l${n}.xml`, drawing("sldLayout", 4));
    xml(`m${n}.xml`, drawing("sldMaster", 5));
    xml(`n${n}.xml`, drawing("notes", 3));
    xml(`t${n}.xml`, '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>');
    rels(`_rels/l${n}.xml.rels`, [["master", "slideMaster", `m${n}.xml`]]);
    rels(`_rels/m${n}.xml.rels`, [
      ["layout", "slideLayout", `l${n}.xml`],
      ["theme", "theme", `t${n}.xml`]
    ]);
  }
  entries.push({ name: "asset.bin", bytes: new Uint8Array([1, 7, 9]) });
  xml("opaque.xml", '<x:widget xmlns:x="urn:example:widget"/>');
  alter?.(entries);
  return storedArchive(reverse ? entries.reverse() : entries);
}

describe("presentation inventory", () => {
  it.each([false, true])(
    "counts graph owners independently of package order %s",
    async (reverse) => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/deck.pptx", fixture(reverse));
      const index = await readSelectionIndex(
        new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer),
        context
      );
      expect(index.inventory.counts).toEqual({
        slides: 2,
        masters: 2,
        layouts: 2,
        themes: 2,
        slideShapes: 3,
        parts: 13,
        media: 1
      });
      expect(index.inventory.slides).toEqual([
        {
          id: "901",
          part: "/z.xml",
          position: 1,
          shapeCount: 2,
          layout: "/l1.xml",
          master: "/m1.xml",
          theme: "/t1.xml",
          show: { explicit: false, effective: false }
        },
        {
          id: "402",
          part: "/a.xml",
          position: 2,
          shapeCount: 1,
          layout: "/l2.xml",
          master: "/m2.xml",
          theme: "/t2.xml",
          show: { explicit: null, effective: true }
        }
      ]);
      expect(index.inventory.masters).toEqual(["/m1.xml", "/m2.xml"]);
      expect(index.inventory.media).toEqual([
        {
          part: "/asset.bin",
          contentType: "image/png",
          bytes: 3,
          sha256: createHash("sha256")
            .update(new Uint8Array([1, 7, 9]))
            .digest("hex")
        }
      ]);
      expect(index.inventory.unsupported).toContainEqual({
        part: "/opaque.xml",
        reason: "semantic-content-not-inspected"
      });
      expect(index.inventory.relationships).toHaveLength(17);
      expect(index.inventory.features).toMatchObject({
        editing: false,
        effectiveFormatting: false,
        slideVisibility: true
      });
    }
  );
  it("keeps the inventory stable when only ZIP member order changes", async () => {
    const first = await readSelectionIndex(fixture(false), context);
    const second = await readSelectionIndex(fixture(true), context);
    expect(first.inventory.slides).toHaveLength(2);
    expect(first.inventory).toEqual(second.inventory);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
  it.each(["true", "1", "false", "0"])(
    "distinguishes explicit visibility %s from absence",
    async (show) => {
      const index = await readSelectionIndex(fixture(false, show), context);
      expect(index.inventory.slides[0]!.show).toEqual({
        explicit: show === "true" || show === "1",
        effective: show === "true" || show === "1"
      });
    }
  );
  it("rejects malformed slide visibility rather than inventing an effective value", async () => {
    await expect(readSelectionIndex(fixture(false, "perhaps"), context)).rejects.toMatchObject({
      code: "invalid-xml"
    });
  });
  it("includes an unreferenced preview image outside the media directory", async () => {
    const bytes = fixture(false, "0", (entries) => {
      entries.push({ name: "metadata/preview.bin", bytes: new Uint8Array([4, 2]) });
    });
    const index = await readSelectionIndex(bytes, context);
    expect(index.inventory.counts.media).toBe(2);
    expect(index.inventory.media.map((part) => part.part)).toEqual([
      "/asset.bin",
      "/metadata/preview.bin"
    ]);
    expect(index.inventory.counts.slideShapes).toBe(3);
    expect(Object.isFrozen(index.inventory)).toBe(true);
    expect(Object.isFrozen(index.inventory.slides[0]!.show)).toBe(true);
  });
  it("reports missing content types without suppressing unknown parts", async () => {
    const bytes = fixture(false, "0", (entries) => {
      entries.splice(
        entries.findIndex((entry) => entry.name === "[Content_Types].xml"),
        1
      );
    });
    const index = await readSelectionIndex(bytes, context);
    expect(
      index.inventory.parts.find((part) => part.part === "/opaque.xml")!.contentType
    ).toBeNull();
    expect(index.inventory.unsupported).toContainEqual({
      part: "/opaque.xml",
      reason: "content-type-unavailable"
    });
    expect(index.inventory.media.map((part) => part.part)).toEqual(["/asset.bin"]);
  });
  it("retains dangling and external graph edges without following their targets", async () => {
    const bytes = fixture(false, "0", (entries) => {
      entries.push({
        name: "_rels/opaque.xml.rels",
        bytes: encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="missing" Type="${r}/image" Target="lost.bin"/><Relationship Id="remote" Type="${r}/image" Target="https://example.invalid/picture" TargetMode="External"/></Relationships>`
        )
      });
    });
    const index = await readSelectionIndex(bytes, context);
    expect(index.inventory.unsupported).toContainEqual({
      part: "/opaque.xml",
      reason: "missing-relationship-target:missing"
    });
    expect(index.inventory.unsupported).toContainEqual({
      part: "/opaque.xml",
      reason: "external-relationship:remote"
    });
    expect(index.inventory.relationships.filter((edge) => edge.owner === "/opaque.xml")).toEqual([
      {
        owner: "/opaque.xml",
        id: "missing",
        type: `${r}/image`,
        target: "lost.bin",
        targetPart: "/lost.bin",
        external: false
      },
      {
        owner: "/opaque.xml",
        id: "remote",
        type: `${r}/image`,
        target: "https://example.invalid/picture",
        targetPart: null,
        external: true
      }
    ]);
    expect(index.inventory.counts.media).toBe(1);
  });
});
