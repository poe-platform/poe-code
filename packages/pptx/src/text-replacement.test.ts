import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { Volume } from "memfs";
import {
  createPresentation,
  replacePresentationText,
  readPresentationText,
  readSelectionIndex
} from "./index.js";
import { writePackageArchive } from "./package-writer.js";
import { inspectZip } from "../tests/zip-reader.js";
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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const run = (text: string, style = "") => `<a:r>${style}<a:t>${text}</a:t></a:r>`;
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
async function fixture(paragraphs: string, extraShapes = "", hyperlink = false) {
  const source = await createPresentation({ slides: [{}, {}] }, context);
  const members = inspectZip(source).map((entry) => ({ name: entry.name, bytes: entry.payload }));
  const slide = members.find((entry) => entry.name === "ppt/slides/slide1.xml")!;
  slide.bytes = encode(
    decode(slide.bytes).replace(
      "</p:spTree>",
      `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Caption"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>${extraShapes}</p:spTree>`
    )
  );
  if (hyperlink) {
    const rels = members.find((entry) => entry.name === "ppt/slides/_rels/slide1.xml.rels")!;
    rels.bytes = encode(
      decode(rels.bytes).replace(
        "</Relationships>",
        '<Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/garden" TargetMode="External"/></Relationships>'
      )
    );
  }
  const volume = Volume.fromJSON({});
  volume.writeFileSync(
    "/source.pptx",
    await writePackageArchive(members, context, { compression: "store" })
  );
  return new Uint8Array(volume.readFileSync("/source.pptx") as Buffer);
}
function slide(bytes: Uint8Array) {
  return decode(inspectZip(bytes).find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload);
}
describe("literal text replacement", () => {
  it("joins adjacent runs and preserves first style and untouched suffix markup", async () => {
    const bold = '<a:rPr b="1" lang="ar-SA"/>',
      italic = '<a:rPr i="1"/>';
    const source = await fixture(
      `<a:p>${run("keep red", bold)}${run(" blue tail", italic)}${run(" spare", '<a:rPr u="sng"/>')}</a:p>`
    );
    const result = await replacePresentationText(
      source,
      { find: "red blue", with: "green", all: true },
      context
    );
    expect(result.affected).toBe(1);
    expect(result.locations).toHaveLength(1);
    expect(slide(result.bytes)).toContain(
      run("keep green", bold) + run(" tail", italic) + run(" spare", '<a:rPr u="sng"/>')
    );
    const before = inspectZip(source),
      after = inspectZip(result.bytes);
    for (const part of before.filter((entry) => entry.name !== "ppt/slides/slide1.xml"))
      expect(after.find((entry) => entry.name === part.name)!.payload).toEqual(part.payload);
  });

  it("overrides only replacement style and retains inherited run metadata", async () => {
    const source = await fixture(
      `<a:p>${run("keep red", '<a:rPr b="1" lang="ar-SA" xmlns:k="urn:custom" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="k" k:flag="retain"/>')}${run(" blue tail", '<a:rPr i="1"/>')}</a:p>`
    );
    const result = await replacePresentationText(
      source,
      { find: "red blue", with: "green", all: true, style: { bold: false, italic: true } },
      context
    );
    const runs: { text: string; attrs: Record<string, string> }[] = [];
    const parser = new SaxesParser({ xmlns: true });
    let current: { text: string; attrs: Record<string, string> } | undefined;
    parser.on("opentag", (tag) => {
      if (tag.local === "r") {
        current = { text: "", attrs: {} };
        runs.push(current);
      }
      if (tag.local === "rPr" && current)
        current.attrs = Object.fromEntries(
          Object.values(tag.attributes).map((attr) => [attr.name, attr.value])
        );
    });
    parser.on("text", (text) => {
      if (current) current.text += text;
    });
    parser.on("closetag", (tag) => {
      if (tag.local === "r") current = undefined;
    });
    parser.write(slide(result.bytes)).close();
    expect(runs).toMatchObject([
      { text: "keep ", attrs: { b: "1", lang: "ar-SA", "k:flag": "retain" } },
      { text: "green", attrs: { b: "0", i: "1", lang: "ar-SA", "k:flag": "retain" } },
      { text: " tail", attrs: { i: "1" } }
    ]);
  });

  it("retains hyperlinks on the first affected run and unaffected trailing runs", async () => {
    const style = '<a:rPr b="1"><a:hlinkClick r:id="link" tooltip="Garden"/></a:rPr>';
    const trailing = run(" untouched", style);
    const source = await fixture(
      `<a:p>${run("red", style)}${run(" blue")}${trailing}</a:p>`,
      "",
      true
    );
    const result = await replacePresentationText(
      source,
      { find: "red blue", with: "green", all: true },
      context
    );
    expect(slide(result.bytes)).toContain(run("green", style));
    expect(slide(result.bytes)).toContain(trailing);
    const originalRels = inspectZip(source).find(
      (entry) => entry.name === "ppt/slides/_rels/slide1.xml.rels"
    )!.payload;
    expect(
      inspectZip(result.bytes).find((entry) => entry.name === "ppt/slides/_rels/slide1.xml.rels")!
        .payload
    ).toEqual(originalRels);
  });
  it("counts occurrences in paragraph and shape order while preventing cross-shape matches", async () => {
    const extra = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Later"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:p>${run("seed")}</a:p></p:txBody></p:sp>`;
    const source = await fixture(`<a:p>${run("seed")}</a:p><a:p>${run("seed")}</a:p>`, extra);
    const result = await replacePresentationText(
      source,
      { find: "seed", with: "green", occurrence: 3 },
      context
    );
    expect(slide(result.bytes)).toContain(`<a:p>${run("seed")}</a:p><a:p>${run("seed")}</a:p>`);
    expect(slide(result.bytes)).toContain(extra.replace("seed", "green"));
    expect(result.affected).toBe(1);
    expect(
      (
        await replacePresentationText(
          source,
          { find: "seedseed", with: "X", all: true, allowEmpty: true },
          context
        )
      ).bytes
    ).toEqual(source);
  });
  it("supports empty intervening runs, authored escapes and style overrides without a prior run style", async () => {
    const source = await fixture(`<a:p>${run("A")}${run("")}${run("B")}</a:p>`);
    const result = await replacePresentationText(
      source,
      { find: "AB", with: "<&🐚\r", all: true, style: { italic: true } },
      context
    );
    expect(slide(result.bytes)).toContain('i="1"');
    expect(slide(result.bytes)).toContain("&lt;&amp;🐚&#13;");
    expect((await readPresentationText(result.bytes, {}, context)).text).toBe("<&🐚\r");
  });
  it("joins runs within one table cell and never joins neighboring cells", async () => {
    const cell = (body: string) => `<a:tc><a:txBody><a:p>${body}</a:p></a:txBody></a:tc>`;
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Grid"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr>${cell(run("red") + run(" blue"))}${cell(run("edge"))}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const source = await fixture("<a:p/>", table);
    const result = await replacePresentationText(
      source,
      { find: "red blue", with: "green", all: true },
      context
    );
    expect(slide(result.bytes)).toContain(cell(run("green") + run("")) + cell(run("edge")));
    expect(result.affected).toBe(1);
    expect(
      (
        await replacePresentationText(
          source,
          { find: "blueedge", with: "X", all: true, allowEmpty: true },
          context
        )
      ).bytes
    ).toEqual(source);
  });
  it("edits strict text while preserving its namespace dialect", async () => {
    const source = await fixture(`<a:p>${run("red")}${run(" blue")}</a:p>`);
    const strict = await writePackageArchive(
      inspectZip(source).map((entry) => ({
        name: entry.name,
        bytes: encode(
          decode(entry.payload)
            .split("http://schemas.openxmlformats.org/presentationml/2006/main")
            .join("http://purl.oclc.org/ooxml/presentationml/main")
            .split("http://schemas.openxmlformats.org/drawingml/2006/main")
            .join("http://purl.oclc.org/ooxml/drawingml/main")
            .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships")
            .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
        )
      })),
      context,
      { compression: "store" }
    );
    const result = await replacePresentationText(
      strict,
      { find: "red blue", with: "green", first: true },
      context
    );
    expect(slide(result.bytes)).toContain(run("green") + run(""));
    expect(slide(result.bytes)).toContain('xmlns:a="http://purl.oclc.org/ooxml/drawingml/main"');
    expect(result.affected).toBe(1);
  });
  it("bounds expansion before constructing oversized replacement runs", async () => {
    const source = await fixture(`<a:p>${run("a".repeat(1000))}</a:p>`);
    await expect(
      replacePresentationText(source, { find: "a", with: "b".repeat(1000), all: true }, context)
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("rejects editing text with interleaved annotations instead of removing them", async () => {
    const source = await fixture("<a:p><a:r><a:t>red<!--retain--> blue</a:t></a:r></a:p>");
    await expect(
      replacePresentationText(source, { find: "red blue", with: "green", all: true }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each([
    ["e", "́", "é", "é", "é"],
    ["港🐚", "🐚岸", "🐚🐚", "船", "港船岸"],
    ["é", " é", "é", "E", "é E"],
    ["aaaa", "a", "aa", "aaa", "aaaaaaa"],
    ["a.b", " a.b", "a.b", "$&", "$& $&"],
    ["雪", "雪", "雪", "", ""]
  ])(
    "replaces literal scalar sequences %j %j",
    async (left, right, find, replacement, expected) => {
      const source = await fixture(`<a:p>${run(left)}${run(right)}</a:p>`);
      const result = await replacePresentationText(
        source,
        { find, with: replacement, all: true },
        context
      );
      expect((await readPresentationText(result.bytes, {}, context)).text).toBe(expected);
    }
  );
  it.each([
    [{ first: true }, "X seed seed", 1],
    [{ all: true }, "X X X", 3],
    [{ occurrence: 2 }, "seed X seed", 1]
  ] as const)("honors cardinality %j", async (cardinality, expected, affected) => {
    const source = await fixture(`<a:p>${run("seed se")}${run("ed seed")}</a:p>`);
    const result = await replacePresentationText(
      source,
      { find: "seed", with: "X", ...cardinality },
      context
    );
    expect(result.affected).toBe(affected);
    expect((await readPresentationText(result.bytes, {}, context)).text).toBe(expected);
  });
  it("keeps field, soft break and paragraph boundaries immutable", async () => {
    const body = `<a:p>${run("A")}<a:fld id="stamp" type="datetime"><a:t>B</a:t></a:fld>${run("C")}<a:br/>${run("D")}</a:p><a:p>${run("E")}</a:p>`;
    const source = await fixture(body);
    for (const find of ["AB", "BC", "B", "CD", "D\nE"]) {
      const result = await replacePresentationText(
        source,
        { find, with: "X", all: true, allowEmpty: true },
        context
      );
      expect(result).toMatchObject({ affected: 0, locations: [] });
      expect(result.bytes).toEqual(source);
    }
  });
  it("rejects zero matches unless explicitly allowed", async () => {
    const source = await fixture(`<a:p>${run("seed")}</a:p>`);
    await expect(
      replacePresentationText(source, { find: "SEED", with: "X", first: true }, context)
    ).rejects.toMatchObject({ code: "missing-selection" });
    await expect(
      replacePresentationText(source, { find: "seed", with: "X", occurrence: 2 }, context)
    ).rejects.toMatchObject({ code: "missing-selection" });
  });
  it.each([
    { find: "", with: "x", all: true },
    { find: "a", with: "x", all: true, style: {} },
    { find: "a", with: "x", all: true, style: { bold: 1 } },
    { find: "a", with: "x", all: true, scope: "shared" },
    { find: "a\v", with: "x", all: true },
    { find: "a", with: "x" },
    { find: "a", with: "x", first: true, all: true },
    { find: "a", with: "x", occurrence: 0 },
    { find: "\ud83d", with: "x", all: true },
    { find: "a", with: "\udc1a", all: true }
  ])("rejects invalid options before reading %j", async (options) => {
    const read = vi.fn();
    await expect(
      replacePresentationText({ read } as never, options as never, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(read).not.toHaveBeenCalled();
  });
});

it("replaces combining and emoji sequences across mixed-script runs while preserving direction metadata", async () => {
  const first =
    '<a:rPr lang="ar-SA" altLang="ja-JP"><a:ea typeface="Grove East" charset="-128"/><a:cs typeface="Grove Arabic" pitchFamily="34"/><a:rtl val="1"/></a:rPr>';
  const second =
    '<a:rPr lang="ja-JP"><a:latin typeface="Grove Latin"/><a:sym typeface="Grove Symbols"/></a:rPr>';
  const source = await fixture(
    `<a:p><a:pPr rtl="1"/>${run("مَرْحَبًا e", first)}${run("́ 👩🏽", second)}${run("‍🚀 日本語", second)}</a:p>`
  );
  const result = await replacePresentationText(
    source,
    { find: "é 👩🏽‍🚀", with: "Å 🧑🏾‍🔬", all: true },
    context
  );
  expect(result.affected).toBe(1);
  expect(slide(result.bytes)).toContain(
    run("مَرْحَبًا Å 🧑🏾‍🔬", first) + run("", second) + run(" 日本語", second)
  );
  expect(slide(result.bytes)).toContain('<a:pPr rtl="1"/>');
  expect((await readPresentationText(result.bytes, {}, context)).text).toBe(
    "مَرْحَبًا Å 🧑🏾‍🔬 日本語"
  );
});

describe("empty simple text selections", () => {
  it.each([
    {
      select: {
        kind: "slide" as const,
        position: { coordinateSystem: "one-based" as const, value: 9 }
      }
    },
    {
      select: {
        kind: "slide" as const,
        position: { coordinateSystem: "one-based" as const, value: 1 }
      },
      shape: "Absent"
    }
  ])("requires explicit empty intent for %j", async (selection) => {
    const source = await fixture(`<a:p>${run("seed")}</a:p>`);
    for (const cardinality of [
      { first: true as const },
      { all: true as const },
      { occurrence: 2 }
    ]) {
      const options = { find: "seed", with: "sprout", ...selection, ...cardinality };
      await expect(replacePresentationText(source, options, context)).rejects.toMatchObject({
        code: "missing-selection"
      });
      const result = await replacePresentationText(
        source,
        { ...options, allowEmpty: true },
        context
      );
      expect(result).toEqual({ bytes: source, affected: 0, locations: [] });
    }
  });
  it("does not suppress invalid positions or ambiguous labels", async () => {
    const source = await createPresentation(
      {
        slides: [
          {
            shapes: [
              { name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "seed" },
              { name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "seed" }
            ]
          }
        ]
      },
      context
    );
    for (const [value, shape, code] of [
      [0, undefined, "invalid-selection"],
      [0.5, undefined, "invalid-selection"],
      [1, "Caption", "ambiguous-selection"]
    ] as const) {
      await expect(
        replacePresentationText(
          source,
          {
            find: "seed",
            with: "sprout",
            all: true,
            allowEmpty: true,
            select: { kind: "slide", position: { coordinateSystem: "one-based", value } },
            ...(shape === undefined ? {} : { shape })
          },
          context
        )
      ).rejects.toMatchObject({ code });
    }
  });
});

it("keeps missing and stale fingerprint token failures with empty replacement intent", async () => {
  const source = await fixture(`<a:p>${run("seed")}</a:p>`);
  const index = await readSelectionIndex(source, context);
  for (const [changes, code] of [
    [{ objectId: "999" }, "missing-selection"],
    [{ fingerprint: "0".repeat(64) }, "stale-selection"]
  ] as const) {
    const token = JSON.stringify({ ...index.objects[0]!.location, ...changes });
    await expect(
      replacePresentationText(
        source,
        {
          find: "seed",
          with: "sprout",
          first: true,
          allowEmpty: true,
          select: { token }
        },
        context
      )
    ).rejects.toMatchObject({ code });
  }
});
