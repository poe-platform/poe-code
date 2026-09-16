import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocumentFixture } from "./fixtures/documents.js";
import {
  readPackage,
  assertHashes,
  assertPackageLinks,
  assertWordReferences,
  assertPreserved,
  assertImage,
  assertTable,
  assertJsonOutput,
  xmlStructure
} from "./assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const xml = (body: string) => encode(`<w:document xmlns:w="${w}">${body}</w:document>`);

describe("independent document assertions", () => {
  it.each(["garden", "observatory", "museum", "equipment"] as const)(
    "independently checks the complete %s archive and semantic references",
    async (theme) => {
      const fixture = await createDocumentFixture(theme);
      const parts = readPackage(fixture.bytes);
      expect(parts).toEqual(fixture.parts);
      assertPackageLinks(parts);
      assertWordReferences(parts);
    }
  );

  it.each(["strict", "template", "empty"] as const)("checks the %s profile", async (variant) => {
    const parts = readPackage((await createDocumentFixture("garden", variant)).bytes);
    assertPackageLinks(parts);
    assertWordReferences(parts);
  });

  it("rejects damaged ZIP framing, CRC, names, flags, lengths and trailing bytes", async () => {
    const { bytes } = await createDocumentFixture("garden");
    const end = bytes.length - 22;
    const central = new DataView(bytes.buffer, bytes.byteOffset).getUint32(end + 16, true);
    for (const [offset, value, width] of [
      [0, 0, 4],
      [14, 0, 4],
      [central + 16, 0, 4],
      [6, 1, 2],
      [central + 10, 99, 2],
      [central + 24, 1000000, 4],
      [central + 42, central, 4],
      [end + 8, 0, 2],
      [end + 4, 1, 2],
      [30, 47, 1],
      [central + 46, 47, 1]
    ] as const) {
      const bad = bytes.slice();
      const view = new DataView(bad.buffer);
      if (width === 4) view.setUint32(offset, value, true);
      else if (width === 2) view.setUint16(offset, value, true);
      else view.setUint8(offset, value);
      expect(() => readPackage(bad), `offset ${offset}`).toThrow();
    }
    expect(() => readPackage(bytes.slice(0, -1))).toThrow();
    expect(() => readPackage(Uint8Array.from([...bytes, 0]))).toThrow();
    expect(() => readPackage(new Uint8Array())).toThrow();
  });

  it("checks independently known SHA-256 payloads and exact membership", () => {
    const parts = new Map([["sample", encode("abc")]]);
    const hashes = { sample: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
    assertHashes(parts, hashes);
    expect(() => assertHashes(new Map([["sample", encode("abd")]]), hashes)).toThrow();
    expect(() => assertHashes(parts, {})).toThrow();
    expect(() => assertHashes(new Map(), hashes)).toThrow();
  });

  it("rejects payload corruption even when both CRC header copies agree", async () => {
    const { bytes } = await createDocumentFixture("museum");
    const bad = bytes.slice();
    const view = new DataView(bad.buffer);
    const central = view.getUint32(bad.length - 6, true);
    view.setUint32(14, 0, true);
    view.setUint32(central + 16, 0, true);
    expect(() => readPackage(bad)).toThrow("ZIP payload CRC");
  });

  it("compares expanded XML names, ordered content, comments and instructions", () => {
    const first = encode(
      '<a:p xmlns:a="urn:one" a:id="2" plain="x"> A<a:r/>B<!--keep--><?note yes?></a:p>'
    );
    const same = encode(
      '<b:p plain="x" xmlns:b="urn:one" b:id="2"> A<b:r></b:r>B<!--keep--><?note yes?></b:p>'
    );
    expect(xmlStructure(first)).toEqual(xmlStructure(same));
    for (const changed of [
      decode(same).replace("urn:one", "urn:other"),
      decode(same).replace(" A", "A"),
      decode(same).replace("<!--keep-->", ""),
      decode(same).replace("note yes", "note no"),
      decode(same).replace('b:id="2"', 'id="2"')
    ])
      expect(xmlStructure(encode(changed))).not.toEqual(xmlStructure(first));
    for (const malformed of ["<p:x/>", "<x><y></x>", '<!DOCTYPE x [<!ENTITY a "b">]><x/>'])
      expect(() => xmlStructure(encode(malformed))).toThrow();
  });

  it("requires exact unedited payloads and explicit expected dirty structure", async () => {
    const { parts } = await createDocumentFixture("garden");
    const dirty = "word/document.xml";
    const expected = encode(decode(parts.get(dirty)!).replace("seedlings", "saplings"));
    const after = new Map(parts).set(dirty, expected);
    assertPreserved(parts, after, new Map([[dirty, expected]]));
    expect(() => assertPreserved(parts, after, new Map())).toThrow();
    expect(() => assertPreserved(parts, parts, new Map([[dirty, expected]]))).toThrow();
    const extra = new Map(after).set("surprise.bin", encode("unexpected"));
    expect(() => assertPreserved(parts, extra, new Map([[dirty, expected]]))).toThrow();
    const removed = new Map(after);
    removed.delete("word/styles.xml");
    expect(() => assertPreserved(parts, removed, new Map([[dirty, expected]]))).toThrow();
    expect(() => assertPreserved(parts, after, new Map([["missing.xml", expected]]))).toThrow();
  });

  it("rejects missing targets, wrong namespaces, duplicate edges and wrong content types", async () => {
    const { parts } = await createDocumentFixture("museum");
    const mutations: [string, (s: string) => string][] = [
      [
        "word/_rels/document.xml.rels",
        (s) => s.replace('Target="styles.xml"', 'Target="absent.xml"')
      ],
      ["word/_rels/document.xml.rels", (s) => s.replace('Id="rImage"', 'Id="rStyles"')],
      ["word/_rels/document.xml.rels", (s) => s.replace('Id="rImage"', 'Id="unused"')],
      ["word/_rels/document.xml.rels", (s) => s.replace("package/2006/relationships", "wrong")],
      [
        "[Content_Types].xml",
        (s) => s.replace("wordprocessingml.styles+xml", "wordprocessingml.header+xml")
      ],
      ["[Content_Types].xml", (s) => s.replace("package/2006/content-types", "wrong")],
      [
        "[Content_Types].xml",
        (s) => s.replace('PartName="/word/styles.xml"', 'PartName="/absent.xml"')
      ]
    ];
    for (const [name, change] of mutations)
      expect(
        () =>
          assertPackageLinks(new Map(parts).set(name, encode(change(decode(parts.get(name)!))))),
        name
      ).toThrow();
  });

  it("rejects dangling styles, numbering, note IDs and unmatched bookmark ranges", async () => {
    for (const [theme, name, before, after] of [
      ["garden", "word/document.xml", 'w:val="Title"', 'w:val="Absent"'],
      ["garden", "word/document.xml", 'w:numId w:val="7"', 'w:numId w:val="8"'],
      ["garden", "word/numbering.xml", 'w:abstractNumId w:val="2"', 'w:abstractNumId w:val="8"'],
      ["garden", "word/styles.xml", 'w:basedOn w:val="Normal"', 'w:basedOn w:val="Absent"'],
      [
        "observatory",
        "word/document.xml",
        'w:footnoteReference w:id="2"',
        'w:footnoteReference w:id="9"'
      ],
      [
        "observatory",
        "word/document.xml",
        'w:commentReference w:id="4"',
        'w:commentReference w:id="9"'
      ],
      ["observatory", "word/document.xml", 'w:bookmarkEnd w:id="5"', 'w:bookmarkEnd w:id="6"'],
      ["garden", "word/styles.xml", 'w:styleId="Title"', 'w:styleId="Normal"']
    ] as const) {
      const { parts } = await createDocumentFixture(theme);
      expect(() =>
        assertWordReferences(
          new Map(parts).set(name, encode(decode(parts.get(name)!).replace(before, after)))
        )
      ).toThrow();
    }
  });

  it("rejects absent relationship owners, wrong edge roles and wrong main types", async () => {
    const { parts } = await createDocumentFixture("museum");
    const missing = new Map(parts);
    missing.delete("word/_rels/document.xml.rels");
    expect.soft(() => assertPackageLinks(missing)).toThrow();
    for (const [part, from, to] of [
      ["[Content_Types].xml", "wordprocessingml.document.main+xml", "wordprocessingml.styles+xml"],
      ["word/_rels/document.xml.rels", '/styles"', '/header"'],
      ["_rels/.rels", '/officeDocument"', '/header"']
    ] as const)
      expect
        .soft(() =>
          assertPackageLinks(
            new Map(parts).set(part, encode(decode(parts.get(part)!).replace(from, to)))
          )
        )
        .toThrow();
  });

  it("rejects duplicate drawing IDs, missing list levels and reversed ranges", async () => {
    for (const [theme, part, from, to] of [
      ["museum", "word/document.xml", '<wp:docPr id="2"', '<wp:docPr id="1"'],
      ["garden", "word/document.xml", 'w:ilvl w:val="1"', 'w:ilvl w:val="8"'],
      ["garden", "word/numbering.xml", 'w:lvl w:ilvl="1"', 'w:lvl w:ilvl="0"'],
      [
        "observatory",
        "word/document.xml",
        '<w:bookmarkStart w:id="5" w:name="rail"/><w:r><w:t>Rail reference</w:t></w:r><w:bookmarkEnd w:id="5"/>',
        '<w:bookmarkEnd w:id="5"/><w:r><w:t>Rail reference</w:t></w:r><w:bookmarkStart w:id="5" w:name="rail"/>'
      ]
    ] as const) {
      const { parts } = await createDocumentFixture(theme);
      const original = decode(parts.get(part)!);
      expect(original).toContain(from);
      expect
        .soft(() =>
          assertWordReferences(new Map(parts).set(part, encode(original.replace(from, to))))
        )
        .toThrow();
    }
  });

  it("allows IDs reused in different stories and note kinds but rejects local duplicates", async () => {
    const { parts } = await createDocumentFixture("observatory");
    const bookmark =
      '<w:p><w:bookmarkStart w:id="5" w:name="other"/><w:bookmarkEnd w:id="5"/></w:p>';
    const scoped = new Map(parts).set("word/header1.xml", xml(bookmark));
    assertWordReferences(scoped);
    scoped.set("word/header1.xml", xml(bookmark + bookmark));
    expect(() => assertWordReferences(scoped)).toThrow();
  });

  it("checks actual extracted image bytes through memfs, including pixel corruption", async () => {
    const parts = readPackage((await createDocumentFixture("museum")).bytes);
    const image = parts.get("word/media/pixel.bmp")!;
    const volume = Volume.fromJSON({ "/extracted.bmp": Buffer.from(image) });
    assertImage(volume.readFileSync("/extracted.bmp") as Buffer, image);
    const bad = image.slice();
    bad[54] = bad[54]! ^ 1;
    volume.writeFileSync("/extracted.bmp", bad);
    expect(() => assertImage(volume.readFileSync("/extracted.bmp") as Buffer, image)).toThrow();
    expect(() => assertImage(image.slice(0, 20), image)).toThrow();
    expect(() => assertImage(new Uint8Array(), new Uint8Array())).toThrow();
  });

  it("checks complete physical table cell values without flattening nested rows", async () => {
    const { parts } = await createDocumentFixture("observatory");
    const bytes = parts.get("word/comments.xml")!;
    assertTable(bytes, 0, [["Torque", "8 N·m"]]);
    expect(() => assertTable(bytes, 0, [["Torque", "9 N·m"]])).toThrow();
    expect(() => assertTable(bytes, 0, [["Torque"]])).toThrow();
    expect(() => assertTable(bytes, 1, [])).toThrow();
    const nested = xml(
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Outer</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>"
    );
    assertTable(nested, 0, [["Outer"]]);
    assertTable(nested, 1, [["Inner"]]);
  });

  it("parses complete JSON and checks absence in all output, including escaped strings", () => {
    const expected = {
      version: 1,
      operation: "text.get",
      ok: true,
      data: { text: "Clear" },
      warnings: [],
      errors: [],
      affected: 0,
      locations: []
    };
    const output = JSON.stringify(expected);
    assertJsonOutput(output, expected, ["secret"]);
    expect(() => assertJsonOutput(output + "\nsecret", expected, ["secret"])).toThrow();
    expect(() => assertJsonOutput(output, { ...expected, affected: 1 })).toThrow();
    const leaked = { ...expected, warnings: ["secret"] };
    expect(() => assertJsonOutput(JSON.stringify(leaked), leaked, ["secret"])).toThrow();
    expect(() =>
      assertJsonOutput('{"tail":"sec\\u0072et"}', { tail: "secret" }, ["secret"])
    ).toThrow();
    expect(() => assertJsonOutput("null", expected)).toThrow();
  });

  it.each(["canopy\nsurvey", 'canopy"survey', "canopy\\survey"])(
    "rejects forbidden decoded keys and nested values containing %j",
    (forbidden) => {
      const volume = Volume.fromJSON({ "/result.json": "null" });
      for (const expected of [
        { data: [{ text: forbidden }] },
        { locations: [{ [forbidden]: null }] }
      ]) {
        volume.writeFileSync("/result.json", JSON.stringify(expected));
        const output = volume.readFileSync("/result.json", "utf8") as string;
        expect(output).not.toContain(forbidden);
        expect
          .soft(() => assertJsonOutput(output, expected, [forbidden]))
          .toThrow("forbidden decoded output");
        assertJsonOutput(output, expected, ["absent orchard"]);
      }
    }
  );
});
