import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  readRelationshipGraph,
  parseRelationships,
  relationshipGraph,
  importRelationships
} from "./relationships.js";

import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const limits = { maxBytes: 8192, maxRelationships: 100, maxParts: 100 };
const xml = (body: string) =>
  new TextEncoder().encode(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
  );
const rel = (id: string, target: string, external = false) => ({
  id,
  type: "urn:example:dependency",
  target,
  external
});
const parts = ["/deck/slides/a.xml", "/deck/layouts/b.xml", "/deck/media/c.bin", "/unused.xml"];
function graph() {
  return relationshipGraph(
    parts,
    [
      { owner: "/", relationships: [rel("rId1", "deck/slides/a.xml")] },
      {
        owner: parts[0]!,
        relationships: [
          rel("rId1", "../layouts/b.xml"),
          rel("rId2", "../MEDIA/c.bin"),
          rel("rId3", "https://example.invalid/deck", true)
        ]
      },
      {
        owner: parts[1]!,
        relationships: [rel("rId1", "../slides/a.xml"), rel("rId2", "../media/c.bin")]
      }
    ],
    limits
  );
}

describe("relationship graph", () => {
  it("preserves external relationship streams through package serialization", async () => {
    const context = {
      limits: { maxBytes: 8192, maxReads: 100, chunkBytes: 512 },
      archiveLimits: {
        maxArchiveBytes: 8192,
        maxEntryBytes: 4096,
        maxTotalBytes: 8192,
        maxMembers: 10,
        maxPathBytes: 256,
        maxDepth: 16,
        maxPaxBytes: 1024,
        maxTextBytes: 1024,
        chunkSize: 512
      }
    };
    const links = xml(
      '<Relationship Id="rId8" Type="urn:example:link" Target="https://example.invalid/a?x=1&amp;y=2#section" TargetMode="External"/>'
    );
    const members = [
      { name: "deck/a.xml", bytes: new TextEncoder().encode("<a/>") },
      { name: "deck/_rels/a.xml.rels", bytes: links }
    ];
    const bytes = await writePackageArchive(members, context, { compression: "store" });
    const entries = inspectZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(["deck/_rels/a.xml.rels", "deck/a.xml"]);
    expect(entries[0]!.payload).toEqual(links);
    const value = readRelationshipGraph(await readPackage(bytes, context), limits);
    expect(value.outgoing("/deck/a.xml")).toEqual([
      {
        id: "rId8",
        type: "urn:example:link",
        target: "https://example.invalid/a?x=1&y=2#section",
        external: true,
        owner: "/deck/a.xml",
        targetPart: null
      }
    ]);
    expect(value.closure(["/deck/a.xml"])).toEqual(["/deck/a.xml"]);
  });
  it("traverses a long cycle iteratively and bounds the combined imported edges", () => {
    const names = Array.from({ length: 1000 }, (_, i) => `/node${i}.xml`);
    const value = relationshipGraph(
      names,
      names.map((owner, i) => ({ owner, relationships: [rel("rId1", names[(i + 1) % 1000]!)] })),
      { ...limits, maxParts: 1000, maxRelationships: 1000 }
    );
    expect(value.closure(["/node0.xml"])).toEqual(names);
    expect(() =>
      importRelationships(graph(), graph(), [parts[0]!], { ...limits, maxRelationships: 6 })
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
  });
  it("indexes package streams without interpreting relationship parts as owners", async () => {
    const reader = await readPackage(
      storedArchive([
        { name: "deck/a.xml", bytes: new TextEncoder().encode("<a/>") },
        { name: "deck/b.xml", bytes: new TextEncoder().encode("<b/>") },
        {
          name: "_rels/.rels",
          bytes: xml('<Relationship Id="rId1" Type="urn:example:main" Target="deck/a.xml"/>')
        },
        {
          name: "deck/_rels/a.xml.rels",
          bytes: xml('<Relationship Id="rId1" Type="urn:example:child" Target="b.xml"/>')
        }
      ]),
      {
        limits: { maxBytes: 8192, maxReads: 100, chunkBytes: 512 },
        archiveLimits: {
          maxArchiveBytes: 8192,
          maxEntryBytes: 4096,
          maxTotalBytes: 8192,
          maxMembers: 10,
          maxPathBytes: 256,
          maxDepth: 16,
          maxPaxBytes: 1024,
          maxTextBytes: 1024,
          chunkSize: 512
        }
      }
    );
    const value = readRelationshipGraph(reader, limits);
    expect(value.parts).toEqual(["/deck/a.xml", "/deck/b.xml"]);
    expect(value.closure(["/"])).toEqual(["/deck/a.xml", "/deck/b.xml"]);
    expect(() => readRelationshipGraph(reader, { ...limits, maxBytes: 200 })).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
  });
  it("rejects reserved streams, part-prefix collisions and invalid root imports", () => {
    for (const names of [
      ["/a.xml", "/a.xml/b.xml"],
      ["/[Content_Types].xml"],
      ["/deck/_rels/a.xml.rels"]
    ]) {
      expect(() => relationshipGraph(names, [], limits)).toThrowError(
        expect.objectContaining({ code: "invalid-opc" })
      );
    }
    expect(() => importRelationships(graph(), graph(), ["/"], limits)).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
  });

  it.each([undefined, "Internal", "External"])(
    "parses target mode %s and preserves unknown kinds",
    (mode) => {
      const volume = new Volume();
      volume.writeFileSync(
        "/links",
        xml(
          `<Relationship Id="rId1" Type="urn:example:unknown" Target="other.xml"${mode ? ` TargetMode="${mode}"` : ""}/>`
        )
      );
      expect(
        parseRelationships(new Uint8Array(volume.readFileSync("/links") as Uint8Array), limits)
      ).toEqual([
        {
          id: "rId1",
          type: "urn:example:unknown",
          target: "other.xml",
          external: mode === "External"
        }
      ]);
    }
  );
  it("treats absent relationship streams as empty", () => {
    expect(parseRelationships(null, limits)).toEqual([]);
    expect(graph().outgoing("/unused.xml")).toEqual([]);
  });
  it("resolves owner-relative aliases and enumerates cycles once", () => {
    const value = graph();
    expect(value.closure(["/"])).toEqual([parts[0], parts[1], parts[2]]);
    expect(value.closure(["/DECK/layouts/b.xml", parts[0]!])).toEqual([
      parts[1],
      parts[0],
      parts[2]
    ]);
    expect(value.outgoing(parts[0]!)).toEqual([
      { ...rel("rId1", "../layouts/b.xml"), owner: parts[0], targetPart: parts[1] },
      { ...rel("rId2", "../MEDIA/c.bin"), owner: parts[0], targetPart: parts[2] },
      { ...rel("rId3", "https://example.invalid/deck", true), owner: parts[0], targetPart: null }
    ]);
    expect(value.incoming("/DECK/media/c.bin").map((e) => [e.owner, e.id])).toEqual([
      [parts[0], "rId2"],
      [parts[1], "rId2"]
    ]);
    expect(value.incoming(parts[0]!).map((e) => [e.owner, e.id])).toEqual([
      ["/", "rId1"],
      [parts[1], "rId1"]
    ]);
  });
  it("reports dangling edges without pretending external targets are parts", () => {
    const value = relationshipGraph(
      ["/a.xml"],
      [
        {
          owner: "/a.xml",
          relationships: [rel("rId1", "missing.xml"), rel("rId2", "file:///secret", true)]
        }
      ],
      limits
    );
    expect(value.dangling.map((e) => e.targetPart)).toEqual(["/missing.xml"]);
    expect(value.incoming("/missing.xml").map((e) => e.id)).toEqual(["rId1"]);
    expect(() => value.closure(["/a.xml"])).toThrowError(
      expect.objectContaining({ code: "missing-binding" })
    );
  });
  it("keeps IDs source-local and rejects duplicate owner or part aliases", () => {
    expect(graph().outgoing(parts[1]!)[0]?.id).toBe("rId1");
    expect(() => relationshipGraph(["/a.xml", "/A.XML"], [], limits)).toThrow();
    expect(() =>
      relationshipGraph(
        ["/a.xml"],
        [{ owner: "/a.xml", relationships: [rel("rId1", "a.xml"), rel("rId1", "a.xml")] }],
        limits
      )
    ).toThrow();
    expect(() =>
      relationshipGraph(
        ["/a.xml"],
        [
          { owner: "/a.xml", relationships: [] },
          { owner: "/A.XML", relationships: [] }
        ],
        limits
      )
    ).toThrow();
    expect(() =>
      relationshipGraph([], [{ owner: "/missing.xml", relationships: [] }], limits)
    ).toThrow();
  });
  it("snapshots caller arrays and exposes immutable graph data", () => {
    const relationships = [rel("rId1", "a.xml")];
    const value = relationshipGraph(["/a.xml"], [{ owner: "/", relationships }], limits);
    relationships[0]!.target = "missing.xml";
    expect(value.closure(["/"])).toEqual(["/a.xml"]);
    expect(Object.isFrozen(value.outgoing("/")[0])).toBe(true);
    expect(Object.isFrozen(value.outgoing("/"))).toBe(true);
  });
  it("imports a complete cyclic graph with deterministic collisions and source-local IDs", () => {
    const destination = relationshipGraph(
      [parts[0]!, "/deck/slides/a-import1.xml", parts[2]!],
      [],
      limits
    );
    const imported = importRelationships(destination, graph(), [parts[0]!], limits);
    expect(imported.mapping).toEqual([
      [parts[0], "/deck/slides/a-import2.xml"],
      [parts[1], parts[1]],
      [parts[2], "/deck/media/c-import1.bin"]
    ]);
    expect(imported.graph.closure(["/deck/slides/a-import2.xml"])).toEqual([
      "/deck/slides/a-import2.xml",
      "/deck/layouts/b.xml",
      "/deck/media/c-import1.bin"
    ]);
    expect(imported.graph.outgoing(parts[1]!)[0]).toMatchObject({
      id: "rId1",
      target: "../slides/a-import2.xml"
    });
    expect(imported.graph.outgoing("/deck/slides/a-import2.xml")[2]).toMatchObject({
      target: "https://example.invalid/deck",
      external: true
    });
    expect(destination.parts).toEqual([parts[0], "/deck/slides/a-import1.xml", parts[2]]);
    expect(imported.graph.parts).not.toContain("/unused.xml");
  });
  it("reserves noncolliding imported names before allocating collisions", () => {
    const source = relationshipGraph(["/a.xml", "/a-import1.xml"], [], limits);
    const destination = relationshipGraph(["/A.XML"], [], limits);
    expect(
      importRelationships(destination, source, ["/a.xml", "/a-import1.xml"], limits).mapping
    ).toEqual([
      ["/a.xml", "/a-import2.xml"],
      ["/a-import1.xml", "/a-import1.xml"]
    ]);
  });
  it("enforces explicit aggregate graph and XML limits", () => {
    expect(() => graph().closure(["/absent.xml"])).toThrow();
    expect(() => relationshipGraph(parts, [], { ...limits, maxParts: 2 })).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
    expect(() =>
      relationshipGraph(
        ["/a.xml"],
        [{ owner: "/", relationships: [rel("rId1", "a.xml"), rel("rId2", "a.xml")] }],
        { ...limits, maxRelationships: 1 }
      )
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
    expect(() => parseRelationships(xml(""), { ...limits, maxBytes: 1 })).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
  });
  it.each([
    '<Relationship Id="x" Type="urn:t" Target="a" TargetMode="Other"/>',
    '<Relationship Id="x" Type="urn:t"/>',
    '<Relationship Id="x" Type="urn:t" Target="a"/><Relationship Id="x" Type="urn:t" Target="b"/>',
    '<Relationship Id="x" Type="urn:t" Target="a"><nested/></Relationship>',
    '<Relationship Id="x" Type="urn:t" Target="a" unexpected="yes"/>',
    "text",
    "<![CDATA[text]]>"
  ])("rejects malformed relationship XML %s", (body) => {
    expect(() => parseRelationships(xml(body), limits)).toThrowError(
      expect.objectContaining({ code: "invalid-opc" })
    );
  });
  it("rejects DTDs and malformed XML without entity or network access", () => {
    expect(() =>
      parseRelationships(
        new TextEncoder().encode('<!DOCTYPE x SYSTEM "https://example.invalid/entity"><x/>'),
        limits
      )
    ).toThrow();
    expect(() => parseRelationships(Uint8Array.of(255), limits)).toThrow();
  });
});
