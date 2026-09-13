import { describe, expect, it } from "vitest";
import { getXmlPart, replaceXmlPart } from "./xml-parts.js";
import { readPackage } from "./package-reader.js";
import { createDeckFixture } from "../tests/fixtures/decks.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const context = {
  limits: { maxBytes: 200000, maxReads: 1000, chunkBytes: 65536 },
  archiveLimits: {
    maxArchiveBytes: 200000,
    maxEntryBytes: 50000,
    maxTotalBytes: 200000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 50000,
    chunkSize: 65536
  },
  validationLimits: {
    maxBytes: 100000,
    maxNodes: 5000,
    maxDepth: 60,
    maxParts: 100,
    maxRelationships: 100,
    maxEntries: 100
  }
};
const slide = "/ppt/slides/slide1.xml";
const encode = (value: string) => new TextEncoder().encode(value);
function deck(changes: Record<string, string | Uint8Array> = {}) {
  const { volume, root } = createDeckFixture("seed-library");
  for (const [name, text] of Object.entries(changes)) {
    const path = `${root}${name}`;
    volume.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    volume.writeFileSync(path, text);
  }
  return storedArchive(
    Object.entries(volume.toJSON())
      .filter(([, value]) => value !== null)
      .map(([path]) => ({
        name: path.slice(root.length + 1),
        bytes: new Uint8Array(volume.readFileSync(path) as Buffer)
      }))
  );
}

