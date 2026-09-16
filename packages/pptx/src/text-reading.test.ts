import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readPresentationText, readSelectionIndex } from "./index.js";
const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 65536,
    maxMembers: 50,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 50, maxRelationships: 50 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const shape = (id: number, paragraphs: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Repeated"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${paragraphs}</p:txBody></p:sp>`;
const run = (text: string) => `<a:r><a:t>${text}</a:t></a:r>`;
function fixture(
  first = shape(4, `<a:p>${run("Coast")}</a:p>`),
  strict = false,
  extra: Record<string, string> = {}
) {
  const rels = (items: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
  const edge = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const drawing = (root: string, content: string, attrs = "") =>
    `<p:${root} xmlns:p="${p}" xmlns:a="${a}" ${attrs}><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:${root}>`;
  const parts = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    "_rels/.rels": rels(edge("main", "officeDocument", "deck.xml")),
    "deck.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="300" r:id="late"/><p:sldId id="301" r:id="early"/></p:sldIdLst></p:presentation>`,
    "_rels/deck.xml.rels": rels(edge("late", "slide", "z.xml") + edge("early", "slide", "a.xml")),
    "z.xml": drawing("sld", first, 'show="0"'),
    "a.xml": drawing("sld", shape(4, `<a:p>${run("End")}</a:p>`)),
    "_rels/z.xml.rels": rels(
      edge("notes", "notesSlide", "notes.xml") + edge("layout", "slideLayout", "layout.xml")
    ),
    "notes.xml": drawing("notes", shape(4, `<a:p>${run("Speaker")}</a:p>`)),
    "layout.xml": drawing("sldLayout", shape(4, `<a:p>${run("Layout")}</a:p>`)),
    "_rels/layout.xml.rels": rels(edge("master", "slideMaster", "master.xml")),
    "master.xml": drawing("sldMaster", shape(4, `<a:p>${run("Master")}</a:p>`))
  };
  const bytes = storedArchive(
    Object.entries({ ...parts, ...extra }).map(([name, xml]) => ({
      name,
      bytes: new TextEncoder().encode(
        strict
          ? xml
              .split(p)
              .join("http://purl.oclc.org/ooxml/presentationml/main")
              .split(a)
              .join("http://purl.oclc.org/ooxml/drawingml/main")
              .split(r)
              .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
          : xml
      )
    }))
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", bytes);
  return new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer);
}
describe("structural text reading", () => {
  it.each([
    ["", "", []],
    [run(""), "", [{ kind: "run", text: "" }]],
    [run("港 🐚 é &amp;"), "港 🐚 é &", [{ kind: "run", text: "港 🐚 é &" }]],
    [
      `${run("A")}<a:br/>${run("B")}`,
      "A\vB",
      [
        { kind: "run", text: "A" },
        { kind: "break", text: "\v" },
        { kind: "run", text: "B" }
      ]
    ],
    [
      '<a:fld id="clock" type="datetime"><a:t>Yesterday</a:t></a:fld>',
      "Yesterday",
      [{ kind: "field", cachedText: "Yesterday", fieldId: "clock", fieldType: "datetime" }]
    ],
    ["<a:fld/>", "", [{ kind: "field", cachedText: "", fieldId: null, fieldType: null }]],
    [
      `${run("North")}${run("South")}`,
      "NorthSouth",
      [
        { kind: "run", text: "North" },
        { kind: "run", text: "South" }
      ]
    ],
    [
      `${run("N")}<a:fld id="x" type="slidenum"><a:t>8</a:t></a:fld>${run("S")}`,
      "N8S",
      [
        { kind: "run", text: "N" },
        { kind: "field", cachedText: "8", fieldId: "x", fieldType: "slidenum" },
        { kind: "run", text: "S" }
      ]
    ],
    [
      `${run(" N")}<a:br/><a:fld id="x"><a:t> 8</a:t></a:fld>`,
      " N\v 8",
      [
        { kind: "run", text: " N" },
        { kind: "break", text: "\v" },
        { kind: "field", cachedText: " 8", fieldId: "x", fieldType: null }
      ]
    ],
    [
      `<a:pPr lvl="1"/>${run(" Styled ")}<a:endParaRPr b="1"/>`,
      " Styled ",
      [{ kind: "run", text: " Styled " }]
    ],
    ["<a:br/>", "\v", [{ kind: "break", text: "\v" }]],
    [
      `${run("Dune")}<a:br/>${run("Bay")}<a:br/>${run("Cape")}`,
      "Dune\vBay\vCape",
      [
        { kind: "run", text: "Dune" },
        { kind: "break", text: "\v" },
        { kind: "run", text: "Bay" },
        { kind: "break", text: "\v" },
        { kind: "run", text: "Cape" }
      ]
    ],
    [
      `${run("One")}${run("Two")}${run("Three")}`,
      "OneTwoThree",
      [
        { kind: "run", text: "One" },
        { kind: "run", text: "Two" },
        { kind: "run", text: "Three" }
      ]
    ],
    [
      "<a:br/><a:br/>",
      "\v\v",
      [
        { kind: "break", text: "\v" },
        { kind: "break", text: "\v" }
      ]
    ]
  ])("retains paragraph inline values %#", async (xml, text, inlines) => {
    const result = await readPresentationText(
      fixture(shape(4, `<a:p>${xml}</a:p>`)),
      { select: { kind: "slide", id: "300" } },
      context
    );
    expect(result).toMatchObject({
      text,
      order: "structural",
      segments: [
        { text, paragraphs: [{ index: 0, coordinateSystem: "zero-based", text, inlines }] }
      ]
    });
    expect(result.segments).toHaveLength(1);
  });
  it("preserves hidden slide-list order, grouped shape order, duplicate placeholders and empty paragraphs", async () => {
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="Group"/></p:nvGrpSpPr>${shape(9, `<a:p>${run("Nested")}</a:p><a:p/>`)}</p:grpSp>`;
    const result = await readPresentationText(
      fixture(
        shape(4, `<a:p>${run("First")}</a:p>`) + group + shape(10, `<a:p>${run("Last")}</a:p>`)
      ),
      {},
      context
    );
    expect(result.text).toBe("First\nNested\n\nLast\nEnd");
    expect(result.segments.map((s) => [s.location.owner, s.location.objectId, s.text])).toEqual([
      ["/z.xml", "4", "First"],
      ["/z.xml", "9", "Nested\n"],
      ["/z.xml", "10", "Last"],
      ["/a.xml", "4", "End"]
    ]);
  });
  it("reads table cells in row-major order at their shape-tree position", async () => {
    const cell = (text: string) => `<a:tc><a:txBody><a:p>${run(text)}</a:p></a:txBody></a:tc>`;
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Grid"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr>${cell("R1")}${cell("")}</a:tr><a:tr>${cell("R2")}${cell("港")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const result = await readPresentationText(
      fixture(table),
      { select: { kind: "slide", id: "300" } },
      context
    );
    expect(result.text).toBe("R1\n\nR2\n港");
    expect(result.segments.map((s) => s.cell)).toEqual([
      { coordinateSystem: "zero-based", row: 0, column: 0 },
      { coordinateSystem: "zero-based", row: 0, column: 1 },
      { coordinateSystem: "zero-based", row: 1, column: 0 },
      { coordinateSystem: "zero-based", row: 1, column: 1 }
    ]);
  });
  it.each([
    ["notes", "Speaker"],
    ["layouts", "Layout"],
    ["masters", "Master"]
  ] as const)("reads only explicitly selected %s", async (scope, text) => {
    const bytes = fixture();
    expect(
      (await readPresentationText(bytes, { scope, select: { kind: "slide", id: "300" } }, context))
        .text
    ).toBe(text);
    expect(
      (await readPresentationText(bytes, { scope, select: { kind: "slide", id: "301" } }, context))
        .text
    ).toBe("");
    expect((await readPresentationText(bytes, {}, context)).text).toBe("Coast\nEnd");
  });
  it("resolves object tokens and rejects stale identities and cross-scope objects", async () => {
    const bytes = fixture(),
      index = await readSelectionIndex(bytes, context);
    const selected = index.objects.find((x) => x.part === "/z.xml")!;
    expect(
      (await readPresentationText(bytes, { select: { token: selected.token } }, context)).text
    ).toBe("Coast");
    await expect(
      readPresentationText(
        fixture(shape(4, "<a:p/>")),
        { select: { token: selected.token } },
        context
      )
    ).rejects.toMatchObject({ code: "stale-selection" });
    await expect(
      readPresentationText(bytes, { scope: "notes", select: { token: selected.token } }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
  });
  it.each([
    [0, ""],
    [1, "Section 1"],
    [2, "Section 1\nSection 2"],
    [3, "Section 1\nSection 2\nSection 3"]
  ] as const)("retains %i paragraph frames", async (count, expected) => {
    const xml = Array.from(
      { length: count },
      (_, index) => `<a:p>${run(`Section ${index + 1}`)}</a:p>`
    ).join("");
    const result = await readPresentationText(
      fixture(shape(4, xml)),
      { select: { kind: "slide", id: "300" } },
      context
    );
    expect(result.segments[0]?.paragraphs).toHaveLength(count);
    expect(result.text).toBe(expected);
  });
  it("reads Strict text and selects one compatibility branch without duplicate fallback content", async () => {
    const alternate = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:future"><mc:Choice Requires="u">${shape(90, `<a:p>${run("Unknown")}</a:p>`)}</mc:Choice><mc:Choice Requires="a">${shape(91, `<a:p>${run("Selected")}</a:p>`)}</mc:Choice><mc:Fallback>${shape(92, `<a:p>${run("Fallback")}</a:p>`)}</mc:Fallback></mc:AlternateContent>`;
    const result = await readPresentationText(
      fixture(alternate, true),
      { select: { kind: "slide", id: "300" } },
      context
    );
    expect(result.text).toBe("Selected");
    expect(result.segments.map((segment) => segment.location.objectId)).toEqual(["91"]);
  });
  it("selects a nested group subtree without sibling or duplicate descendant text", async () => {
    const group = (id: number, content: string) =>
      `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group"/></p:nvGrpSpPr>${content}</p:grpSp>`;
    const bytes = fixture(
      group(
        7,
        shape(8, `<a:p>${run("Outside")}</a:p>`) +
          group(9, shape(10, `<a:p>${run("Inside")}</a:p>`))
      )
    );
    const index = await readSelectionIndex(bytes, context);
    expect(
      (
        await readPresentationText(
          bytes,
          { select: { token: index.objects.find((item) => item.id === "9")!.token } },
          context
        )
      ).text
    ).toBe("Inside");
  });
  it("admits an explicit byte source once and leaves its bytes unchanged", async () => {
    const bytes = fixture(),
      original = bytes.slice();
    let reads = 0;
    const input = {
      path: "/deck.pptx",
      capability: {
        async openRead() {
          reads++;
          let offset = 0;
          return {
            async read(max: number) {
              if (offset === bytes.length) return null;
              const chunk = bytes.slice(offset, offset + max);
              offset += chunk.length;
              return chunk;
            }
          };
        }
      }
    };
    expect((await readPresentationText(input, {}, context)).text).toBe("Coast\nEnd");
    expect(reads).toBe(1);
    expect(bytes).toEqual(original);
  });
  it("rejects invalid options before admitting input", async () => {
    const input = {
      async read(): Promise<Uint8Array | null> {
        throw new Error("Input must not be read");
      }
    };
    await expect(
      readPresentationText(input, { scope: null as never }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    await expect(
      readPresentationText(input, { scope: "shared" as never }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("narrows named shapes within explicitly selected owners and reports duplicates", async () => {
    const bytes = fixture(shape(4, `<a:p>${run("A")}</a:p>`) + shape(5, `<a:p>${run("B")}</a:p>`));
    expect(
      (
        await readPresentationText(
          bytes,
          { scope: "notes", select: { kind: "slide", id: "300" }, shape: "Repeated" },
          context
        )
      ).text
    ).toBe("Speaker");
    await expect(
      readPresentationText(
        bytes,
        { select: { kind: "slide", id: "300" }, shape: "Repeated" },
        context
      )
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    await expect(
      readPresentationText(
        bytes,
        { select: { kind: "slide", id: "300" }, shape: "Missing" },
        context
      )
    ).rejects.toMatchObject({
      code: "missing-selection"
    });
  });
  it("reads shared layouts once and orders linked layouts by selected slide list", async () => {
    const relationships = (target: string) =>
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="layout" Type="${r}/slideLayout" Target="${target}"/></Relationships>`;
    const shared = fixture(undefined, false, { "_rels/a.xml.rels": relationships("layout.xml") });
    expect((await readPresentationText(shared, { scope: "layouts" }, context)).text).toBe("Layout");
    const distinct = fixture(undefined, false, {
      "_rels/a.xml.rels": relationships("first-layout.xml"),
      "first-layout.xml": `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${shape(4, `<a:p>${run("Second linked")}</a:p>`)}</p:spTree></p:cSld></p:sldLayout>`
    });
    expect((await readPresentationText(distinct, { scope: "layouts" }, context)).text).toBe(
      "Layout\nSecond linked"
    );
  });
  it("rejects named shape requests without one explicit slide", async () => {
    const bytes = fixture(),
      index = await readSelectionIndex(bytes, context);
    for (const options of [
      { shape: "Repeated" },
      { shape: "", select: { kind: "slide" as const, id: "300" } },
      { shape: "Repeated", select: { token: index.slides[0]!.token } },
      { shape: "Repeated", select: { kind: "slide" as const, all: true } }
    ])
      await expect(readPresentationText(bytes, options, context)).rejects.toMatchObject({
        code: "invalid-selection"
      });
  });

  it("retains table ancestor compatibility rules and ignores opaque extension payloads", async () => {
    const table = `<p:graphicFrame xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:detail" mc:Ignorable="v"><p:nvGraphicFramePr><p:cNvPr id="6" name="Grid"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="${a}/table"><a:tbl v:marker="retained"><a:tr><a:tc><a:txBody><a:p><a:fld id="number"><a:t>42</a:t></a:fld></a:p></a:txBody></a:tc></a:tr><a:extLst><a:ext uri="urn:payload"><v:data/></a:ext></a:extLst></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const result = await readPresentationText(
      fixture(table),
      { select: { kind: "slide", id: "300" } },
      context
    );
    expect(result.text).toBe("42");
    expect(result.segments[0]?.paragraphs[0]?.inlines).toEqual([
      { kind: "field", cachedText: "42", fieldId: "number", fieldType: null }
    ]);
  });
});
