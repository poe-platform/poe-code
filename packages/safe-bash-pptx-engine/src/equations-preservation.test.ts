import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  createPresentation,
  TextFrame,
  Shape,
  duplicateSlides,
  importSlides,
  mutateTextFrames,
  mutateTextParagraphs,
  mutateTextRuns,
  replacePresentationText,
  createPptxCommandEngine,
  type PptxPublicationRequest
} from "./index.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
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
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const m = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const math = "<m:oMath><m:r><m:t>x+2</m:t></m:r></m:oMath>";
const fallback = `<mc:AlternateContent><mc:Choice Requires="m">${math}</mc:Choice><mc:Fallback><a:r><a:t>equation image</a:t></a:r></mc:Fallback></mc:AlternateContent>`;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
async function fixture(content: string, mathNamespace = m, ignorable = true) {
  const bytes = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Calculation", x: 0, y: 0, width: 200, height: 100, text: "Seed" }] }
      ]
    },
    context
  );
  const entries = inspectZip(bytes);
  const slide = entries.find((e) => e.name === "ppt/slides/slide1.xml")!;
  const xml = parseXmlPart(slide.payload, context.xmlLimits);
  const tree = xml.root.children
    .find((n) => n.name.localName === "cSld")!
    .children.find((n) => n.name.localName === "spTree")!;
  const body = tree.children
    .find((n) => n.name.localName === "sp")!
    .children.find((n) => n.name.localName === "txBody")!;
  const p = body.children.findIndex((n) => n.name.localName === "p");
  const paragraph = `<a:p xmlns:a="${a}" xmlns:m="${mathNamespace}" xmlns:mc="${mc}" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" ${ignorable ? 'mc:Ignorable="m a14"' : ""}><a:r><a:t>left</a:t></a:r>${content}<a:r><a:t>right</a:t></a:r></a:p>`;
  const edited = xml.spliceChildren(body, p, 1, [paragraph]);
  return storedArchive(
    entries.map((e) => ({ name: e.name, bytes: e === slide ? edited.bytes() : e.payload }))
  );
}
function slideXml(bytes: Uint8Array, name = "ppt/slides/slide1.xml") {
  return decode(inspectZip(bytes).find((e) => e.name === name)!.payload);
}
it.each([
  ["inline", math],
  ["alternative", fallback]
] as const)(
  "preserves opaque %s equation boundaries during adjacent literal replacement",
  async (_kind, content) => {
    const source = await fixture(content);
    const result = await replacePresentationText(
      source,
      { find: "leftright", with: "joined", all: true, allowEmpty: true },
      context
    );
    expect(result.affected).toBe(0);
    expect(result.bytes).toEqual(source);
    const changed = await replacePresentationText(
      source,
      { find: "right", with: "east", all: true },
      context
    );
    expect(changed.affected).toBe(1);
    expect(slideXml(changed.bytes)).toContain(content);
    expect(slideXml(changed.bytes)).toContain("<a:t>east</a:t>");
  }
);
it("does not replace the cached fallback text of an equation", async () => {
  const source = await fixture(fallback);
  const result = await replacePresentationText(
    source,
    { find: "equation image", with: "deleted", all: true, allowEmpty: true },
    context
  );
  expect(result.affected).toBe(0);
  expect(result.bytes).toEqual(source);
});
it.each(["frame", "paragraph"] as const)(
  "preserves equation markup and fallbacks during %s formatting",
  async (operation) => {
    const source = await fixture(math + fallback);
    const result =
      operation === "frame"
        ? await mutateTextFrames(source, { all: true, marginLeft: 4 }, context)
        : await mutateTextParagraphs(source, { all: true, alignment: "center" }, context);
    expect(result.affected).toBe(1);
    expect(slideXml(result.bytes)).toContain(math + fallback);
  }
);
it.each(["duplicate", "import"] as const)(
  "preserves equation markup and fallback during slide %s",
  async (operation) => {
    const source = await fixture(math + fallback);
    const result =
      operation === "duplicate"
        ? await duplicateSlides(
            source,
            { selection: { kind: "slide", id: "256" }, position: 2 },
            context
          )
        : await importSlides(
            await createPresentation({ slides: [] }, context),
            source,
            { sourceSlides: [1] },
            context
          );
    const slides = inspectZip(result).filter(
      (e) => e.name.startsWith("ppt/slides/slide") && e.name.endsWith(".xml")
    );
    expect(slides).toHaveLength(operation === "duplicate" ? 2 : 1);
    for (const slide of slides) expect(decode(slide.payload)).toContain(math + fallback);
  }
);
it("honors equation barriers through the text replace command with admitted memory I/O", async () => {
  const source = await fixture(math);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", source);
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  const result = await engine.execute({
    args: [
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "leftright",
      "--with",
      "joined",
      "--all",
      "--allow-empty",
      "--output",
      "/out.pptx",
      "--json"
    ].map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async (publication: PptxPublicationRequest) => {
      volume.writeFileSync(publication.outputPath, publication.bytes);
    }
  });
  expect(result.exitCode, decode(result.stderr)).toBe(0);
  expect(JSON.parse(decode(result.stdout))).toMatchObject({
    ok: true,
    operation: "text.replace",
    affected: 0
  });
  expect(new Uint8Array(volume.readFileSync("/out.pptx") as Buffer)).toEqual(source);
});

