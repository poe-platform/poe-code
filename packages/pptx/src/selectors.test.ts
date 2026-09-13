import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createHash } from "node:crypto";
import { storedArchive } from "../tests/fixtures/archive.js";
import { createBatchHandles, readSelectionIndex, decodeSelectionToken } from "./selectors.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const text = (value: string) => new TextEncoder().encode(value);
const links = (rows: string) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`;
const shape = (id: number | string, name: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr></p:sp>`;
function archive(reverse = false, duplicate: boolean | string = false, extension = "") {
  const order = reverse
    ? [
        ["902", "b"],
        ["321", "a"]
      ]
    : [
        ["321", "a"],
        ["902", "b"]
      ];
  return storedArchive([
    {
      name: "ppt/slides/slide2.xml",
      bytes: text(
        `<p:sld xmlns:p="${p}"><p:cSld name="Garden"><p:spTree>${shape(7, "Leaf")}</p:spTree></p:cSld></p:sld>`
      )
    },
    {
      name: "_rels/.rels",
      bytes: text(
        links(`<Relationship Id="root" Type="${r}/officeDocument" Target="ppt/deck.xml"/>`)
      )
    },
    {
      name: "ppt/deck.xml",
      bytes: text(
        `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst>${order.map(([id, rid]) => `<p:sldId id="${id}" r:id="${rid}"/>`).join("")}</p:sldIdLst></p:presentation>`
      )
    },
    {
      name: "ppt/_rels/deck.xml.rels",
      bytes: text(
        links(
          `<Relationship Id="a" Type="${r}/slide" Target="slides/slide99.xml"/><Relationship Id="b" Type="${r}/slide" Target="slides/slide2.xml"/>`
        )
      )
    },
    {
      name: "ppt/slides/slide99.xml",
      bytes: text(
        `<p:sld xmlns:p="${p}"><p:cSld name="Garden"><p:spTree>${shape(7, "Leaf")}<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="Cluster"/></p:nvGrpSpPr>${shape(typeof duplicate === "string" ? duplicate : duplicate ? 7 : 9, "Leaf")}${shape(10, "7")}</p:grpSp></p:spTree>${extension}</p:cSld></p:sld>`
      )
    }
  ]);
}
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 30,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 30, maxRelationships: 30 }
};

