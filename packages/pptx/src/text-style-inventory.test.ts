import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readSelectionIndex, createPptxCommandEngine } from "./index.js";
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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encode = (s: string) => new TextEncoder().encode(s);
function fixture() {
  const rels = (items: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
  const edge = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  return storedArchive(
    Object.entries({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
      "_rels/.rels": rels(edge("main", "officeDocument", "deck.xml")),
      "deck.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="300" r:id="slide"/></p:sldIdLst></p:presentation>`,
      "_rels/deck.xml.rels": rels(edge("slide", "slide", "slide.xml")),
      "slide.xml": `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="8" name="Harbor"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr b="0" sz="1850"><a:latin typeface="Aperture"/><a:solidFill><a:srgbClr val="A1B2C3"/></a:solidFill></a:rPr><a:t>North</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    }).map(([name, xml]) => ({ name, bytes: encode(xml) }))
  );
}
describe("text style inventory", () => {
  it("exposes independent expected values through SDK and inspect without writing bytes", async () => {
    const volume = Volume.fromJSON({});
    const bytes = fixture();
    volume.writeFileSync("/deck.pptx", bytes);
    const sdk = await readSelectionIndex(bytes, context);
    expect(sdk.inventory.textStyles).toMatchObject([
      {
        part: "/slide.xml",
        shapeId: "8",
        properties: {
          bold: { value: false },
          size: { value: 18.5 },
          latin: { value: "Aperture" },
          color: { value: "A1B2C3" },
          italic: { status: "absent" }
        }
      }
    ]);
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 65536
    });
    const run = async (args: string[]) =>
      engine.execute({
        args: args.map(encode),
        signal: new AbortController().signal,
        readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer)
      });
    const cli = await run(["inspect", "/deck.pptx", "--json"]);
    expect(cli.exitCode).toBe(0);
    const envelope = JSON.parse(new TextDecoder().decode(cli.stdout));
    expect(envelope.data.inventory.textStyles[0].properties.color).toMatchObject({
      value: "A1B2C3",
      token: "A1B2C3",
      source: { part: "/slide.xml", layer: "run" }
    });
    const schema = JSON.parse(
      new TextDecoder().decode((await run(["schema", "inspect", "--json"])).stdout)
    );
    expect(compileJsonSchema(schema.data.operations.inspect.result).validate(envelope).ok).toBe(
      true
    );
    expect(new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer)).toEqual(bytes);
  });
});
