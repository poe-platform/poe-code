import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPptxCommandEngine, duplicateSlides, mutateSlides, removeSlides } from "pptx";
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
const selection = { kind: "slide" as const, position: { coordinateSystem: "one-based" as const, value: 1 } };
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

function fixture(opaque = false, svg = false) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const edge = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const tree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
  const extension = '<p:extLst><p:ext uri="urn:original:retained"><u:keep xmlns:u="urn:original:retained" value="Blue &amp; gold"/></p:ext></p:extLst>';
  const mediaName = svg ? "shared.svg" : "shared.gif";
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="gif" ContentType="image/gif"/>' + [
      ["ppt/presentation.xml", "presentation.main"], ["ppt/slides/east.xml", "slide"],
      ["ppt/slides/west.xml", "slide"], ["ppt/slideLayouts/plain.xml", "slideLayout"],
      ["ppt/slideMasters/base.xml", "slideMaster"]
    ].map(([name, type]) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join("") + '</Types>',
    "_rels/.rels": rels(edge("office", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="401" r:id="east"/><p:sldId id="709" r:id="west"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(edge("east", "slide", "slides/east.xml") + edge("west", "slide", "slides/west.xml") + edge("master", "slideMaster", "slideMasters/base.xml")),
    "ppt/slideLayouts/plain.xml": `<p:sldLayout xmlns:p="${p}" type="blank"><p:cSld name="Plain"><p:spTree>${tree}</p:spTree></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/plain.xml.rels": rels(edge("base", "slideMaster", "../slideMasters/base.xml")),
    "ppt/slideMasters/base.xml": `<p:sldMaster xmlns:p="${p}" xmlns:r="${r}"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld><p:clrMap/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="plain"/></p:sldLayoutIdLst></p:sldMaster>`,
    "ppt/slideMasters/_rels/base.xml.rels": rels(edge("plain", "slideLayout", "../slideLayouts/plain.xml")),
    "ppt/media/shared.gif": new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59])
  };
  for (const [part, name] of [["east", "East"], ["west", "West"]]) {
    files[`ppt/slides/${part}.xml`] = `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld name="${name}"><p:spTree>${tree}<p:pic><p:nvPicPr><p:cNvPr id="8" name="Shared square"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld>${opaque ? extension : ""}</p:sld>`;
    files[`ppt/slides/_rels/${part}.xml.rels`] = rels(edge("layout", "slideLayout", "../slideLayouts/plain.xml") + edge("image", "image", `../media/${mediaName}`));
  }
  if (svg) {
    delete files["ppt/media/shared.gif"];
    files["ppt/media/shared.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><metadata>Inert retention marker</metadata></svg>';
    files["[Content_Types].xml"] = String(files["[Content_Types].xml"]).replace('Extension="gif" ContentType="image/gif"', 'Extension="svg" ContentType="image/svg+xml"');
  }
  const bytes = storedArchive(Object.entries(files).map(([name, value]) => ({ name, bytes: typeof value === "string" ? new TextEncoder().encode(value) : value })));
  const volume = Volume.fromJSON({ "/work/deck.pptx": Buffer.from(bytes) });
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 262144, maxArgumentBytes: 65536 }) }));
  return { bytes, volume, shell, extension };
}

function parts(bytes: Uint8Array) {
  return new Map(inspectZip(bytes).map(entry => [entry.name, entry.payload]));
}
function attrs(bytes: Uint8Array, local: string) {
  const found: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", tag => {
    if (tag.local === local) found.push(Object.fromEntries(Object.values(tag.attributes).map(attr => [attr.name, attr.value])));
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return found;
}
function unchanged(beforeBytes: Uint8Array, afterBytes: Uint8Array, edited: string[]) {
  const beforeParts = parts(beforeBytes), afterParts = parts(afterBytes);
  for (const [name, bytes] of beforeParts) {
    if (edited.includes(name)) continue;
    assert.ok(afterParts.has(name), name);
    assert.equal(createHash("sha256").update(afterParts.get(name)!).digest("hex"), createHash("sha256").update(bytes).digest("hex"), name);
  }
}

test("slide no-op updates return exact archive bytes through SDK and CLI", async () => {
  const f = fixture(true);
  try {
    for (const [options, command] of [
      [{ name: "East" }, "set --name East"], [{ position: 1 }, "move --position 1"]
    ] as const) {
      assert.deepEqual(await mutateSlides(f.bytes, { selection, ...options }, context), f.bytes);
      const [action, ...flags] = command.split(" ");
      const result = await f.shell.exec(`pptx slides ${action} deck.pptx ${flags.join(" ")} --slide 1 --output -`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, f.bytes);
    }
  } finally { await f.shell.dispose(); }
});

test("slide rename and move preserve identities, opaque XML and untouched part hashes", async () => {
  const f = fixture(true);
  try {
    const renamed = await mutateSlides(f.bytes, { selection, name: "Dawn & dusk" }, context);
    const cli = await f.shell.exec("pptx slides set deck.pptx --slide 1 --name 'Dawn & dusk' --output -");
    assert.equal(cli.exitCode, 0, cli.stderr);
    assert.deepEqual(cli.stdoutBytes, renamed);
    unchanged(f.bytes, renamed, ["ppt/slides/east.xml"]);
    assert.deepEqual(attrs(parts(renamed).get("ppt/slides/east.xml")!, "cSld"), [{ name: "Dawn & dusk" }]);
    assert.ok(new TextDecoder().decode(parts(renamed).get("ppt/slides/east.xml")).includes(f.extension));
    f.volume.writeFileSync("/work/deck.pptx", renamed);
    const moved = await mutateSlides(renamed, { selection, position: 2 }, context);
    const movedCli = await f.shell.exec("pptx slides move deck.pptx --slide 1 --position 2 --output -");
    assert.equal(movedCli.exitCode, 0, movedCli.stderr);
    assert.deepEqual(movedCli.stdoutBytes, moved);
    unchanged(renamed, moved, ["ppt/presentation.xml"]);
    assert.deepEqual(attrs(parts(moved).get("ppt/presentation.xml")!, "sldId"), [{ id: "709", "r:id": "west" }, { id: "401", "r:id": "east" }]);
    assert.deepEqual(await mutateSlides(renamed, { selection, position: 2 }, context), moved);
  } finally { await f.shell.dispose(); }
});

test("slide duplicate then delete restores the graph while retaining shared media", async () => {
  const f = fixture();
  try {
    const duplicated = await duplicateSlides(f.bytes, { selection, position: 2 }, context);
    const cli = await f.shell.exec("pptx slides duplicate deck.pptx --slide 1 --position 2 --output -");
    assert.equal(cli.exitCode, 0, cli.stderr);
    assert.deepEqual(cli.stdoutBytes, duplicated);
    assert.deepEqual(await duplicateSlides(f.bytes, { selection, position: 2 }, context), duplicated);
    unchanged(f.bytes, duplicated, ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]);
    assert.deepEqual(attrs(parts(duplicated).get("ppt/presentation.xml")!, "sldId").map(node => node.id), ["401", "710", "709"]);
    assert.deepEqual([...parts(duplicated).keys()].filter(name => name.startsWith("ppt/media/")), ["ppt/media/shared.gif"]);
    f.volume.writeFileSync("/work/deck.pptx", duplicated);
    const second = { ...selection, position: { coordinateSystem: "one-based" as const, value: 2 } };
    const removed = await removeSlides(duplicated, { selection: second }, context);
    const removedCli = await f.shell.exec("pptx slides remove deck.pptx --slide 2 --output -");
    assert.equal(removedCli.exitCode, 0, removedCli.stderr);
    assert.deepEqual(removedCli.stdoutBytes, removed);
    assert.deepEqual([...parts(removed).keys()].sort(), [...parts(f.bytes).keys()].sort());
    unchanged(f.bytes, removed, ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]);
    assert.deepEqual(attrs(parts(removed).get("ppt/presentation.xml")!, "sldId"), [{ id: "401", "r:id": "east" }, { id: "709", "r:id": "west" }]);
    assert.deepEqual(attrs(parts(removed).get("ppt/_rels/presentation.xml.rels")!, "Relationship"), attrs(parts(f.bytes).get("ppt/_rels/presentation.xml.rels")!, "Relationship"));
  } finally { await f.shell.dispose(); }
});

test("slide copying rejects opaque extension remapping without publishing bytes", async () => {
  const f = fixture(true);
  try {
    await assert.rejects(duplicateSlides(f.bytes, { selection, position: 2 }, context), { code: "unsupported-edit" });
    const result = await f.shell.exec("pptx slides duplicate deck.pptx --slide 1 --position 2 --output -");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdoutBytes.length, 0);
    assert.deepEqual(new Uint8Array(f.volume.readFileSync("/work/deck.pptx") as Buffer), f.bytes);
  } finally { await f.shell.dispose(); }
});

test("isolated slide copies retain inert SVG bytes after copied slide deletion", async () => {
  const f = fixture(false, true);
  try {
    const duplicated = await duplicateSlides(f.bytes, { selection, position: 2, mediaPolicy: "isolated-instance" }, context);
    const cli = await f.shell.exec("pptx slides duplicate deck.pptx --slide 1 --position 2 --media-policy isolated-instance --output -");
    assert.equal(cli.exitCode, 0, cli.stderr);
    assert.deepEqual(cli.stdoutBytes, duplicated);
    const media = [...parts(duplicated)].filter(([name]) => name.startsWith("ppt/media/"));
    assert.equal(media.length, 2);
    for (const [, bytes] of media) assert.deepEqual(bytes, parts(f.bytes).get("ppt/media/shared.svg"));
    unchanged(f.bytes, duplicated, ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]);
    f.volume.writeFileSync("/work/deck.pptx", duplicated);
    const removed = await removeSlides(duplicated, { selection: { ...selection, position: { coordinateSystem: "one-based", value: 2 } } }, context);
    const removedCli = await f.shell.exec("pptx slides remove deck.pptx --slide 2 --output -");
    assert.equal(removedCli.exitCode, 0, removedCli.stderr);
    assert.deepEqual(removedCli.stdoutBytes, removed);
    assert.deepEqual([...parts(removed).keys()].sort(), [...parts(f.bytes).keys(), "ppt/media/shared-copy1.svg"].sort());
    assert.deepEqual(parts(removed).get("ppt/media/shared-copy1.svg"), parts(f.bytes).get("ppt/media/shared.svg"));
    assert.deepEqual(attrs(parts(removed).get("ppt/presentation.xml")!, "sldId"), [{ id: "401", "r:id": "east" }, { id: "709", "r:id": "west" }]);
    unchanged(f.bytes, removed, ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]);
  } finally { await f.shell.dispose(); }
});
