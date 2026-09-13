import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, createPresentation } from "pptx";
import { opaqueContext, opaqueDeck } from "../../../../pptx/tests/fixtures/opaque-deck.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

function setup() {
  const fixture = opaqueDeck();
  const volume = Volume.fromJSON({ "/work/deck.pptx": Buffer.from(fixture.bytes) });
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context: opaqueContext, maxOutputBytes: 131072, maxArgumentBytes: 8192 }) }));
  return { shell, volume, fixture };
}

test("pptx lists opaque active content without interpreting payload bytes", async () => {
  const { shell, volume, fixture } = setup();
  const result = await shell.exec("pptx objects list deck.pptx --scope shared --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, "objects.list");
  assert.equal(output.affected, 0);
  assert.deepEqual(output.errors, []);
  assert.equal(output.data.activationPerformed, false);
  assert.equal(output.data.recursiveParsingPerformed, false);
  const object = output.data.objects.find((item: { part: string }) => item.part === "/ppt/embeddings/capsule.bin");
  assert.equal(object.activeContent, true);
  assert.equal(object.bytes, 11);
  assert.deepEqual(object.dependencies, ["/ppt/media/preview.bin"]);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), fixture.bytes);
});

test("pptx validates closure extraction without output and exposes font inventory", async () => {
  const { shell } = setup();
  const result = await shell.exec("pptx objects extract deck.pptx --part /ppt/embeddings/capsule.bin --dry-run --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.data.dryRun, true);
  assert.deepEqual(output.data.outputs.map((item: { part: string }) => item.part).sort(), ["/ppt/embeddings/_rels/capsule.bin.rels", "/ppt/embeddings/capsule.bin", "/ppt/media/preview.bin"]);
  for (const item of output.data.outputs) {
    assert.equal(item.name.split("/").length, 1);
    assert.equal(item.name.includes(".."), false);
    assert.equal(item.name.includes("\\"), false);
  }
  const fonts = await shell.exec("pptx fonts list deck.pptx --json");
  assert.equal(fonts.exitCode, 0, fonts.stdout + fonts.stderr);
  assert.deepEqual(JSON.parse(fonts.stdout).data.fonts.map((item: { part: string }) => item.part), ["/ppt/fonts/family.fntdata"]);
});

test("pptx rejects unsupported object selectors and undeclared extraction publication", async () => {
  const { shell } = setup();
  const selector = await shell.exec("pptx objects list deck.pptx --slide 1 --json");
  assert.equal(selector.exitCode, 2);
  const result = await shell.exec("pptx objects extract deck.pptx --part /ppt/embeddings/capsule.bin --output-dir /out --json");
  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "publication-unsupported");
});

test("pptx refuses slide import with an unsupported object reference before publication", async () => {
  const { shell, volume } = setup();
  const target = await createPresentation({ slides: [{ name: "Landing" }] }, opaqueContext);
  const members = new Map<string, Uint8Array>(inspectZip(target).map(item => [item.name, item.payload]));
  const name = "ppt/slides/_rels/slide1.xml.rels";
  const xml = parseXmlPart(members.get(name)!, opaqueContext.xmlLimits);
  members.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [
    '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="attachment" Type="urn:unsupported-object-reference" Target="../embeddings/capsule.bin"/>'
  ]).bytes());
  members.set("ppt/embeddings/capsule.bin", new Uint8Array([0, 255, 19]));
  const types = parseXmlPart(members.get("[Content_Types].xml")!, opaqueContext.xmlLimits);
  members.set("[Content_Types].xml", types.spliceChildren(types.root, types.root.children.length, 0, [
    '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/embeddings/capsule.bin" ContentType="application/octet-stream"/>'
  ]).bytes());
  const source = storedArchive([...members].map(([name, bytes]) => ({ name, bytes })));
  volume.writeFileSync("/work/deck.pptx", target);
  volume.writeFileSync("/work/source.pptx", source);
  const result = await shell.exec("pptx slides import deck.pptx --source source.pptx --source-slides '[1]' --output -");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdoutBytes.length, 0);
  assert.ok(result.stderr.includes("unsupported-edit"));
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), target);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer), source);
});

test("pptx extracts exact closure bytes to the supplied virtual filesystem", async () => {
  const fixture = opaqueDeck();
  const volume = Volume.fromJSON({ "/deck.pptx": Buffer.from(fixture.bytes) });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  await fs.mkdir("/work/extracted objects", { recursive: true });
  await fs.writeFile("/work/deck.pptx", new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer));
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context: opaqueContext, maxOutputBytes: 131072, maxArgumentBytes: 8192 }) }));
  const result = await shell.exec("pptx objects extract deck.pptx --part /ppt/embeddings/capsule.bin --output-dir 'extracted objects' --allow-partial-output --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.affected, 1);
  assert.equal(output.data.outputs.length, 3);
  for (const item of output.data.outputs) {
    assert.equal(item.name.includes("/"), false);
    const expected = fixture.members.find(member => `/${member.name}` === item.part)!.bytes;
    assert.deepEqual(await fs.readFile(`/work/${item.path}`), expected);
  }
  assert.deepEqual(await fs.readFile("/work/deck.pptx"), fixture.bytes);
});
