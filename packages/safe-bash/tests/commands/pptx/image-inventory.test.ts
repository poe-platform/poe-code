import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine } from "pptx";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 8192, maxTotalBytes: 32768, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 8192, chunkSize: 512 },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 64, maxRelationships: 64 },
};
const raster = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const vector = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><path d="M0 0L2 3"/></svg>';

function imageDeck() {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const relations = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const link = (id: string, type: string, target: string, external = false) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
  const picture = (id: number, relationship: string, linked = false, svg = false) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Coast ${id}" descr="Blue inlet" title="Tide"/></p:nvPicPr><p:blipFill><a:blip r:${linked ? "link" : "embed"}="${relationship}">${svg ? '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="vector"/></a:ext></a:extLst>' : ""}</a:blip><a:srcRect l="12500" t="25000" r="0" b="5000"/></p:blipFill><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:pic>`;
  const scene = (tag: string, body: string, background = "") => `<p:${tag} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld>${background}<p:spTree>${body}</p:spTree></p:cSld></p:${tag}>`;
  const files: Record<string, string | Uint8Array> = {
    "_rels/.rels": relations(link("document", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="300" r:id="slide"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relations(link("slide", "slide", "slides/slide1.xml") + link("master", "slideMaster", "slideMasters/master1.xml")),
    "ppt/slides/slide1.xml": scene("sld", picture(2, "art") + picture(3, "copy") + picture(4, "remote", true) + picture(5, "art", false, true)),
    "ppt/slides/_rels/slide1.xml.rels": relations(link("art", "image", "../media/coast.png") + link("copy", "image", "../media/copy.png") + link("vector", "image", "../media/coast.svg") + link("remote", "image", "https://invalid.example/art.svg", true) + link("layout", "slideLayout", "../slideLayouts/layout1.xml") + link("notes", "notesSlide", "../notesSlides/notes1.xml")),
    "ppt/slideLayouts/layout1.xml": scene("sldLayout", ""),
    "ppt/slideLayouts/_rels/layout1.xml.rels": relations(link("master", "slideMaster", "../slideMasters/master1.xml")),
    "ppt/slideMasters/master1.xml": scene("sldMaster", picture(8, "art"), '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="art"/></a:blipFill></p:bgPr></p:bg>'),
    "ppt/slideMasters/_rels/master1.xml.rels": relations(link("art", "image", "../media/coast.png") + link("layout", "slideLayout", "../slideLayouts/layout1.xml")),
    "ppt/notesSlides/notes1.xml": scene("notes", picture(9, "art")),
    "ppt/notesSlides/_rels/notes1.xml.rels": relations(link("art", "image", "../media/coast.png")),
    "ppt/media/coast.png": raster,
    "ppt/media/copy.png": raster,
    "ppt/media/coast.svg": vector,
  };
  const types = [["presentation.xml", "presentation.main"], ["slides/slide1.xml", "slide"], ["slideLayouts/layout1.xml", "slideLayout"], ["slideMasters/master1.xml", "slideMaster"], ["notesSlides/notes1.xml", "notesSlide"]].map(([part, type]) => `<Override PartName="/ppt/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join("");
  files["[Content_Types].xml"] = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>${types}</Types>`;
  return storedArchive(Object.entries(files).map(([name, value]) => ({ name, bytes: typeof value === "string" ? new TextEncoder().encode(value) : value })));
}

function setup() {
  const bytes = imageDeck();
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/coastal deck.pptx", bytes);
  const reads: string[] = [];
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    reads.push(path);
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 }) }));
  return { shell, reads, volume, bytes };
}

