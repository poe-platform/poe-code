import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createZipCodec } from "../../../office-package/src/zip.js";
import { createDocumentFixture, technicalBitmap, fixtureLimits } from "./documents.js";

const decoder = new TextDecoder();
const themes = ["garden", "observatory", "museum", "equipment"] as const;

function xmlFacts(bytes: Uint8Array) {
  const tags: { name: string; uri: string; attributes: Record<string, string> }[] = [];
  const text: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) =>
    tags.push({
      name: tag.local,
      uri: tag.uri,
      attributes: Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value]))
    })
  );
  parser.on("text", (value) => text.push(value));
  parser.write(decoder.decode(bytes)).close();
  return { tags, text: text.join("") };
}

describe("original document fixtures", () => {
  it.each(["invalid-grid", "truncated-image"] as const)(
    "rejects a %s variant on a theme without that structure",
    async (variant) => {
      await expect(createDocumentFixture("garden", variant)).rejects.toThrow(
        "requires the museum theme"
      );
    }
  );

  it("retains complex field instructions separately from cached results", async () => {
    const { parts } = await createDocumentFixture("observatory");
    const facts = xmlFacts(parts.get("word/document.xml")!);
    expect(
      facts.tags.filter((t) => t.name === "fldChar").map((t) => t.attributes["w:fldCharType"])
    ).toEqual(["begin", "separate", "end"]);
    expect(facts.text).toContain(" REF rail Check rail");
  });

  it.each(themes)(
    "gives every %s part a declared type and every internal edge a target",
    async (theme) => {
      const { parts } = await createDocumentFixture(theme);
      const declarations = xmlFacts(parts.get("[Content_Types].xml")!).tags;
      for (const name of parts.keys()) {
        if (name !== "[Content_Types].xml")
          expect(
            declarations.some(
              (t) =>
                t.attributes.PartName === `/${name}` ||
                (t.name === "Default" && name.endsWith(`.${t.attributes.Extension}`))
            )
          ).toBe(true);
        if (!name.endsWith(".rels")) continue;
        const directory = name === "_rels/.rels" ? "" : name.slice(0, name.indexOf("_rels/"));
        const edges = xmlFacts(parts.get(name)!).tags.filter((t) => t.name === "Relationship");
        expect(new Set(edges.map((t) => t.attributes.Id)).size).toBe(edges.length);
        for (const edge of edges) {
          if (edge.attributes.TargetMode === "External") continue;
          const target = new URL(
            edge.attributes.Target!,
            `https://fixture.invalid/${directory}`
          ).pathname.slice(1);
          expect(parts.has(target), `${name} -> ${target}`).toBe(true);
        }
      }
    }
  );
  it.each(themes)("builds a deterministic owned %s package entirely in memory", async (theme) => {
    const first = await createDocumentFixture(theme);
    const second = await createDocumentFixture(theme);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.bytes.length).toBeLessThan(32768);
    const codec = createZipCodec();
    const signal = new AbortController().signal;
    const archive = await codec.readZipArchive(first.bytes, fixtureLimits, signal);
    expect(archive.entries.map((entry) => entry.name)).toEqual([...first.parts.keys()].sort());
    for (const entry of archive.entries) {
      const chunks: number[] = [];
      for await (const chunk of codec.decodeZipEntry(entry, fixtureLimits, signal))
        chunks.push(...chunk);
      expect(Uint8Array.from(chunks)).toEqual(first.parts.get(entry.name));
      if (entry.name.endsWith(".xml") || entry.name.endsWith(".rels"))
        xmlFacts(first.parts.get(entry.name)!);
    }
    const volume = Volume.fromJSON({ "/input.docx": Buffer.from(first.bytes) });
    volume.writeFileSync("/output.docx", second.bytes);
    expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(first.bytes));
    first.parts.get("word/document.xml")!.fill(0);
    first.bytes.fill(0);
    expect(second.parts.get("word/document.xml")![0]).toBe(60);
    expect(volume.readFileSync("/output.docx")).toEqual(Buffer.from(second.bytes));
  });

  it("keeps garden run boundaries, three-state formatting, lists and field caches", async () => {
    const { parts } = await createDocumentFixture("garden");
    const facts = xmlFacts(parts.get("word/document.xml")!);
    expect(facts.text).toContain("Water the seedlings at dawn.");
    expect(facts.tags.filter((t) => t.name === "b").map((t) => t.attributes["w:val"])).toEqual([
      undefined,
      "0"
    ]);
    expect(
      facts.tags
        .filter((t) => t.name === "t")
        .slice(1, 4)
        .map((t) => t.attributes["xml:space"])
    ).toEqual(["preserve", "preserve", "preserve"]);
    expect(facts.tags.some((t) => t.name === "numId" && t.attributes["w:val"] === "7")).toBe(true);
    expect(facts.tags.find((t) => t.name === "fldSimple")?.attributes["w:instr"]).toBe("PAGE");
    expect(facts.text.endsWith("3")).toBe(true);
    expect(
      xmlFacts(parts.get("word/numbering.xml")!)
        .tags.filter((t) => t.name === "startOverride")
        .map((t) => t.attributes["w:val"])
    ).toEqual(["3"]);
  });

  it("keeps observatory stories, inherited section links and rich comment IDs", async () => {
    const { parts } = await createDocumentFixture("observatory");
    const facts = xmlFacts(parts.get("word/document.xml")!);
    expect(facts.tags.filter((t) => t.name === "sectPr")).toHaveLength(2);
    expect(facts.tags.filter((t) => t.name === "headerReference")).toHaveLength(1);
    expect(xmlFacts(parts.get("word/header1.xml")!).text).toBe("Dome inspection log");
    expect(xmlFacts(parts.get("word/footer1.xml")!).text).toBe("Night team — check latch");
    expect(
      xmlFacts(parts.get("word/comments.xml")!).tags.find((t) => t.name === "comment")?.attributes
    ).toMatchObject({ "w:id": "4", "w:author": "Mira", "w:date": "2026-01-02T03:04:05Z" });
    expect(
      xmlFacts(parts.get("word/footnotes.xml")!)
        .tags.filter((t) => t.name === "footnote")
        .map((t) => t.attributes["w:id"])
    ).toEqual(["-1", "0", "2"]);
  });

  it("keeps museum merged and omitted cells, nested content and shared image occurrences", async () => {
    const { parts } = await createDocumentFixture("museum");
    const facts = xmlFacts(parts.get("word/document.xml")!);
    expect(facts.text).toContain("Clay lampShelf C");
    expect(
      facts.tags.filter((t) => t.name === "gridSpan").map((t) => t.attributes["w:val"])
    ).toEqual(["2"]);
    expect(
      facts.tags.filter((t) => t.name === "gridBefore").map((t) => t.attributes["w:val"])
    ).toEqual(["1"]);
    expect(facts.tags.filter((t) => t.name === "vMerge").map((t) => t.attributes["w:val"])).toEqual(
      ["restart", undefined]
    );
    expect(facts.tags.filter((t) => t.name === "blip").map((t) => t.attributes["r:embed"])).toEqual(
      ["rImage", "rImage"]
    );
    expect(parts.get("word/media/pixel.bmp")).toEqual(technicalBitmap());
    expect(decoder.decode(parts.get("customXml/item1.xml"))).toContain(
      "shelf=west; humidity=stable"
    );
  });

  it("retains logical multilingual text and opaque XML without reshaping", async () => {
    const { parts } = await createDocumentFixture("equipment");
    const source = decoder.decode(parts.get("word/document.xml"));
    const facts = xmlFacts(parts.get("word/document.xml")!);
    expect(facts.text).toContain("مفتاح — 望遠鏡 — cafe\u0301 — 🔧");
    expect(facts.tags.some((t) => t.name === "rtl")).toBe(true);
    expect(source).toContain("<!--retain equipment annotation-->");
    expect(source).toContain("<?inventory stable?>");
    expect(source).toContain('x:calibration="0"');
    expect(facts.tags.some((t) => t.name === "AlternateContent")).toBe(true);
  });

  it("authors a complete two-pixel BMP with explicit per-axis density", () => {
    const bytes = technicalBitmap();
    const view = new DataView(bytes.buffer);
    expect(Array.from(bytes.slice(0, 2))).toEqual([66, 77]);
    expect(view.getUint32(2, true)).toBe(bytes.length);
    expect(view.getInt32(18, true)).toBe(2);
    expect(view.getInt32(22, true)).toBe(1);
    expect(view.getUint16(28, true)).toBe(24);
    expect([view.getInt32(38, true), view.getInt32(42, true)]).toEqual([3780, 7560]);
    expect(Array.from(bytes.slice(54))).toEqual([19, 41, 73, 101, 137, 173, 0, 0]);
    expect(technicalBitmap("truncated").length).toBe(20);
  });

  it.each(["strict", "template", "empty"] as const)(
    "provides an explicit valid %s variant",
    async (variant) => {
      const { parts } = await createDocumentFixture("garden", variant);
      const facts = xmlFacts(parts.get("word/document.xml")!);
      if (variant === "strict")
        expect(facts.tags[0]!.uri).toBe("http://purl.oclc.org/ooxml/wordprocessingml/main");
      if (variant === "template")
        expect(decoder.decode(parts.get("[Content_Types].xml"))).toContain(
          "wordprocessingml.template.main+xml"
        );
      if (variant === "empty") {
        expect(facts.text).toBe("");
        expect(facts.tags.filter((t) => t.name === "p")).toHaveLength(1);
      }
    }
  );

  it.each(["missing-target", "malformed-xml", "invalid-grid", "truncated-image"] as const)(
    "isolates the explicit invalid %s variant",
    async (variant) => {
      const good = await createDocumentFixture("museum");
      const bad = await createDocumentFixture("museum", variant);
      const changed = [...good.parts.keys()].filter(
        (name) =>
          !bad.parts.has(name) ||
          !Buffer.from(good.parts.get(name)!).equals(Buffer.from(bad.parts.get(name)!))
      );
      expect(changed).toEqual([
        variant === "truncated-image"
          ? "word/media/pixel.bmp"
          : variant === "missing-target"
            ? "word/styles.xml"
            : "word/document.xml"
      ]);
      if (variant === "malformed-xml")
        expect(() => xmlFacts(bad.parts.get("word/document.xml")!)).toThrow();
      if (variant === "invalid-grid")
        expect(
          xmlFacts(bad.parts.get("word/document.xml")!).tags.find((t) => t.name === "gridSpan")
            ?.attributes["w:val"]
        ).toBe("0");
    }
  );
});