describe("presentation selectors", () => {
  it.each([
    ["sp", "nvSpPr", 1],
    ["cxnSp", "nvCxnSpPr", 2],
    ["graphicFrame", "nvGraphicFramePr", 3],
    ["grpSp", "nvGrpSpPr", 4],
    ["pic", "nvPicPr", 5],
    ["sp", "nvSpPr", 2],
    ["pic", "nvPicPr", 3],
    ["graphicFrame", "nvGraphicFramePr", 4],
    ["grpSp", "nvGrpSpPr", 9],
    ["cxnSp", "nvCxnSpPr", 11]
  ])("reads identity for %s via %s with numeric ID %i", async (kind, properties, id) => {
    const bytes = storedArchive([
      {
        name: "_rels/.rels",
        bytes: text(links(`<Relationship Id="root" Type="${r}/officeDocument" Target="deck.xml"/>`))
      },
      {
        name: "deck.xml",
        bytes: text(
          `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="page"/></p:sldIdLst></p:presentation>`
        )
      },
      {
        name: "_rels/deck.xml.rels",
        bytes: text(links(`<Relationship Id="page" Type="${r}/slide" Target="page.xml"/>`))
      },
      {
        name: "page.xml",
        bytes: text(
          `<p:sld xmlns:p="${p}"><p:cSld><p:spTree><p:${kind}><p:${properties}><p:cNvPr id="${id}" name="Sprout"/></p:${properties}>${kind === "graphicFrame" ? `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${r}" r:id="chart"/></a:graphicData></a:graphic>` : ""}</p:${kind}></p:spTree></p:cSld></p:sld>`
        )
      }
    ]);
    const index = await readSelectionIndex(bytes, context);
    expect(index.slides.map((slide) => [slide.id, slide.name])).toEqual([["256", ""]]);
    expect(index.objects.map((object) => [object.id, object.name, object.objectType])).toEqual([
      [String(id), "Sprout", kind]
    ]);
    expect(() => index.select({ kind: "object", owner: "/page.xml", name: "sprout" })).toThrowError(
      expect.objectContaining({ code: "missing-selection" })
    );
  });
  it("numbers parts inside their explicit scope and rejects inapplicable slide scope", async () => {
    const index = await readSelectionIndex(archive(), context);
    expect(
      index.select({
        kind: "part",
        scope: "presentation",
        position: { coordinateSystem: "one-based", value: 1 }
      })[0]!.part
    ).toBe("/ppt/deck.xml");
    expect(() => index.select({ kind: "slide", scope: "notes", all: true })).toThrowError(
      expect.objectContaining({ code: "invalid-selection" })
    );
  });

  it("hashes admitted VFS bytes and uses relationship slide order rather than filenames", async () => {
    const bytes = archive();
    const volume = Volume.fromJSON({ "/deck.pptx": Buffer.from(bytes) });
    const index = await readSelectionIndex(
      {
        path: "/deck.pptx",
        capability: {
          async openRead(path) {
            const source = new Uint8Array(volume.readFileSync(path) as Buffer);
            let offset = 0;
            return {
              async read(maxBytes) {
                if (offset === source.length) return null;
                const value = source.slice(offset, offset + maxBytes);
                offset += value.length;
                return value;
              }
            };
          }
        }
      },
      context
    );
    expect(index.fingerprint).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(index.slides.map(({ id, part, position }) => [id, part, position])).toEqual([
      ["321", "/ppt/slides/slide99.xml", 1],
      ["902", "/ppt/slides/slide2.xml", 2]
    ]);
    expect(index.slides[0]!.location).toEqual({
      fingerprint: index.fingerprint,
      scope: "slides",
      owner: "/ppt/deck.xml",
      objectId: "321",
      coordinateSystem: "identity"
    });
  });
  it("preserves slide IDs across reorder and rejects stale tokens", async () => {
    const before = await readSelectionIndex(archive(), context);
    const after = await readSelectionIndex(archive(true), context);
    expect(after.slides.map(({ id }) => id)).toEqual(["902", "321"]);
    expect(after.select({ kind: "slide", id: "321" })[0]!.part).toBe("/ppt/slides/slide99.xml");
    expect(() => after.select({ kind: "slide", token: before.slides[0]!.token })).toThrowError(
      expect.objectContaining({ code: "stale-selection" })
    );
  });
  it("requires explicit coordinates and validates ordinal bounds", async () => {
    const index = await readSelectionIndex(archive(), context);
    for (const [coordinateSystem, value] of [
      ["one-based", 1],
      ["zero-based", 0]
    ] as const)
      expect(index.select({ kind: "slide", position: { coordinateSystem, value } })[0]!.id).toBe(
        "321"
      );
    for (const value of [0, -1, 1.5, NaN, Infinity])
      expect(() =>
        index.select({ kind: "slide", position: { coordinateSystem: "one-based", value } })
      ).toThrowError(expect.objectContaining({ code: "invalid-selection" }));
    expect(() =>
      index.select({ kind: "slide", position: { coordinateSystem: "one-based", value: 3 } })
    ).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    expect(() => index.select({ kind: "slide", position: { value: 1 } } as never)).toThrowError(
      expect.objectContaining({ code: "invalid-selection" })
    );
  });
  it("rejects duplicate names with candidates unless all is explicit", async () => {
    const index = await readSelectionIndex(archive(), context);
    expect(() => index.select({ kind: "slide", name: "Garden" })).toThrowError(
      expect.objectContaining({
        code: "ambiguous-selection",
        candidates: index.slides.map((s) => s.location)
      })
    );
    expect(index.select({ kind: "slide", name: "Garden", all: true })).toHaveLength(2);
    expect(
      index
        .select({ kind: "object", owner: "/ppt/slides/slide99.xml", name: "Leaf", all: true })
        .map((o) => o.id)
    ).toEqual(["7", "9"]);
    expect(
      index.select({ kind: "object", owner: "/ppt/slides/slide99.xml", name: "7" })[0]!.id
    ).toBe("10");
  });
  it("scopes shape IDs by owner and does not pick duplicate identities", async () => {
    const index = await readSelectionIndex(archive(), context);
    expect(() => index.select({ kind: "object", id: "7" })).toThrowError(
      expect.objectContaining({ code: "invalid-selection" })
    );
    expect(index.select({ kind: "object", owner: "/ppt/slides/slide2.xml", id: "7" })).toHaveLength(
      1
    );
    await expect(readSelectionIndex(archive(false, true), context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it.each(["007", "-2", "x", "4294967296"])(
    "rejects invalid or numerically duplicate object ID %s",
    async (id) => {
      await expect(readSelectionIndex(archive(false, id), context)).rejects.toMatchObject({
        code: "invalid-opc"
      });
    }
  );
  it("canonicalizes legal unsigned identity lexical forms", async () => {
    const index = await readSelectionIndex(archive(false, " +9 "), context);
    expect(index.objects.map((object) => object.id)).toEqual(["7", "8", "9", "10", "7"]);
    await expect(readSelectionIndex(archive(false, "+7"), context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it("indexes drawing objects while retaining opaque application extension payloads", async () => {
    const extension =
      '<p:extLst><p:ext uri="urn:decoration"><x:detail xmlns:x="urn:ornament"/></p:ext></p:extLst>';
    const index = await readSelectionIndex(archive(false, false, extension), context);
    expect(index.objects.map((object) => object.id)).toEqual(["7", "8", "9", "10", "7"]);
  });
  it("validates tokens without admitting input", () => {
    const location = {
      fingerprint: "a".repeat(64),
      scope: "slides",
      owner: "/deck.xml",
      objectId: "256",
      coordinateSystem: "identity"
    };
    expect(decodeSelectionToken(JSON.stringify(location))).toEqual(location);
    for (const token of [
      "broken",
      JSON.stringify({ ...location, coordinateSystem: "one-based" }),
      JSON.stringify({ ...location, extra: true }),
      JSON.stringify(location, null, 2)
    ])
      expect(() => decodeSelectionToken(token)).toThrowError(
        expect.objectContaining({ code: "invalid-selection" })
      );
  });
  it("roundtrips canonical tokens and rejects conflicting or malformed selectors", async () => {
    const index = await readSelectionIndex(archive(), context);
    const item = index.select({ kind: "part", part: "/ppt/deck.xml", scope: "presentation" })[0]!;
    expect(index.select({ kind: "part", token: item.token })).toEqual([item]);
    for (const request of [
      { kind: "part", token: item.token, name: "x" },
      { kind: "part", token: "garbage" },
      { kind: "slide", scope: "other" },
      { kind: "slide", extra: true },
      { kind: "slide", id: "321", name: "Garden" }
    ])
      expect(() => index.select(request as never)).toThrowError(
        expect.objectContaining({ code: "invalid-selection" })
      );
  });
  it.each(["", "f".repeat(63), "G".repeat(64)])(
    "rejects invalid handle registry fingerprint %s",
    (fingerprint) => {
      expect(() => createBatchHandles(fingerprint)).toThrowError(
        expect.objectContaining({ code: "invalid-selection" })
      );
    }
  );
  it("binds created result handles to invocation and owner and rejects reuse or invalidation", async () => {
    const index = await readSelectionIndex(archive(), context);
    const location = { ...index.objects[0]!.location, objectId: "42" };
    expect(() => index.select({ kind: "object", owner: location.owner, id: "42" })).toThrowError(
      expect.objectContaining({ code: "missing-selection" })
    );
    const handles = createBatchHandles(index.fingerprint);
    expect(() => handles.resolve("new", location.owner)).toThrowError(
      expect.objectContaining({ code: "missing-selection" })
    );
    handles.register("new", location);
    expect(handles.resolve("new", location.owner)).toEqual(location);
    expect(() => handles.register("new", location)).toThrowError(
      expect.objectContaining({ code: "invalid-selection" })
    );
    expect(() => handles.resolve("new", "/other.xml")).toThrowError(
      expect.objectContaining({ code: "invalid-selection" })
    );
    expect(() =>
      handles.register("foreign", { ...location, fingerprint: "0".repeat(64) })
    ).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    handles.invalidate("new");
    expect(() => handles.resolve("new", location.owner)).toThrowError(
      expect.objectContaining({ code: "stale-selection" })
    );
  });
});
