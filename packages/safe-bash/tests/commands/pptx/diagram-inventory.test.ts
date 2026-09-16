import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, readSelectionIndex } from "pptx";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { createDeckFixture } from "../../../../pptx/tests/fixtures/decks.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 131072, maxReads: 1000, chunkBytes: 8192 },
  archiveLimits: { maxArchiveBytes: 131072, maxEntryBytes: 32768, maxTotalBytes: 131072, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 32768, chunkSize: 8192 },
  xmlLimits: { maxBytes: 32768, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 32768, maxParts: 64, maxRelationships: 64 }
};

before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

function diagramDeck(mode: "complete" | "missing" | "fallback") {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const d = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const drawingRelation = "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing";
  const edge = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const files: Record<string, string | Uint8Array> = {
    "_rels/.rels": rels(edge("doc", `${r}/officeDocument`, "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="one"/><p:sldId id="257" r:id="two"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(edge("one", `${r}/slide`, "slides/one.xml") + edge("two", `${r}/slide`, "slides/two.xml")),
    "ppt/diagrams/drawing.xml": '<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:spTree/></dsp:drawing>',
    "ppt/diagrams/_rels/drawing.xml.rels": rels(edge("texture", `${r}/image`, "../media/texture.bin")),
    "ppt/media/texture.bin": new Uint8Array([13, 29, 61, 127])
  };
  for (const slide of ["one", "two"]) {
    files[`ppt/slides/${slide}.xml`] = `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Caption"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Garden route</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    files[`ppt/slides/_rels/${slide}.xml.rels`] = rels(mode === "fallback"
      ? edge("appearance", drawingRelation, "../diagrams/drawing.xml")
      : edge("data", `${r}/diagramData`, "../diagrams/data.xml") + edge("layout", `${r}/diagramLayout`, "../diagrams/layout.xml") + edge("style", `${r}/diagramQuickStyle`, "../diagrams/style.xml") + edge("colors", `${r}/diagramColors`, "../diagrams/colors.xml"));
  }
  const types = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    ...["one", "two"].map((slide) => `<Override PartName="/ppt/slides/${slide}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
    '<Override PartName="/ppt/diagrams/drawing.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>'
  ];
  if (mode !== "fallback") {
    for (const [name, kind, root] of [["data", "Data", "dataModel"], ["layout", "Layout", "layoutDef"], ["style", "Style", "styleDef"], ["colors", "Colors", "colorsDef"]]) {
      files[`ppt/diagrams/${name}.xml`] = `<d:${root} xmlns:d="${d}" uniqueId="garden-${name}"/>`;
      types.push(`<Override PartName="/ppt/diagrams/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagram${kind}+xml"/>`);
    }
    files["ppt/diagrams/_rels/data.xml.rels"] = rels(edge("appearance", drawingRelation, mode === "missing" ? "absent.xml" : "drawing.xml"));
  }
  files["[Content_Types].xml"] = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/>${types.join("")}</Types>`;
  const parts = Object.entries(files).map(([name, value]) => ({ name, bytes: typeof value === "string" ? new TextEncoder().encode(value) : value }));
  return { parts, bytes: storedArchive(parts) };
}

function setup(bytes: Uint8Array) {
  const volume = Volume.fromJSON({ "/work/deck.pptx": Buffer.from(bytes) });
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 131072, maxArgumentBytes: 8192 }) }));
  return { shell, volume };
}

for (const mode of ["complete", "missing", "fallback"] as const) {
  test(`pptx inspect reports ${mode} diagram graph without semantic editing`, async () => {
    const { bytes } = diagramDeck(mode);
    const { shell } = setup(bytes);
    const result = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.operation, "inspect");
    assert.equal(output.affected, 0);
    assert.deepEqual(output.errors, []);
    const owners = ["/ppt/slides/one.xml", "/ppt/slides/two.xml"];
    const expected = mode === "fallback" ? [] : [
      { part: "/ppt/diagrams/colors.xml", kind: "colors", owners, dependencies: [], missing: [], semanticEditing: false },
      { part: "/ppt/diagrams/data.xml", kind: "data", owners, dependencies: mode === "missing" ? [] : ["/ppt/diagrams/drawing.xml", "/ppt/media/texture.bin"], missing: mode === "missing" ? ["/ppt/diagrams/absent.xml"] : [], semanticEditing: false }
    ];
    expected.push({ part: "/ppt/diagrams/drawing.xml", kind: "drawing", owners: mode === "fallback" ? owners : mode === "missing" ? [] : ["/ppt/diagrams/data.xml"], dependencies: ["/ppt/media/texture.bin"], missing: [], semanticEditing: false });
    if (mode !== "fallback") {
      expected.push({ part: "/ppt/diagrams/layout.xml", kind: "layout", owners, dependencies: [], missing: [], semanticEditing: false });
      expected.push({ part: "/ppt/diagrams/style.xml", kind: "style", owners, dependencies: [], missing: [], semanticEditing: false });
    }
    assert.deepEqual(output.data.inventory.diagrams, expected);
    const sdk = await readSelectionIndex(bytes, context);
    assert.deepEqual(sdk.inventory.diagrams, expected);
  });
}

function editableDiagramDeck() {
  const fixture = createDeckFixture("coastal-observatory");
  const additions = diagramDeck("complete");
  for (const part of additions.parts.filter((part) => part.name.startsWith("ppt/diagrams/") || part.name.startsWith("ppt/media/"))) {
    const path = `${fixture.root}/${part.name}`;
    fixture.volume.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    fixture.volume.writeFileSync(path, part.bytes);
  }
  for (const [destination, origin, selected] of [
    ["[Content_Types].xml", "[Content_Types].xml", "Override"],
    ["ppt/slides/_rels/slide1.xml.rels", "ppt/slides/_rels/one.xml.rels", "Relationship"]
  ]) {
    const path = `${fixture.root}/${destination}`;
    const document = parseXmlPart(new Uint8Array(fixture.volume.readFileSync(path) as Buffer), context.xmlLimits);
    const extra = parseXmlPart(additions.parts.find((part) => part.name === origin)!.bytes, context.xmlLimits);
    const children = extra.root.children.filter((node) => node.name.localName === selected && (selected === "Relationship" || node.attributes.some((attribute) => attribute.value.startsWith("/ppt/diagrams/"))));
    const markup = children.map((node) => extra.markup(node, true));
    if (selected === "Override") markup.push('<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/media/texture.bin" ContentType="image/bmp"/>');
    fixture.volume.writeFileSync(path, document.spliceChildren(document.root, document.root.children.length, 0, markup).bytes());
  }
  const parts = Object.entries(fixture.volume.toJSON()).filter(([, value]) => value !== null).map(([path]) => ({ name: path.slice(fixture.root.length + 1), bytes: new Uint8Array(fixture.volume.readFileSync(path) as Buffer) }));
  return { parts, bytes: storedArchive(parts) };
}

test("pptx text replace preserves every unrelated diagram appearance part byte", async () => {
  const source = editableDiagramDeck();
  const { shell, volume } = setup(source.bytes);
  const result = await shell.exec("pptx text replace deck.pptx --find 'Coastal observatory' --with 'Orchard path' --all --output -");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const written = inspectZip(result.stdoutBytes);
  assert.deepEqual(written.map((part) => part.name).sort(), source.parts.map((part) => part.name).sort());
  for (const original of source.parts) {
    const actual = written.find((part) => part.name === original.name)!.payload;
    if (original.name === "ppt/slides/slide1.xml") {
      assert.ok(new TextDecoder().decode(actual).includes("Orchard path"));
    } else {
      assert.deepEqual(actual, original.bytes, original.name);
    }
  }
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), source.bytes);
});

test("pptx capabilities advertises diagram preservation without layout or semantic editing", async () => {
  const { shell } = setup(diagramDeck("fallback").bytes);
  const result = await shell.exec("pptx capabilities --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const { subset, ...features } = JSON.parse(result.stdout).data.features.diagrams;
  assert.ok(subset.includes("Full semantic editing and automatic layout are unsupported."));
  assert.deepEqual(features, {
    level: "preserve", operations: ["inspect", "slides.import"], semanticEditing: false, automaticLayout: false
  });
});

test("pptx slides import preserves colliding diagram appearance resources and closure", async () => {
  const source = editableDiagramDeck();
  const { shell, volume } = setup(source.bytes);
  volume.writeFileSync("/work/source.pptx", source.bytes);
  const result = await shell.exec("pptx slides import deck.pptx --source source.pptx --source-slides '[1]' --theme-policy source --output -");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const written = inspectZip(result.stdoutBytes);
  for (const name of ["ppt/diagrams/data.xml", "ppt/diagrams/layout.xml", "ppt/diagrams/style.xml", "ppt/diagrams/colors.xml", "ppt/diagrams/drawing.xml", "ppt/media/texture.bin"]) {
    const original = source.parts.find((part) => part.name === name)!.bytes;
    const dot = name.lastIndexOf(".");
    const copies = written.filter((part) => [name, `${name.slice(0, dot)}-import1${name.slice(dot)}`].includes(part.name));
    assert.equal(copies.length, 2, name);
    for (const copy of copies) assert.deepEqual(copy.payload, original, copy.name);
  }
  const dataRelations = parseXmlPart(written.find((part) => part.name === "ppt/diagrams/_rels/data-import1.xml.rels")!.payload, context.xmlLimits);
  assert.deepEqual(dataRelations.root.children.map((node) => Object.fromEntries(node.attributes.map((attribute) => [attribute.name.localName, attribute.value]))), [{
    Id: "appearance", Type: "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing", Target: "drawing-import1.xml"
  }]);
  const drawingRelations = parseXmlPart(written.find((part) => part.name === "ppt/diagrams/_rels/drawing-import1.xml.rels")!.payload, context.xmlLimits);
  assert.equal(drawingRelations.root.children[0]!.attributes.find((attribute) => attribute.name.localName === "Target")!.value, "../media/texture-import1.bin");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), source.bytes);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer), source.bytes);
});
