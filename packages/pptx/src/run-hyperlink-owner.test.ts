import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as sdk from "./index.js";

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

async function blank() {
  return sdk.Presentation(
    await sdk.createPresentation({ slides: [{ name: "Garden study" }] }, context),
    context
  );
}
it("edits live run hyperlinks with relationship reuse and save/reopen", async () => {
  const deck = await blank();
  const shape = deck.slides[0]!.shapes.add_textbox(
    new sdk.Inches(0),
    new sdk.Inches(0),
    new sdk.Inches(2),
    new sdk.Inches(1)
  );
  const first = shape.text_frame.paragraphs[0]!.add_run();
  first.text = "Forecast";
  const second = shape.text_frame.paragraphs[0]!.add_run();
  second.text = "Details";
  const link = first.hyperlink;
  expect(link.address).toBeNull();
  link.address = "https://example.invalid/weather";
  second.hyperlink.address = link.address;
  first.font.bold = true;
  expect(link.address).toBe("https://example.invalid/weather");
  let saved = await deck.save();
  expect((await sdk.listLinks(saved, {}, context)).map((value) => value.url)).toEqual([
    link.address,
    link.address
  ]);
  expect(deck.slides[0]!.part.rels.filter((rel) => rel.type.endsWith("/hyperlink"))).toHaveLength(
    1
  );
  const reopened = await sdk.Presentation(saved, context);
  expect(
    (reopened.slides[0]!.shapes[0] as sdk.Shape).text_frame.paragraphs[0]!.runs[0]!.hyperlink
      .address
  ).toBe(link.address);
  first.hyperlink.address = null;
  expect(first.hyperlink.address).toBeNull();
  expect(second.hyperlink.address).toBe("https://example.invalid/weather");
  saved = await deck.save();
  expect(await sdk.listLinks(saved, {}, context)).toHaveLength(1);
});
it("rejects active URLs atomically and invalidates cached links after run replacement", async () => {
  const deck = await blank();
  const frame = deck.slides[0]!.shapes.add_textbox(
    new sdk.Inches(0),
    new sdk.Inches(0),
    new sdk.Inches(2),
    new sdk.Inches(1)
  ).text_frame;
  const run = frame.paragraphs[0]!.add_run();
  run.text = "Archive";
  const link = run.hyperlink;
  const before = await deck.save();
  expect(() => {
    link.address = "javascript:alert(1)";
  }).toThrow();
  expect(await deck.save()).toEqual(before);
  frame.text = "Replacement";
  expect(() => link.address).toThrow(expect.objectContaining({ code: "invalid-handle" }));
  expect(() => {
    link.address = "https://example.invalid/new";
  }).toThrow(expect.objectContaining({ code: "invalid-handle" }));
});

it("shares run link edits with the SDK-backed command route through explicit memory I/O", async () => {
  const volume = Volume.fromJSON({});
  const deck = await blank();
  const shape = deck.slides[0]!.shapes.add_textbox(
    new sdk.Inches(0),
    new sdk.Inches(0),
    new sdk.Inches(3),
    new sdk.Inches(1)
  );
  shape.name = "Weather link";
  const run = shape.text_frame.paragraphs[0]!.add_run();
  run.text = "Forecast";
  run.hyperlink.address = "https://example.invalid/first";
  const source = await deck.save();
  volume.writeFileSync("/source.pptx", source);
  const records = await sdk.listLinks(source, {}, context);
  const result = await sdk
    .createPptxCommandEngine({ context, maxArgumentBytes: 100000, maxOutputBytes: 1000000 })
    .execute({
      args: [
        "links",
        "set",
        "/source.pptx",
        "--slide",
        "1",
        "--shape",
        "Weather link",
        "--path",
        JSON.stringify(records[0]!.path.slice(0, -1)),
        "--url",
        "https://example.invalid/second",
        "--in-place",
        "--json"
      ].map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput: async (output) => {
        volume.writeFileSync(output.outputPath, output.bytes);
      }
    });
  expect(result.exitCode, new TextDecoder().decode(result.stdout)).toBe(0);
  const edited = await sdk.Presentation(
    new Uint8Array(volume.readFileSync("/source.pptx") as Buffer),
    context
  );
  expect(
    (edited.slides[0]!.shapes[0] as sdk.Shape).text_frame.paragraphs[0]!.runs[0]!.hyperlink.address
  ).toBe("https://example.invalid/second");
});

it("resolves cached run links after paragraph insertion and new slide creation", async () => {
  const deck = await blank();
  const shape = deck.slides[0]!.shapes.add_textbox(
    new sdk.Inches(0),
    new sdk.Inches(0),
    new sdk.Inches(3),
    new sdk.Inches(1)
  );
  const paragraph = shape.text_frame.add_paragraph();
  const run = paragraph.add_run();
  run.text = "Observatory";
  const link = run.hyperlink;
  link.address = "https://example.invalid/observatory";
  shape.text_frame.paragraphs[0]!.add_run().text = "Location";
  deck.slides.add_slide(deck.slide_layouts[0]!);
  link.address = "https://example.invalid/revised";
  const read = await sdk.Presentation(await deck.save(), context);
  expect(read.slides.length).toBe(2);
  expect(
    (read.slides[0]!.shapes[0] as sdk.Shape).text_frame.paragraphs[1]!.runs[0]!.hyperlink.address
  ).toBe("https://example.invalid/revised");
});

it("reports a typed unavailable-property error for detached run owners", () => {
  const shape = new sdk.Shape(
    sdk.parseXmlPart(
      new TextEncoder().encode(
        sdk.createShapeXml("RECTANGLE", 2, {
          text: "Detached",
          left: new sdk.Inches(0),
          top: new sdk.Inches(0),
          width: new sdk.Inches(2),
          height: new sdk.Inches(1)
        })
      ),
      context.xmlLimits
    )
  );
  expect(() => shape.text_frame.paragraphs[0]!.runs[0]!.hyperlink).toThrow(sdk.PropertyAccessError);
});