describe("bounded XML part operations", () => {
  it("returns original bytes and labels the bounded display separately", async () => {
    const bytes = deck();
    const reader = await readPackage(bytes, context);
    const original = await getXmlPart(bytes, slide, context);
    expect(original.bytes).toEqual(reader.get(slide));
    expect(original.format).toBe("original");
    expect(original.xml).toContain('name="Seed library"');
    const pretty = await getXmlPart(bytes, slide, context, { pretty: true });
    expect(pretty.format).toBe("pretty");
    expect(pretty.xml).toContain("\n  <p:cSld");
    expect(pretty.bytes).toEqual(original.bytes);
    await expect(
      getXmlPart(bytes, slide, {
        ...context,
        validationLimits: { ...context.validationLimits, maxBytes: 10 }
      })
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it.each(["ppt/slides/slide1.xml", "/ppt/../slide.xml", "/absent.xml"])(
    "rejects an unbound part selector %s",
    async (part) => {
      await expect(getXmlPart(deck(), part, context)).rejects.toBeDefined();
    }
  );
  it("replaces text and retains every unrelated member exactly", async () => {
    const bytes = deck();
    const before = await readPackage(bytes, context);
    const replacement = encode(
      new TextDecoder().decode(before.get(slide)).replace("Borrow seeds.", "Share seeds.")
    );
    const output = await replaceXmlPart(bytes, slide, replacement, context);
    const after = await readPackage(output, context);
    expect(after.names.slice().sort()).toEqual(before.names.slice().sort());
    for (const part of before.names)
      expect(after.get(part)).toEqual(part === slide ? replacement : before.get(part));
  });
  it.each([
    ["unbound prefix", (text: string) => text.replace("<p:cSld", "<unknown:cSld"), "invalid-xml"],
    [
      "different content root",
      (text: string) => text.replaceAll("p:sld", "p:notes"),
      "invalid-opc"
    ],
    [
      "dialect conversion",
      (text: string) =>
        text.replaceAll(
          "http://schemas.openxmlformats.org/presentationml/2006/main",
          "http://purl.oclc.org/ooxml/presentationml/main"
        ),
      "unsupported-edit"
    ],
    ["removed resource", (text: string) => text.replace(' r:embed="rId2"', ""), "unsupported-edit"],
    [
      "rebound opaque namespace",
      (text: string) =>
        text.replace(
          'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"',
          'xmlns:c="urn:original:other"'
        ),
      "unsupported-edit"
    ],
    [
      "wrong resource kind",
      (text: string) => text.replace('r:embed="rId2"', 'r:embed="rId3"'),
      "unsupported-edit"
    ],
    [
      "opaque chart payload",
      (text: string) => text.replace('r:id="rId3"', 'r:id="rId2"'),
      "unsupported-edit"
    ],
    [
      "dangling image",
      (text: string) => text.replace('r:embed="rId2"', 'r:embed="absent"'),
      "invalid-opc"
    ],
    [
      "reordered structure",
      (text: string) => text.replace("<p:nvGrpSpPr>", "<p:grpSpPr/><p:nvGrpSpPr>"),
      "unsupported-edit"
    ]
  ] as const)("rejects %s before serialization", async (_name, change, code) => {
    const bytes = deck();
    const original = await getXmlPart(bytes, slide, context);
    await expect(
      replaceXmlPart(bytes, slide, encode(change(original.xml)), context)
    ).rejects.toMatchObject({ code });
  });
  it("preserves opaque extension bytes during text replacement", async () => {
    const baseline = await readPackage(deck(), context);
    const xml = new TextDecoder()
      .decode(baseline.get(slide))
      .replace(
        "</p:sld>",
        '<p:extLst><p:ext uri="urn:original:feature"><x:item xmlns:x="urn:original:future" value="kept"/></p:ext></p:extLst></p:sld>'
      );
    const bytes = deck({ [slide]: xml });
    const replacement = encode(xml.replace("Borrow seeds.", "Share seeds."));
    const output = await readPackage(
      await replaceXmlPart(bytes, slide, replacement, context),
      context
    );
    expect(output.get(slide)).toEqual(replacement);
  });
  it("retains UTF-16 bytes with a byte-order mark", async () => {
    const source = '<?xml version="1.0" encoding="UTF-16"?><note>Blue sky</note>';
    const bytes = new Uint8Array((source.length + 1) * 2);
    bytes.set([255, 254]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < source.length; index++)
      view.setUint16(2 + index * 2, source.charCodeAt(index), true);
    const result = await getXmlPart(deck({ "/note.xml": bytes }), "/note.xml", context);
    expect(result.bytes).toEqual(bytes);
    expect(result.xml).toBe(source);
  });
  it("accepts text replacement while preserving the strict dialect", async () => {
    const reader = await readPackage(deck(), context);
    const members = reader.names.map((name) => ({
      name: name.slice(1),
      bytes:
        name.endsWith(".xml") || name.endsWith(".rels")
          ? encode(
              new TextDecoder()
                .decode(reader.get(name))
                .replaceAll(
                  "http://schemas.openxmlformats.org/presentationml/2006/main",
                  "http://purl.oclc.org/ooxml/presentationml/main"
                )
                .replaceAll(
                  "http://schemas.openxmlformats.org/drawingml/2006/main",
                  "http://purl.oclc.org/ooxml/drawingml/main"
                )
                .replaceAll(
                  "http://schemas.openxmlformats.org/drawingml/2006/chart",
                  "http://purl.oclc.org/ooxml/drawingml/chart"
                )
                .replaceAll(
                  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
                  "http://purl.oclc.org/ooxml/officeDocument/relationships"
                )
            )
          : reader.get(name)
    }));
    const bytes = storedArchive(members);
    const original = await getXmlPart(bytes, slide, context);
    const replacement = encode(original.xml.replace("Borrow seeds.", "Share seeds."));
    const output = await readPackage(
      await replaceXmlPart(bytes, slide, replacement, context),
      context
    );
    expect(output.get(slide)).toEqual(replacement);
  });
  it.each(["signature content type", "protected parameterized XML"])(
    "rejects %s before changing a slide",
    async (kind) => {
      const reader = await readPackage(deck(), context);
      const types = new TextDecoder().decode(reader.get("/[Content_Types].xml"));
      const changes: Record<string, string> =
        kind === "signature content type"
          ? {
              "/[Content_Types].xml": types.replace(
                "</Types>",
                '<Override PartName="/seal.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"/></Types>'
              ),
              "/seal.xml": '<seal xmlns="urn:original:seal"/>'
            }
          : {
              "/[Content_Types].xml": types.replace(
                "presentation.main+xml",
                "presentation.main+xml;charset=utf-8"
              ),
              "/ppt/presentation.xml": new TextDecoder()
                .decode(reader.get("/ppt/presentation.xml"))
                .replace(
                  "</p:presentation>",
                  '<p:modifyVerifier cryptProviderType="rsaAES"/></p:presentation>'
                )
            };
      const bytes = deck(changes);
      await expect(replaceXmlPart(bytes, slide, reader.get(slide), context)).rejects.toMatchObject({
        code: kind === "signature content type" ? "unsupported-edit" : "invalid-opc"
      });
    }
  );
  it("rejects an existing dangling resource ID inside opaque chart markup", async () => {
    const original = await getXmlPart(deck(), slide, context);
    const bytes = deck({ [slide]: original.xml.replace('r:id="rId3"', 'r:id="missing-chart"') });
    await expect(
      replaceXmlPart(
        bytes,
        slide,
        encode(
          original.xml
            .replace('r:id="rId3"', 'r:id="missing-chart"')
            .replace("Borrow seeds.", "Share seeds.")
        ),
        context
      )
    ).rejects.toMatchObject({ code: "invalid-opc" });
  });
  it.each(["application/xml", "application/xml; charset=utf-8"])(
    "rejects dangling IDs in custom XML declared as %s",
    async (contentType) => {
      const reader = await readPackage(deck(), context);
      const types = new TextDecoder()
        .decode(reader.get("/[Content_Types].xml"))
        .replace(
          "</Types>",
          `<Override PartName="/custom.xml" ContentType="${contentType}"/></Types>`
        );
      const bytes = deck({
        "/[Content_Types].xml": types,
        "/custom.xml":
          '<payload xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="absent"/>'
      });
      await expect(
        replaceXmlPart(bytes, slide, reader.get(slide), context).then(() => "accepted")
      ).rejects.toMatchObject({ code: "invalid-opc" });
    }
  );
  it("returns the exact archive for a validated no-op", async () => {
    const bytes = deck();
    const original = await getXmlPart(bytes, slide, context);
    expect(await replaceXmlPart(bytes, slide, original.bytes, context)).toEqual(bytes);
  });
  it.each(["<note><!-- <item/> --><item/>words<item/></note>", "<note>lead<item/>tail</note>"])(
    "leaves mixed content intact in pretty display: %s",
    async (markup) => {
      const bytes = deck({ "/note.xml": markup });
      const result = await getXmlPart(bytes, "/note.xml", context, { pretty: true });
      expect(result.xml).toBe(markup);
    }
  );
  it("rejects opaque XML replacements and binary members", async () => {
    const bytes = deck();
    await expect(getXmlPart(bytes, "/ppt/media/tile.bmp", context)).rejects.toMatchObject({
      code: "unsupported-profile"
    });
    const theme = await getXmlPart(bytes, "/ppt/theme/theme1.xml", context);
    await expect(replaceXmlPart(bytes, theme.part, theme.bytes, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
  });
  it.each(["signature", "protection"])("rejects edits that invalidate %s", async (kind) => {
    const baseline = await readPackage(deck(), context);
    const main = "/ppt/presentation.xml";
    const changes =
      kind === "signature"
        ? {
            "/_rels/.rels": new TextDecoder()
              .decode(baseline.get("/_rels/.rels"))
              .replace(
                "</Relationships>",
                '<Relationship Id="seal" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="seal.xml"/></Relationships>'
              ),
            "/seal.xml": '<seal xmlns="urn:original:seal"/>'
          }
        : {
            [main]: new TextDecoder()
              .decode(baseline.get(main))
              .replace(
                "</p:presentation>",
                '<p:modifyVerifier cryptProviderType="rsaAES"/></p:presentation>'
              )
          };
    const bytes = deck(changes);
    const original = await getXmlPart(bytes, slide, context);
    await expect(replaceXmlPart(bytes, slide, original.bytes, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
  });
});
