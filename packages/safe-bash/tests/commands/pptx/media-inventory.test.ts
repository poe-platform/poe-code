import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, readMedia } from "pptx";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
function fixture(embedded = false) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = (body: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const link = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
  const files = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="mp4" ContentType="video/mp4"/></Types>',
    "_rels/.rels": rels(link("deck", "officeDocument", "deck.xml")),
    "deck.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst></p:presentation>`,
    "_rels/deck.xml.rels": rels(link("slide", "slide", "slide.xml")),
    "slide.xml": `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="Harbor clip"/><p:nvPr><a:videoFile r:link="clip"/></p:nvPr></p:nvPicPr></p:pic></p:spTree></p:cSld></p:sld>`,
    "_rels/slide.xml.rels": rels(link("clip", "video", "file:///private/harbor.mp4", true))
  };
  if (embedded) {
    files["slide.xml"] =
      `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" xmlns:m="http://schemas.microsoft.com/office/powerpoint/2010/main"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="Harbor&#10;clip"/><p:nvPr><a:videoFile r:link="clip"/><p:extLst><p:ext uri="media"><m:media r:embed="copy"><m:trim st="1" end="9"/><m:extLst><p:ext uri="tracks"><c:tracksInfo xmlns:c="http://schemas.microsoft.com/office/powerpoint/2017/3/main" displayLoc="media"><c:trackLst><c:track id="{C247D153-B815-401E-A23B-F7AFC390C120}" label="Harbor" r:embed="caption"/></c:trackLst></c:tracksInfo></p:ext></m:extLst></m:media></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="poster"/></p:blipFill></p:pic></p:spTree></p:cSld><p:timing><p:tnLst><p:video><p:cMediaNode vol="50000"><p:cTn id="8"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cMediaNode></p:video></p:tnLst></p:timing></p:sld>`;
    files["_rels/slide.xml.rels"] = rels(
      link("clip", "video", "clip.mp4") +
        '<Relationship Id="copy" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="clip.mp4"/>' +
        link("poster", "image", "poster.png") +
        '<Relationship Id="caption" Type="http://schemas.microsoft.com/office/2017/04/relationships/track" Target="caption.vtt"/>'
    );
    Object.assign(files, {
      "clip.mp4": "tiny original clip",
      "poster.png": "tiny original poster",
      "caption.vtt": "WEBVTT\n\n00:00.000 --> 00:01.000\nHarbor\n"
    });
  }
  const bytes = storedArchive(
    Object.entries(files).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) }))
  );
  const volume = Volume.fromJSON({ "/work/harbor deck.pptx": Buffer.from(bytes) });
  const reads: string[] = [];
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    reads.push(path);
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 65536 })
    })
  );
  return { shell, reads, bytes };
}
test("pptx media reads use the injected filesystem and retain inert external targets", async () => {
  const f = fixture();
  const schema = await f.shell.exec("pptx schema media get --json");
  assert.equal(schema.exitCode, 0, schema.stdout + schema.stderr);
  const result = await f.shell.exec(
    "pptx media get 'harbor deck.pptx' --slide 1 --shape 'Harbor clip' --json"
  );
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(
    compileJsonSchema(JSON.parse(schema.stdout).data.operations["media.get"].result).validate(
      envelope
    ).ok,
    true
  );
  assert.equal(envelope.operation, "media.get");
  assert.equal(envelope.affected, 0);
  assert.equal(envelope.data.playbackVerified, false);
  assert.equal(envelope.data.occurrences.length, 1);
  assert.equal(envelope.data.occurrences[0].shapeName, "Harbor clip");
  assert.equal(envelope.data.occurrences[0].relationships[0].target, "file:///private/harbor.mp4");
  assert.equal(envelope.data.occurrences[0].relationships[0].sha256, null);
  assert.deepEqual(
    envelope.data,
    await readMedia(f.bytes, { slide: 1, shape: "Harbor clip" }, context)
  );
  assert.deepEqual(f.reads, ["/work/harbor deck.pptx"]);
  const human = await f.shell.exec("pptx media list 'harbor deck.pptx'");
  assert.equal(human.exitCode, 0);
  assert.ok(human.stdout.includes("Harbor clip"));
  assert.ok(human.stdout.includes("does not prove playback"));
});
test("pptx media supports stdin and bounded output without publication", async () => {
  const f = fixture();
  const result = await f.shell.exec("pptx media list - --json", { stdin: toByteSource(f.bytes) });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.deepEqual(f.reads, []);
  const bounded = await f.shell.exec(
    "pptx media list 'harbor deck.pptx' --json --limit maxOutputBytes=512"
  );
  assert.notEqual(bounded.exitCode, 0);
  const invalid = await f.shell.exec(
    "pptx media list 'harbor deck.pptx' --output changed.pptx --json"
  );
  assert.equal(invalid.exitCode, 2);
});

test("pptx media retains dual bindings, posters and associated timing in a closed schema", async () => {
  const f = fixture(true);
  const result = await f.shell.exec("pptx media get 'harbor deck.pptx' --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  const schema = JSON.parse((await f.shell.exec("pptx schema media get --json")).stdout).data
    .operations["media.get"].result;
  assert.equal(compileJsonSchema(schema).validate(envelope).ok, true);
  const item = envelope.data.occurrences[0];
  assert.deepEqual(
    item.relationships.map((edge: { relationshipId: string }) => edge.relationshipId),
    ["clip", "copy"]
  );
  assert.deepEqual(
    item.relationships.map((edge: { mediaPart: string }) => edge.mediaPart),
    ["/clip.mp4", "/clip.mp4"]
  );
  assert.equal(
    item.relationships[0].sha256,
    createHash("sha256").update("tiny original clip").digest("hex")
  );
  assert.equal(item.posters[0].mediaPart, "/poster.png");
  assert.ok(item.timing.some((entry: { xml: string }) => entry.xml.includes('vol="50000"')));
  assert.ok(item.playback.some((entry: { xml: string }) => entry.xml.includes('st="1"')));
  assert.ok(
    item.captions.some((entry: { relationships: { mediaPart: string }[] }) =>
      entry.relationships.some((edge) => edge.mediaPart === "/caption.vtt")
    )
  );
  assert.equal(envelope.data.media.length, 1);
  assert.equal(envelope.data.playbackVerified, false);
  const human = await f.shell.exec("pptx media list 'harbor deck.pptx'");
  assert.ok(human.stdout.includes('"Harbor\\nclip"'));
  assert.ok(human.stdout.includes("2 embedded, 0 linked"));
});
