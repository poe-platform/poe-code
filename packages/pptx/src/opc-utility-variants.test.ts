import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { packageUri } from "./package-uri.js";
import { parseContentTypes } from "./content-types.js";
import { parseRelationships, readRelationshipGraph, relationshipGraph } from "./relationships.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { Presentation } from "./presentation-model.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { nextRel } from "./masters.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const encode = (value: string) => new TextEncoder().encode(value);
const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 20,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  }
};
const limits = { maxBytes: 8192, maxRelationships: 30, maxParts: 20 };
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const typeNs = "http://schemas.openxmlformats.org/package/2006/content-types";

describe("OPC utility parameter variants", () => {
  it("rejects part URI assignment without changing live names or serialized bytes", async () => {
    const deck = await Presentation();
    const before = await deck.save();
    const names = deck.part.package.parts.map((part) => part.partname);
    const part = deck.part;
    expect(Reflect.set(part, "partname", "/other/main.xml")).toBe(false);
    expect(part.partname).toBe("/ppt/presentation.xml");
    expect(deck.part.package.parts.map((value) => value.partname)).toEqual(names);
    expect(await deck.save()).toEqual(before);
  });
  it.each([
    ["https://example.invalid/one", true, "rId1"],
    ["/deck/one.xml", false, "rId2"],
    ["https://example.invalid/two", true, "rId3"],
    ["/deck/two.xml", false, "rId4"],
    ["https://example.invalid/missing", true, null]
  ] as const)("exposes matching relationship identity for %s", (target, external, expected) => {
    const graph = relationshipGraph(
      ["/deck/main.xml", "/deck/one.xml", "/deck/two.xml"],
      [
        {
          owner: "/deck/main.xml",
          relationships: [
            {
              id: "rId1",
              type: "urn:example:resource",
              target: "https://example.invalid/one",
              external: true
            },
            { id: "rId2", type: "urn:example:resource", target: "one.xml", external: false },
            {
              id: "rId3",
              type: "urn:example:resource",
              target: "https://example.invalid/two",
              external: true
            },
            { id: "rId4", type: "urn:example:resource", target: "two.xml", external: false }
          ]
        }
      ],
      limits
    );
    const matches = external
      ? graph.outgoing("/deck/main.xml").filter((edge) => edge.external && edge.target === target)
      : graph.incoming(target);
    expect(matches.map((edge) => edge.id)).toEqual(expected === null ? [] : [expected]);
  });
  it("preserves declaration, unused namespaces, whitespace and multibyte text during XML serialization", () => {
    const source =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:page xmlns:a="urn:example:page" xmlns:unused="urn:example:retained">\n  <a:caption>Crème Å</a:caption>\n</a:page>\n';
    const expected = encode(source);
    const document = parseXmlPart(expected, { maxBytes: 8192, maxNodes: 100, maxDepth: 10 });
    expect(document.bytes()).toEqual(expected);
    expect(document.bytes().length).toBe(source.length + 2);
  });
  it("preserves all decoded parts while canonicalizing an unsorted archive on model save", async () => {
    const baseline = await (await Presentation()).save();
    const reversed = inspectZip(baseline).reverse();
    const unsorted = storedArchive(
      reversed.map((member) => ({ name: member.name, bytes: member.payload }))
    );
    const saved = await (await Presentation(unsorted)).save();
    expect(saved).not.toEqual(unsorted);
    const output = inspectZip(saved);
    expect(output.map((member) => member.name)).toEqual(
      reversed.map((member) => member.name).sort()
    );
    for (const original of reversed)
      expect(output.find((member) => member.name === original.name)?.payload).toEqual(
        original.payload
      );
  });

  it.each([
    [[], "rId1"],
    [["rId1"], "rId2"],
    [["rId1", "rId2"], "rId3"],
    [["rId1", "rId4"], "rId2"],
    [["rId1", "rId4", "rId6"], "rId2"],
    [["rId1", "rId2", "rId6"], "rId3"],
    [["rId1", "rId3"], "rId2"]
  ] as const)("allocates the lowest unoccupied relationship ID for %j", (ids, expected) => {
    const document = parseXmlPart(
      encode(
        `<Relationships xmlns="${relNs}">${ids.map((id) => `<Relationship Id="${id}" Type="urn:example:resource" Target="part.xml"/>`).join("")}</Relationships>`
      ),
      { maxBytes: 8192, maxNodes: 100, maxDepth: 10 }
    );
    expect(nextRel(document)).toBe(expected);
    expect(ids).not.toContain(expected);
  });
  it.each([
    ["/", "/", "", "", null, "/_rels/.rels"],
    ["/slides/page1.xml", "/slides", "page1.xml", "xml", 1, "/slides/_rels/page1.xml.rels"],
    ["/assets/tile.PnG", "/assets", "tile.PnG", "PnG", null, "/assets/_rels/tile.PnG.rels"],
    ["/slides/page42.xml", "/slides", "page42.xml", "xml", 42, "/slides/_rels/page42.xml.rels"]
  ] as const)(
    "retains all metadata fields for %s",
    (name, baseURI, filename, ext, idx, relsUri) => {
      expect(packageUri(name)).toMatchObject({ name, baseURI, filename, ext, idx, relsUri });
    }
  );

  it.each([undefined, "Internal", "External"])(
    "reads complete relationship values for mode %s",
    (mode) => {
      const input = encode(
        `<Relationships xmlns="${relNs}"><Relationship Id="rId9" Type="urn:example:resource" Target="assets/tile.bin"${mode ? ` TargetMode="${mode}"` : ""}/></Relationships>`
      );
      expect(parseRelationships(input, limits)).toEqual([
        {
          id: "rId9",
          type: "urn:example:resource",
          target: "assets/tile.bin",
          external: mode === "External"
        }
      ]);
    }
  );

  it("admits empty relationship collections but rejects unbound content type declarations", () => {
    expect(parseRelationships(encode(`<Relationships xmlns="${relNs}"/>`), limits)).toEqual([]);
    expect(() =>
      parseContentTypes(encode(`<Types xmlns="${typeNs}"/>`), { maxBytes: 8192, maxEntries: 20 })
    ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
  });

  it("reads defaults and overrides from incrementally authored original declarations", () => {
    const index = parseContentTypes(
      encode(
        `<Types xmlns="${typeNs}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/info/core.xml" ContentType="application/x-core"/><Override PartName="/slides/main.xml" ContentType="application/x-slides"/><Override PartName="/info/preview.jpeg" ContentType="image/jpeg"/></Types>`
      ),
      { maxBytes: 8192, maxEntries: 20 }
    );
    expect(index.get("/plain.xml")).toBe("application/xml");
    expect(index.get("/photo.jpeg")).toBe("image/jpeg");
    expect(index.get("/info/core.xml")).toBe("application/x-core");
    expect(index.get("/slides/main.xml")).toBe("application/x-slides");
    expect(index.get("/info/preview.jpeg")).toBe("image/jpeg");
  });

  it("serializes each part and owner relationship stream through an explicit memory capability", async () => {
    const volume = new Volume();
    const members = [
      {
        name: "[Content_Types].xml",
        bytes: encode(
          `<Types xmlns="${typeNs}"><Default Extension="xml" ContentType="application/xml"/></Types>`
        )
      },
      {
        name: "_rels/.rels",
        bytes: encode(
          `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="urn:example:main" Target="deck/a.xml"/></Relationships>`
        )
      },
      { name: "deck/a.xml", bytes: encode("<page>Apricot</page>") },
      { name: "deck/b.xml", bytes: encode("<page>Birch</page>") },
      { name: "deck/c.xml", bytes: encode("<page>Cedar</page>") },
      {
        name: "deck/_rels/a.xml.rels",
        bytes: encode(
          `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="urn:example:child" Target="b.xml"/><Relationship Id="rId2" Type="urn:example:external" Target="https://example.invalid/resource" TargetMode="External"/></Relationships>`
        )
      },
      {
        name: "deck/_rels/b.xml.rels",
        bytes: encode(
          `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="urn:example:child" Target="c.xml"/></Relationships>`
        )
      }
    ];
    volume.writeFileSync(
      "/deck.zip",
      await writePackageArchive(members, context, { compression: "store" })
    );
    const emitted = new Uint8Array(volume.readFileSync("/deck.zip") as Uint8Array);
    const independent = inspectZip(emitted);
    expect(independent.map((member) => member.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "deck/_rels/a.xml.rels",
      "deck/_rels/b.xml.rels",
      "deck/a.xml",
      "deck/b.xml",
      "deck/c.xml"
    ]);
    expect(independent.find((member) => member.name === "deck/a.xml")?.payload).toEqual(
      encode("<page>Apricot</page>")
    );
    expect(independent.find((member) => member.name === "deck/b.xml")?.payload).toEqual(
      encode("<page>Birch</page>")
    );
    expect(independent.find((member) => member.name === "deck/c.xml")?.payload).toEqual(
      encode("<page>Cedar</page>")
    );
    let offset = 0;
    const reader = await readPackage(
      {
        path: "/deck.zip",
        capability: {
          async openRead(path: string) {
            const bytes = new Uint8Array(volume.readFileSync(path) as Uint8Array);
            return {
              async read(maxBytes: number) {
                if (offset === bytes.length) return null;
                const chunk = bytes.slice(offset, offset + maxBytes);
                offset += chunk.length;
                return chunk;
              }
            };
          }
        }
      },
      context
    );
    expect(reader.has("/deck/a.xml")).toBe(true);
    expect(reader.has("/deck/missing.xml")).toBe(false);
    expect(() => reader.get("/deck/missing.xml")).toThrowError(
      expect.objectContaining({ code: "missing-binding" })
    );
    expect(reader.relsXmlFor("/deck/c.xml")).toBeNull();
    expect(reader.relsXmlFor("/deck/a.xml")).toEqual(members[5]!.bytes);
    expect(reader.relsXmlFor("/")).toEqual(members[1]!.bytes);
    const graph = readRelationshipGraph(reader, limits);
    expect(graph.closure(["/"])).toEqual(["/deck/a.xml", "/deck/b.xml", "/deck/c.xml"]);
    expect(graph.outgoing("/deck/a.xml")[1]).toEqual({
      owner: "/deck/a.xml",
      id: "rId2",
      type: "urn:example:external",
      target: "https://example.invalid/resource",
      external: true,
      targetPart: null
    });
  });
});
