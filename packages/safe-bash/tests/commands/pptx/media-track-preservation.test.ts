import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, readMedia } from "pptx";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144,
    maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024,
    maxTextBytes: 65536, chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
const clip = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
const poster = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
]);

before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

function fixture(alias?: string) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const edge = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const tracks = '<c:tracksInfo displayLoc="media" u:policy="retain"><c:trackLst><c:track id="{098EA722-3B34-4F2E-A847-88B834BF779C}" label="English — harbor" r:embed="english" u:language="en-GB"><u:range start="125" end="2750"/></c:track><c:track id="{C893BBAE-88AD-438A-91CB-D710975005D3}" label="Français &amp; marée" r:embed="french" u:language="fr-CA"/></c:trackLst></c:tracksInfo>';
  const unknown = `<u:metadata u:mode="opaque"${alias ? ` r:embed="${alias}"` : ''}><u:range start="0" end="9000"/><u:label xml:lang="ja">港</u:label></u:metadata>`;
  const tree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/deck.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slide.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/layout.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/master.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Default Extension="mp4" ContentType="video/mp4"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="vtt" ContentType="text/vtt"/></Types>',
    "_rels/.rels": rels(edge("deck", `${r}/officeDocument`, "ppt/deck.xml")),
    "deck.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "_rels/deck.xml.rels": rels(edge("slide", `${r}/slide`, "slide.xml")),
    "slide.xml": `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" xmlns:m="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:c="http://schemas.microsoft.com/office/powerpoint/2017/3/main" xmlns:u="urn:original:track-metadata"><p:cSld><p:spTree>${tree}<p:pic><p:nvPicPr><p:cNvPr id="2" name="Harbor film"/><p:nvPr><a:videoFile r:link="clip"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><m:media r:embed="copy"><m:trim st="125" end="9000"/><m:extLst><p:ext uri="{3AFAAA56-56D3-431D-BCD4-E75A35582382}">${tracks}${unknown}</p:ext></m:extLst></m:media></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="poster"/></p:blipFill></p:pic></p:spTree></p:cSld><p:timing><p:tnLst><p:video><p:cMediaNode vol="42000"><p:cTn id="8" repeatCount="indefinite"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cMediaNode></p:video></p:tnLst></p:timing></p:sld>`,
    "_rels/slide.xml.rels": rels(
      edge("layout", `${r}/slideLayout`, "layout.xml") +
      edge("clip", `${r}/video`, "clip.mp4") +
      edge("copy", "http://schemas.microsoft.com/office/2007/relationships/media", "clip.mp4") +
      edge("poster", `${r}/image`, "poster.gif") +
      edge("english", "http://schemas.microsoft.com/office/2017/04/relationships/track", "english.vtt") +
      edge("french", "http://schemas.microsoft.com/office/2017/04/relationships/track", "french.vtt")
    ),
    "layout.xml": `<p:sldLayout xmlns:p="${p}"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sldLayout>`,
    "_rels/layout.xml.rels": rels(edge("master", `${r}/slideMaster`, "master.xml")),
    "master.xml": `<p:sldMaster xmlns:p="${p}" xmlns:r="${r}"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld><p:clrMap/><p:sldLayoutIdLst><p:sldLayoutId id="2147483648" r:id="layout"/></p:sldLayoutIdLst></p:sldMaster>`,
    "_rels/master.xml.rels": rels(edge("layout", `${r}/slideLayout`, "layout.xml")),
    "clip.mp4": clip,
    "poster.gif": poster,
    "english.vtt": "WEBVTT\n\n00:00.125 --> 00:02.750\nHarbor tide\n",
    "french.vtt": "WEBVTT\n\n00:00.125 --> 00:02.750\nLa marée\n"
  };
  const bytes = storedArchive(Object.entries(files).map(([name, value]) => ({
    name: name === "[Content_Types].xml" || name === "_rels/.rels" ? name : `ppt/${name}`, bytes: typeof value === "string" ? new TextEncoder().encode(value) : value
  })));
  const volume = Volume.fromJSON({
    "/work/deck.pptx": Buffer.from(bytes),
    "/work/new clip.mp4": Buffer.from(clip),
    "/work/poster.gif": Buffer.from(poster)
  });
  const fs = new MemoryFileSystem();
  const reads: string[] = [];
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    reads.push(path);
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({
    engine: createPptxCommandEngine({ context, maxOutputBytes: 262144, maxArgumentBytes: 65536 })
  }));
  return { shell, volume, bytes, tracks, unknown, reads, files };
}

test("pptx media replacement preserves multilingual tracks, time ranges and opaque metadata", async () => {
  const f = fixture();
  const result = await f.shell.exec("pptx media replace deck.pptx --slide 1 --shape 'Harbor film' --file 'new clip.mp4' --poster poster.gif --output -");
  assert.equal(result.exitCode, 0, result.stderr);
  const parts = new Map(inspectZip(result.stdoutBytes).map(member => [member.name, member.payload]));
  const xml = new TextDecoder().decode(parts.get("ppt/slide.xml"));
  assert.ok(xml.includes(f.tracks));
  assert.ok(xml.includes(f.unknown));
  assert.ok(xml.includes('<m:trim st="125" end="9000"/>'));
  assert.ok(xml.includes('vol="42000"'));
  assert.ok(xml.includes('repeatCount="indefinite"'));
  for (const name of ["english.vtt", "french.vtt"]) {
    assert.equal(new TextDecoder().decode(parts.get(`ppt/${name}`)), f.files[name]);
  }
  const relationships = new TextDecoder().decode(parts.get("ppt/_rels/slide.xml.rels"));
  assert.ok(relationships.includes('Id="english"'));
  assert.ok(relationships.includes('Target="english.vtt"'));
  assert.ok(relationships.includes('Id="french"'));
  assert.ok(relationships.includes('Target="french.vtt"'));
  const inventory = await readMedia(result.stdoutBytes, {}, context);
  assert.equal(inventory.occurrences.length, 1);
  assert.equal(inventory.occurrences[0]!.relationships.length, 2);
  assert.equal(inventory.playbackVerified, false);
  assert.deepEqual(new Uint8Array(f.volume.readFileSync("/work/deck.pptx") as Buffer), f.bytes);
  assert.deepEqual(f.reads, ["/work/deck.pptx", "/work/new clip.mp4", "/work/poster.gif"]);
});

for (const alias of ["clip", "copy", "poster"]) {
  test(`pptx media replacement rejects opaque metadata sharing the ${alias} binding before output`, async () => {
    const f = fixture(alias);
    const result = await f.shell.exec("pptx media replace deck.pptx --slide 1 --shape 'Harbor film' --file 'new clip.mp4' --poster poster.gif --output -");
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdoutBytes.length, 0);
    assert.ok(result.stderr.includes("unsupported-edit"), result.stderr);
    assert.deepEqual(new Uint8Array(f.volume.readFileSync("/work/deck.pptx") as Buffer), f.bytes);
  });
}
