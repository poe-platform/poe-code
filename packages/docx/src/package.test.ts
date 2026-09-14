import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  readDocumentArchive,
  writeArchive,
  normalizePartName,
  resolvePartTarget,
  relativePartTarget,
  type ArchiveLimits,
  type ArchiveMember
} from "./index.js";

const context = {
  signal: new AbortController().signal,
  limits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 16384,
    maxTotalBytes: 60000,
    maxMembers: 40,
    maxPathBytes: 256,
    maxDepth: 16,
    maxExtraBytes: 0,
    maxCommentBytes: 0,
    maxRetainedBytes: 4 * 1024 * 1024,
    chunkSize: 512
  } satisfies ArchiveLimits
};
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const relType = "application/vnd.openxmlformats-package.relationships+xml";
const mainType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const main = "reports/main%20notes.xml";
const encoder = new TextEncoder();
const relationships = (body: string) => `<Relationships xmlns="${pr}">${body}</Relationships>`;
const rel = (id: string, target: string, extra = "", type = "urn:original:resource") =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}" ${extra}/>`;
function fixture() {
  return new Map<string, string | Uint8Array>([
    [
      "[Content_Types].xml",
      `<Types xmlns="${ct}"><Default Extension="rels" ContentType="${relType}"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="application/x-original-data"/><Override PartName="/${main}" ContentType="${mainType}"/></Types>`
    ],
    [
      "_rels/.rels",
      relationships(
        rel(
          "rId1",
          main,
          "",
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
        )
      )
    ],
    [
      main,
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'
    ],
    [
      "reports/_rels/main%20notes.xml.rels",
      relationships(rel("rId1", "../assets/shared.dat") + rel("rId3", "side.xml"))
    ],
    ["reports/side.xml", "<side/>"],
    [
      "reports/_rels/side.xml.rels",
      relationships(rel("rId1", "../assets/shared.dat") + rel("rId2", "main%20notes.xml"))
    ],
    ["assets/shared.dat", Uint8Array.of(4, 8, 15, 16)],
    [
      "unknown/record.xml",
      '<record xmlns="urn:original:opaque"><!--keep--><?audit retained?>untouched</record>'
    ]
  ]);
}
async function serialize(parts: Map<string, string | Uint8Array>) {
  const members: ArchiveMember[] = [...parts].map(([name, value]) => ({
    name,
    bytes: typeof value === "string" ? encoder.encode(value) : value,
    directory: false,
    modified: new Date("2025-01-02T03:04:06Z")
  }));
  return repack(members);
}
async function repack(members: readonly ArchiveMember[]) {
  const fs = Volume.fromJSON({ "/out": "" });
  await writeArchive(
    { members, comment: new Uint8Array() },
    {
      async write(bytes) {
        fs.appendFileSync("/out", bytes);
      }
    },
    { order: "input", compression: "store" },
    context
  );
  return new Uint8Array(fs.readFileSync("/out") as Uint8Array);
}

