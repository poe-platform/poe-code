import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine } from "pptx";
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

function inventoryDeck(shuffled: boolean) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const link = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const relations = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const shape = (id: number) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panel ${id}"/></p:nvSpPr></p:sp>`;
  const scene = (tag: string, body: string, attributes = "") => `<p:${tag} xmlns:p="${p}" ${attributes}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:${tag}>`;
  const files: Record<string, string | Uint8Array> = {
    "_rels/.rels": relations(link("document", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483649" r:id="secondMaster"/><p:sldMasterId id="2147483648" r:id="firstMaster"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="811" r:id="firstSlide"/><p:sldId id="307" r:id="secondSlide"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relations(link("secondSlide", "slide", "slides/slide2.xml") + link("firstMaster", "slideMaster", "slideMasters/masterA.xml") + link("firstSlide", "slide", "slides/slide90.xml") + link("secondMaster", "slideMaster", "slideMasters/masterB.xml")),
    "ppt/slides/slide90.xml": scene("sld", shape(2) + shape(3), 'show="0"'),
    "ppt/slides/slide2.xml": scene("sld", shape(2)),
    "ppt/slides/_rels/slide90.xml.rels": relations(link("layout", "slideLayout", "../slideLayouts/layoutB.xml") + link("notes", "notesSlide", "../notesSlides/notes1.xml") + link("art", "image", "../media/dot.png")),
    "ppt/slides/_rels/slide2.xml.rels": relations(link("layout", "slideLayout", "../slideLayouts/layoutA.xml")),
    "ppt/notesSlides/notes1.xml": scene("notes", shape(40) + shape(41) + shape(42)),
    "ppt/slideMasters/masterA.xml": scene("sldMaster", shape(20) + shape(21)),
    "ppt/slideMasters/masterB.xml": scene("sldMaster", shape(30)),
    "ppt/slideMasters/_rels/masterA.xml.rels": relations(link("layout", "slideLayout", "../slideLayouts/layoutA.xml") + link("theme", "theme", "../theme/themeA.xml")),
    "ppt/slideMasters/_rels/masterB.xml.rels": relations(link("layout", "slideLayout", "../slideLayouts/layoutB.xml") + link("theme", "theme", "../theme/themeB.xml")),
    "ppt/slideLayouts/layoutA.xml": scene("sldLayout", shape(10)),
    "ppt/slideLayouts/layoutB.xml": scene("sldLayout", shape(11)),
    "ppt/slideLayouts/_rels/layoutA.xml.rels": relations(link("master", "slideMaster", "../slideMasters/masterA.xml")),
    "ppt/slideLayouts/_rels/layoutB.xml.rels": relations(link("master", "slideMaster", "../slideMasters/masterB.xml")),
    "ppt/theme/themeA.xml": `<a:theme xmlns:a="${a}" name="Sand"/>`,
    "ppt/theme/themeB.xml": `<a:theme xmlns:a="${a}" name="Forest"/>`,
    "ppt/media/dot.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    "extras/payload.bin": new Uint8Array([7, 11, 19]),
  };
  const types = [
    ["presentation.xml", "presentation.main"], ["slides/slide90.xml", "slide"], ["slides/slide2.xml", "slide"],
    ["slideMasters/masterA.xml", "slideMaster"], ["slideMasters/masterB.xml", "slideMaster"],
    ["slideLayouts/layoutA.xml", "slideLayout"], ["slideLayouts/layoutB.xml", "slideLayout"], ["notesSlides/notes1.xml", "notesSlide"],
  ].map(([part, type]) => `<Override PartName="/ppt/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join("");
  files["[Content_Types].xml"] = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/octet-stream"/>${types}</Types>`;
  const members = Object.entries(files).map(([name, value]) => ({ name, bytes: typeof value === "string" ? new TextEncoder().encode(value) : value }));
  return storedArchive(shuffled ? members.reverse() : members);
}

for (const shuffled of [false, true]) {
  test(`pptx CLI inventories both master graphs and slide-local counts with ${shuffled ? "shuffled" : "original"} package entries`, async () => {
    const volume = Volume.fromJSON({ "/work": null });
    volume.writeFileSync("/work/deck.pptx", inventoryDeck(shuffled));
    const fs = new MemoryFileSystem();
    fs.readStream = async function* (path, options) {
      options?.signal?.throwIfAborted();
      yield new Uint8Array(volume.readFileSync(path) as Buffer);
    };
    const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 }) }));
    const result = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.operation, "inspect");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.errors, []);
    assert.deepEqual(envelope.data.records.map((record: { id: string }) => record.id), ["811"]);
    const inventory = envelope.data.inventory;
    assert.ok(inventory, "inspection must expose the full input inventory alongside selected records");
    assert.deepEqual(inventory.features, { structure: true, slideVisibility: true, effectiveFormatting: false, mediaMetadata: false, editing: false });
    assert.deepEqual(inventory.counts, { slides: 2, masters: 2, layouts: 2, themes: 2, slideShapes: 3, parts: 12, media: 1 });
    assert.deepEqual(inventory.slides, [
      { id: "811", part: "/ppt/slides/slide90.xml", position: 1, shapeCount: 2, layout: "/ppt/slideLayouts/layoutB.xml", master: "/ppt/slideMasters/masterB.xml", theme: "/ppt/theme/themeB.xml", show: { explicit: false, effective: false } },
      { id: "307", part: "/ppt/slides/slide2.xml", position: 2, shapeCount: 1, layout: "/ppt/slideLayouts/layoutA.xml", master: "/ppt/slideMasters/masterA.xml", theme: "/ppt/theme/themeA.xml", show: { explicit: null, effective: true } },
    ]);
    assert.deepEqual(inventory.masters, ["/ppt/slideMasters/masterA.xml", "/ppt/slideMasters/masterB.xml"]);
    assert.deepEqual(inventory.layouts, ["/ppt/slideLayouts/layoutA.xml", "/ppt/slideLayouts/layoutB.xml"]);
    assert.deepEqual(inventory.themes, ["/ppt/theme/themeA.xml", "/ppt/theme/themeB.xml"]);
    assert.deepEqual(inventory.media, [{ part: "/ppt/media/dot.png", contentType: "image/png", bytes: 8, sha256: createHash("sha256").update(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).digest("hex") }]);
    assert.ok(inventory.unsupported.some((item: { part: string; reason: string }) => item.part === "/extras/payload.bin" && item.reason.length > 0));
    assert.ok(inventory.relationships.some((edge: { owner: string; id: string; targetPart: string }) => edge.owner === "/ppt/slides/slide90.xml" && edge.id === "layout" && edge.targetPart === "/ppt/slideLayouts/layoutB.xml"));
  });
}