test("pptx images list exposes occurrence metadata and deduplicates media only explicitly", async () => {
  const { shell, reads, volume, bytes } = setup();
  const schema = await shell.exec("pptx schema images list --json");
  assert.equal(schema.exitCode, 0, schema.stdout + schema.stderr);
  const validator = compileJsonSchema(JSON.parse(schema.stdout).data.operations["images.list"].result);
  for (const unique of [false, true]) {
    const result = await shell.exec(`pptx images list 'coastal deck.pptx' --json${unique ? " --unique" : ""}`);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout);
    const validation = validator.validate(envelope);
    assert.equal(validation.ok, true, JSON.stringify(validation));
    assert.equal(envelope.operation, "images.list");
    assert.equal(envelope.version, 1);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.errors, []);
    const { occurrences, media } = envelope.data;
    assert.equal(occurrences.length, 5);
    assert.equal(media.length, unique ? 2 : 3);
    const first = occurrences[0];
    assert.equal(first.sourcePart, "/ppt/slides/slide1.xml");
    assert.equal(first.relationshipId, "art");
    assert.equal(first.shapeId, "2");
    assert.equal(first.shapeName, "Coast 2");
    assert.equal(first.altText, "Blue inlet");
    assert.equal(first.title, "Tide");
    assert.equal(first.scope, "slides");
    assert.equal(first.mediaPart, "/ppt/media/coast.png");
    assert.equal(first.contentType, "image/png");
    assert.equal(first.bytes, 8);
    assert.equal(first.sha256, createHash("sha256").update(raster).digest("hex"));
    assert.deepEqual(first.crop, { left: 0.125, top: 0.25, right: 0, bottom: 0.05 });
    assert.deepEqual(first.geometry, {
      coordinateSystem: "slide", unit: "emu", groupPath: [],
      corners: [{ x: 100, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 600 }, { x: 100, y: 600 }],
    });
    assert.equal(envelope.locations[0].scope, "slides");
    assert.equal(typeof envelope.locations[0].fingerprint, "string");
    const remote = occurrences.find((item: { external: boolean }) => item.external);
    assert.equal(remote.target, "https://invalid.example/art.svg");
    assert.equal(remote.mediaPart, null);
    assert.equal(remote.sha256, null);
    assert.equal(remote.bytes, null);
    assert.equal(remote.contentType, null);
    assert.deepEqual(occurrences.filter((item: { shapeId: string }) => item.shapeId === "5").map((item: { role: string }) => item.role).sort(), ["fallback", "svg"]);
    if (unique) assert.deepEqual(media.find((item: { contentType: string }) => item.contentType === "image/png").parts, ["/ppt/media/coast.png", "/ppt/media/copy.png"]);
  }
  assert.deepEqual(reads, ["/work/coastal deck.pptx", "/work/coastal deck.pptx"]);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/coastal deck.pptx") as Buffer), bytes);
});

test("pptx image inventory scopes isolate inherited master backgrounds and notes", async () => {
  const { shell } = setup();
  for (const [scope, count, shape] of [["masters", 2, "8"], ["notes", 1, "9"]] as const) {
    const result = await shell.exec(`pptx images list 'coastal deck.pptx' --scope ${scope} --slide 1 --json`);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const { occurrences } = JSON.parse(result.stdout).data;
    assert.equal(occurrences.length, count);
    assert.ok(occurrences.every((item: { scope: string }) => item.scope === scope));
    assert.ok(occurrences.some((item: { shapeId: string }) => item.shapeId === shape));
    if (scope === "masters") {
      assert.ok(occurrences.some((item: { kind: string }) => item.kind === "background"));
      assert.ok(occurrences.every((item: { inheritedBy: number[] }) => JSON.stringify(item.inheritedBy) === "[1]"));
    }
  }
  const selected = await shell.exec("pptx images list 'coastal deck.pptx' --slide 1 --image 2 --json");
  assert.equal(selected.exitCode, 0, selected.stdout + selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout).data.occurrences.map((item: { shapeId: string }) => item.shapeId), ["3"]);
});

test("pptx image inventory publishes its schema and rejects invalid selector combinations before reading", async () => {
  const { shell, reads } = setup();
  const schema = await shell.exec("pptx schema images list --json");
  assert.equal(schema.exitCode, 0, schema.stdout + schema.stderr);
  assert.deepEqual(Object.keys(JSON.parse(schema.stdout).data.operations), ["images.list"]);
  const validator = compileJsonSchema(JSON.parse(schema.stdout).data.operations["images.list"].result);
  const help = await shell.exec("pptx images list --help");
  assert.equal(help.exitCode, 0, help.stderr);
  assert.ok(help.stdout.includes("--unique"));
  assert.ok(help.stdout.includes("--image"));
  const capabilities = await shell.exec("pptx capabilities --json");
  assert.equal(capabilities.exitCode, 0, capabilities.stderr);
  assert.deepEqual(JSON.parse(capabilities.stdout).data.features.images.operations, ["images.extract", "images.set", "images.replace", "images.add", "images.list"]);
  for (const flags of ["--image 0", "--image 1.5", "--unique --unique", "--scope nowhere", "--scope presentation", "--select token --image 1", "--output changed.pptx", "--all"]) {
    const result = await shell.exec(`pptx images list 'coastal deck.pptx' ${flags} --json`);
    assert.equal(result.exitCode, 2, flags + result.stdout + result.stderr);
    const error = JSON.parse(result.stdout);
    const validation = validator.validate(error);
    assert.equal(validation.ok, true, JSON.stringify(validation));
    assert.equal(error.operation, "images.list");
    assert.equal(error.ok, false);
    assert.equal(error.data, null);
    assert.equal(error.affected, 0);
  }
  assert.deepEqual(reads, []);
});

test("pptx image inventory human unique output lists hashes and all shared part names", async () => {
  const { shell } = setup();
  const result = await shell.exec("pptx images list 'coastal deck.pptx' --unique");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(createHash("sha256").update(raster).digest("hex")), result.stdout);
  assert.ok(result.stdout.includes("/ppt/media/coast.png"), result.stdout);
  assert.ok(result.stdout.includes("/ppt/media/copy.png"), result.stdout);
  assert.ok(result.stdout.includes("image/png"), result.stdout);
  assert.ok(result.stdout.includes("3 occurrences"), result.stdout);
});