describe("ordered document package graph", () => {
  it("resolves a nonstandard main, overrides, defaults, cycles and shared resources", async () => {
    const parts = fixture();
    const result = await readDocumentArchive(await serialize(parts), context);
    expect(result.mainPart).toBe(main);
    const graph = result.package;
    expect(graph.parts.map((part) => part.name)).toEqual([...parts.keys()].slice(1));
    expect(graph.defaults.map((value) => value.extension)).toEqual(["rels", "xml", "dat"]);
    expect(graph.overrides).toEqual([{ partname: `/${main}`, content_type: mainType }]);
    expect(graph.getPart(`/${main}`).content_type).toBe(mainType);
    expect(graph.getPart("/unknown/record.xml").content_type).toBe("application/xml");
    const edges = graph.relationships(`/${main}`);
    expect(edges.map((edge) => edge.rId)).toEqual(["rId1", "rId3"]);
    expect(edges[0]!.target_part).toBe(graph.relationships("/reports/side.xml")[0]!.target_part);
    expect(edges[0]!.target_ref).toBe("../assets/shared.dat");
    expect([...graph.iterParts()].map((part) => part.name)).toEqual([
      main,
      "assets/shared.dat",
      "reports/side.xml"
    ]);
    expect(graph.relationships("/unknown/record.xml")).toEqual([]);
  });

  it("retains unknown declarations and all unrelated bytes when one payload changes", async () => {
    const result = await readDocumentArchive(await serialize(fixture()), context);
    const changed = result.members.map((member) =>
      member.name === "reports/side.xml"
        ? { ...member, bytes: encoder.encode('<side status="checked"/>') }
        : member
    );
    const reopened = await readDocumentArchive(await repack(changed), context);
    for (const member of result.members) {
      if (member.name !== "reports/side.xml")
        expect(reopened.members.find((item) => item.name === member.name)!.bytes).toEqual(
          member.bytes
        );
    }
    expect(reopened.package.relationships(`/${main}`)[0]!.target_part).toBe(
      reopened.package.relationships("/reports/side.xml")[0]!.target_part
    );
  });

  it.each([
    "",
    "https://outside.invalid/a?token=opaque#x",
    "file:///private/item",
    "../outside",
    "javascript:inert()"
  ])("keeps external target %s as inert data", async (target) => {
    const parts = fixture();
    parts.set(
      "reports/_rels/main%20notes.xml.rels",
      relationships(rel("rId1", target, 'TargetMode="External"'))
    );
    const result = await readDocumentArchive(await serialize(parts), context);
    const edge = result.package.relationships(`/${main}`)[0]!;
    expect(edge.is_external).toBe(true);
    expect(edge.target_ref).toBe(target);
    expect(() => edge.target_part).toThrowError(expect.objectContaining({ code: "usage" }));
  });

  it.each([
    ["missing target", relationships('<Relationship Id="rId1" Type="urn:original:resource"/>')],
    ["duplicate IDs", relationships(rel("rId1", "side.xml") + rel("rId1", "../assets/shared.dat"))],
    ["dangling targets", relationships(rel("rId1", "absent.xml"))],
    ["invalid mode", relationships(rel("rId1", "side.xml", 'TargetMode="Remote"'))],
    ["invalid ID", relationships(rel("1bad", "side.xml"))],
    ["xml base", relationships(rel("rId1", "side.xml", 'xml:base="/other/"'))],
    ["relationship target", relationships(rel("rId1", "_rels/side.xml.rels"))],
    ["absolute internal URI", relationships(rel("rId1", "https://outside.invalid/side.xml"))],
    ["internal query", relationships(rel("rId1", "side.xml?value=1"))],
    ["malformed child", `<Relationships xmlns="${pr}"><Other/></Relationships>`]
  ])("rejects owner relationship %s", async (_label, content) => {
    const parts = fixture();
    parts.set("reports/_rels/main%20notes.xml.rels", content);
    await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
      code: "invalid-package"
    });
  });

  it.each([
    ["orphan relationship owner", "ghost/_rels/absent.xml.rels", relationships("")],
    ["case collision", "REPORTS/SIDE.XML", "<side/>"],
    ["derived part name", "reports/side.xml/child.xml", "<child/>"],
    ["encoded unreserved", "reports/%73ide.xml", "<side/>"],
    ["encoded slash", "reports/a%2Fb.xml", "<side/>"],
    ["NFC collision", "unknown/cafe%CC%81.xml", "<side/>"]
  ])("rejects %s", async (label, name, content) => {
    const parts = fixture();
    if (label === "NFC collision") parts.set("unknown/caf%C3%A9.xml", "<side/>");
    parts.set(name, content);
    await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
      code: "invalid-package"
    });
  });

  it("keeps non-ASCII case distinct and percent-encoded reserved characters distinct", async () => {
    const parts = fixture();
    for (const name of [
      "assets/%C3%89.dat",
      "assets/%C3%A9.dat",
      "assets/a%3Bb.dat",
      "assets/a;b.dat"
    ])
      parts.set(name, Uint8Array.of(7));
    const graph = (await readDocumentArchive(await serialize(parts), context)).package;
    expect(graph.getPart("/assets/É.dat")).not.toBe(graph.getPart("/assets/é.dat"));
    expect(graph.getPart("/assets/a%3bb.dat")).not.toBe(graph.getPart("/assets/a;b.dat"));
  });

  it("retains internal fragments while resolving only the target part", async () => {
    const parts = fixture();
    parts.set(
      "reports/_rels/main%20notes.xml.rels",
      relationships(rel("rId1", "../assets/shared.dat#section./item%2Fdetail?view"))
    );
    const graph = (await readDocumentArchive(await serialize(parts), context)).package;
    const edge = graph.relationships(`/${main}`)[0]!;
    expect(edge.fragment).toBe("section./item%2Fdetail?view");
    expect(edge.target_part).toBe(graph.getPart("/assets/shared.dat"));
  });

  it("resolves an empty internal target to its owner and visits the self-cycle once", async () => {
    const parts = fixture();
    parts.set("reports/_rels/main%20notes.xml.rels", relationships(rel("rId1", "")));
    const result = await readDocumentArchive(await serialize(parts), context);
    const owner = result.package.getPart(`/${main}`);
    const edge = result.package.relationships(`/${main}`)[0]!;
    expect(edge.target_ref).toBe("");
    expect(edge.fragment).toBeNull();
    expect(edge.target_part).toBe(owner);
    expect([...result.package.iterParts()]).toEqual([owner]);
  });

  it("rejects an empty internal package-root target because it identifies no part", async () => {
    const parts = fixture();
    parts.set("_rels/.rels", relationships(rel("rId1", "")));
    await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
      code: "invalid-package"
    });
  });

  it.each(["[Content_Types].xml", "reports/_rels/side.xml.rels"])(
    "rejects non-whitespace metadata text in %s",
    async (name) => {
      const parts = fixture();
      const value = parts.get(name) as string;
      const end = value.lastIndexOf("</");
      parts.set(name, value.slice(0, end) + "stray text" + value.slice(end));
      await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
        code: "invalid-package"
      });
    }
  );

  it.each(["[Content_Types].xml", "_rels/.rels", main, "assets/shared.dat"])(
    "requires %s",
    async (name) => {
      const parts = fixture();
      parts.delete(name);
      await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
        code: "invalid-package"
      });
    }
  );

  it("rejects duplicate default declarations by ASCII case", async () => {
    const parts = fixture();
    parts.set(
      "[Content_Types].xml",
      `<Types xmlns="${ct}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="XML" ContentType="application/x-other"/></Types>`
    );
    await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
      code: "invalid-package"
    });
  });

  it("rejects relationship parts with a non-relationship content type", async () => {
    const parts = fixture();
    parts.set(
      "[Content_Types].xml",
      `<Types xmlns="${ct}"><Default Extension="rels" ContentType="application/xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="application/octet-stream"/><Override PartName="/${main}" ContentType="${mainType}"/></Types>`
    );
    await expect(readDocumentArchive(await serialize(parts), context)).rejects.toMatchObject({
      code: "invalid-package"
    });
  });

  it("preserves unfamiliar extension defaults and original media-type spelling", async () => {
    const parts = fixture();
    const declaration = parts.get("[Content_Types].xml") as string;
    parts.set(
      "[Content_Types].xml",
      declaration.slice(0, -8) +
        '<Default Extension="dat+v2" ContentType="application/x-original;revision=2"/></Types>'
    );
    parts.set("assets/catalog.dat+v2", Uint8Array.of(2));
    const graph = (await readDocumentArchive(await serialize(parts), context)).package;
    expect(graph.getPart("/assets/catalog.dat+v2").content_type).toBe(
      "application/x-original;revision=2"
    );
  });

  it("compares known media types case-insensitively without rewriting their spelling", async () => {
    const parts = fixture();
    parts.set(
      "[Content_Types].xml",
      `<Types xmlns="${ct}"><Default Extension="RELS" ContentType="${relType.toUpperCase()}"/><Default Extension="XML" ContentType="application/xml"/><Default Extension="DAT" ContentType="application/octet-stream"/><Override PartName="/${main}" ContentType="${mainType.toUpperCase()}"/></Types>`
    );
    const result = await readDocumentArchive(await serialize(parts), context);
    expect(result.kind).toBe("docx");
    expect(result.package.getPart(`/${main}`).content_type).toBe(mainType.toUpperCase());
  });

  it("keeps new name reservations within the admitted member and path ceilings", async () => {
    const parts = fixture();
    const result = await readDocumentArchive(await serialize(parts), {
      ...context,
      limits: { ...context.limits, maxMembers: parts.size + 1 }
    });
    expect(result.package.allocatePartName("/assets/item", ".dat")).toBe("/assets/item1.dat");
    expect(() => result.package.allocatePartName("/assets/item", ".dat")).toThrowError(
      expect.objectContaining({ code: "limit-exceeded" })
    );
    const graph = (await readDocumentArchive(await serialize(parts), context)).package;
    expect(() => graph.allocatePartName("/" + "n".repeat(257), ".xml")).toThrowError(
      expect.objectContaining({ code: "limit-exceeded" })
    );
    expect(() => graph.allocatePartName("/" + "a/".repeat(17), ".xml")).toThrowError(
      expect.objectContaining({ code: "limit-exceeded" })
    );
  });

  it("does not coerce part allocation arguments", async () => {
    const graph = (await readDocumentArchive(await serialize(fixture()), context)).package;
    expect(() =>
      graph.allocatePartName("/assets/item", undefined as unknown as string)
    ).toThrowError(expect.objectContaining({ code: "usage" }));
  });

  it("reserves relationship IDs per owner and part names across the package", async () => {
    const graph = (await readDocumentArchive(await serialize(fixture()), context)).package;
    expect(graph.allocateRelationshipId(`/${main}`)).toBe("rId2");
    expect(graph.allocateRelationshipId(`/${main}`)).toBe("rId4");
    expect(graph.allocateRelationshipId("/reports/side.xml")).toBe("rId3");
    expect(graph.allocateRelationshipId("/")).toBe("rId2");
    expect(() => graph.allocateRelationshipId("/missing.xml")).toThrow();
    expect(graph.allocatePartName("/assets/item", ".dat")).toBe("/assets/item1.dat");
    expect(graph.allocatePartName("/ASSETS/ITEM", ".DAT")).toBe("/ASSETS/ITEM2.DAT");
  });

  it.each([
    [[], 1],
    [[1], 2],
    [[1, 2], 3],
    [[2, 3], 1],
    [[1, 3], 2]
  ] as const)("fills the first unused package number for %j", async (numbers, expected) => {
    const parts = fixture();
    for (const number of numbers) parts.set(`assets/item${number}.dat`, Uint8Array.of(number));
    const graph = (await readDocumentArchive(await serialize(parts), context)).package;
    expect(graph.allocatePartName("/assets/item", ".dat")).toBe(`/assets/item${expected}.dat`);
  });
});