it.each([m, "http://purl.oclc.org/ooxml/officeDocument/math"])(
  "preserves a drawing math wrapper in namespace %s",
  async (namespace) => {
    const wrapped = `<a14:m>${math}</a14:m>`;
    const source = await fixture(wrapped, namespace);
    const result = await replacePresentationText(
      source,
      { find: "leftright", with: "joined", all: true, allowEmpty: true },
      context
    );
    expect(result.bytes).toEqual(source);
    const copied = await duplicateSlides(
      source,
      { selection: { kind: "slide", id: "256" }, position: 2 },
      context
    );
    const copies = inspectZip(copied).filter(
      (entry) => entry.name.startsWith("ppt/slides/") && entry.name.endsWith(".xml")
    );
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect(decode(copy.payload)).toContain(wrapped);
  }
);
it.each([
  '<m:oMath><m:r xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="absent"><m:t>x</m:t></m:r></m:oMath>',
  '<m:oMath><m:extension xmlns:v="urn:opaque-equation" v:reference="outside"/></m:oMath>',
  '<m:oMath><v:extension xmlns:v="urn:opaque-equation"/></m:oMath>'
])("rejects unsafe equation remapping before returning a copied package %s", async (content) => {
  const source = await fixture(content);
  await expect(
    duplicateSlides(source, { selection: { kind: "slide", id: "256" }, position: 2 }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("preserves malformed opaque mathematical content during literal text editing", async () => {
  const content = '<m:oMath><m:f><m:num/></m:f><m:unknown m:setting="retain"/></m:oMath>';
  const source = await fixture(content);
  const changed = await replacePresentationText(
    source,
    { find: "right", with: "east", all: true },
    context
  );
  expect(slideXml(changed.bytes)).toContain(content);
});
it("preserves nonignorable mathematics during adjacent text editing", async () => {
  const source = await fixture(math, m, false);
  const changed = await replacePresentationText(
    source,
    { find: "right", with: "east", all: true },
    context
  );
  expect(slideXml(changed.bytes)).toContain(math);
});

it("preserves equation fallback runs during ordinary run formatting", async () => {
  const source = await fixture(fallback);
  const changed = await mutateTextRuns(source, { all: true, bold: true }, context);
  expect(changed.affected).toBe(2);
  expect(slideXml(changed.bytes)).toContain(fallback);
});
it("rejects targeted assignment into an equation fallback", async () => {
  const source = await fixture(fallback);
  await expect(
    mutateTextRuns(source, { paragraph: 0, run: 1, text: "new cache" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each([math, fallback])(
  "rejects whole-frame text replacement that would delete protected mathematics %s",
  async (content) => {
    const source = await fixture(content);
    const code = await mutateTextFrames(source, { all: true, text: "Replacement" }, context).then(
      () => null,
      (error: { code: string }) => error.code
    );
    expect(code).toBe("unsupported-edit");
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/deck.pptx", source);
    const publishOutput = vi.fn();
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 65536,
      maxOutputBytes: 65536
    });
    const result = await engine.execute({
      args: [
        "text",
        "frames",
        "set",
        "/deck.pptx",
        "--text",
        "Replacement",
        "--all",
        "--output",
        "/out.pptx",
        "--json"
      ].map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput
    });
    expect(result.exitCode).not.toBe(0);
    expect(publishOutput).not.toHaveBeenCalled();
    expect(new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer)).toEqual(source);
  }
);
it.each(["frame", "shape"] as const)(
  "rejects destructive %s model text assignment without changing original XML",
  (model) => {
    const body = `<p:txBody xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${a}" xmlns:m="${m}" xmlns:mc="${mc}"><a:bodyPr/><a:p>${fallback}</a:p></p:txBody>`;
    const source =
      model === "frame"
        ? body
        : `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${a}"><p:nvSpPr><p:cNvPr id="2" name="Calculation"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>${body}</p:sp>`;
    const xml = parseXmlPart(new TextEncoder().encode(source), context.xmlLimits);
    const object = model === "frame" ? new TextFrame(xml) : new Shape(xml);
    expect(() => {
      object.text = "Replacement";
    }).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    expect(decode(object.xml.bytes())).toBe(source);
  }
);