describe("OPC part URI semantics", () => {
  it.each([
    ["/Reports/main%20notes.xml", "/Reports/main%20notes.xml"],
    ["/assets/caf%C3%A9.dat", "/assets/café.dat"],
    ["/assets/a%3bb.dat", "/assets/a%3Bb.dat"]
  ])("normalizes %s without decoding reserved characters", (input, expected) => {
    expect(normalizePartName(input)).toBe(expected);
  });
  it.each([
    "relative.xml",
    "/a//b",
    "/a/../b",
    "/a./b",
    "/a%2fb",
    "/%61",
    "/a%",
    "/a?x",
    "/a#x",
    "/a b",
    "/a%5Cb",
    "/a%00b"
  ])("rejects invalid part URI %s", (input) =>
    expect(() => normalizePartName(input)).toThrowError(
      expect.objectContaining({ code: "invalid-package" })
    )
  );
  it.each([
    ["/reports/side.xml", "../assets/shared.dat#sample", "/assets/shared.dat", "sample"],
    ["/reports/side.xml", "#anchor", "/reports/side.xml", "anchor"],
    ["/reports/side.xml", "/assets/shared.dat", "/assets/shared.dat", null],
    ["/reports/side.xml", "./%73ide.xml", "/reports/side.xml", null],
    ["/", "../../reports/side.xml", "/reports/side.xml", null]
  ])("resolves %s and %s", (owner, target, partname, fragment) => {
    expect(resolvePartTarget(owner, target)).toEqual({ partname, fragment });
  });
  it("generates a relative encoded target with no host path semantics", () => {
    expect(relativePartTarget("/reports/side.xml", "/assets/café.dat")).toBe(
      "../assets/caf%C3%A9.dat"
    );
    expect(relativePartTarget("/", "/assets/shared.dat")).toBe("assets/shared.dat");
    expect(relativePartTarget("/reports/side.xml", "/reports/side.xml")).toBe("side.xml");
  });
});
