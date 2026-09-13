import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, readSelectionIndex } from "pptx";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { FsError, toByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 8192, maxTotalBytes: 32768, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 8192, chunkSize: 512 },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
};

function deck(reversed = false) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const relations = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const link = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const slide = (name: string) => `<p:sld xmlns:p="${p}"><p:cSld name="${name}"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="7" name="heading"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="8" name="heading"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="9" name="7"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>`;
  const ordered = reversed ? '<p:sldId id="900" r:id="b"/><p:sldId id="400" r:id="a"/>' : '<p:sldId id="400" r:id="a"/><p:sldId id="900" r:id="b"/>';
  return storedArchive(Object.entries({
    "ppt/slides/slide1.xml": slide("Meadow"),
    "ppt/slides/slide99.xml": slide("Meadow"),
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide99.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    "_rels/.rels": relations(link("root", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst>${ordered}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relations(link("a", "slide", "slides/slide99.xml") + link("b", "slide", "slides/slide1.xml")),
  }).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })));
}

function fixture() {
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/deck.pptx", deck());
  volume.writeFileSync("/work/-deck.pptx", deck());
  volume.writeFileSync("/work/\uFEFFdeck.pptx", deck(true));
  volume.writeFileSync("/work/inspect.sh", "pptx inspect deck.pptx --slide 2 --json\n");
  const fs = new MemoryFileSystem();
  fs.stat = async path => {
    try {
      const stat = volume.statSync(path);
      return { type: stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs) };
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = fs.stat;
  fs.access = async (path, mode) => {
    try { volume.accessSync(path, mode); } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    try {
      const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
      if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) throw new FsError("EFBIG");
      return bytes;
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 8192 }) }));
  return { shell, volume };
}

test("pptx inspection follows slide order with the same identity through SDK and CLI", async () => {
  const { shell } = fixture();
  const output = await shell.exec("pptx inspect deck.pptx --slide 1 --json");
  assert.equal(output.exitCode, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.equal(result.version, 1);
  assert.equal(result.operation, "inspect");
  assert.equal(result.affected, 0);
  assert.equal(result.data.records[0].id, "400");
  assert.equal(result.data.records[0].part, "/ppt/slides/slide99.xml");
  const index = await readSelectionIndex(deck(), context);
  assert.deepEqual(result.locations, index.select({ kind: "slide", position: { coordinateSystem: "one-based", value: 1 } }).map(record => record.location));
});

test("pptx human inspection shows ordered names and owning identities", async () => {
  const result = await fixture().shell.exec("pptx inspect deck.pptx --slide 1");
  assert.equal(result.stdout, 'slide 1 "Meadow" id="400" owner="/ppt/slides/slide99.xml"\n');
  assert.equal(result.stderr, "");
});

test("pptx scopes duplicate object names to a slide and requires explicit all", async () => {
  const { shell } = fixture();
  const ambiguous = await shell.exec("pptx inspect deck.pptx --slide 1 --shape heading --json");
  assert.equal(ambiguous.exitCode, 1);
  assert.equal(JSON.parse(ambiguous.stdout).errors[0].code, "ambiguous-selection");
  const selected = await shell.exec("pptx inspect deck.pptx --slide 1 --shape heading --all --json");
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout).data.records.map((record: { id: string }) => record.id), ["7", "8"]);
});

test("pptx rejects stale tokens and preserves IDs after reorder", async () => {
  const { shell, volume } = fixture();
  const initial = JSON.parse((await shell.exec("pptx inspect deck.pptx --slide 1 --json")).stdout);
  const token = initial.data.records[0].token;
  assert.equal((await shell.exec(`pptx inspect deck.pptx --select '${token}' --json`)).exitCode, 0);
  volume.writeFileSync("/work/deck.pptx", deck(true));
  const stale = await shell.exec(`pptx inspect deck.pptx --select '${token}' --json`);
  assert.equal(stale.exitCode, 1);
  assert.equal(JSON.parse(stale.stdout).errors[0].code, "stale-selection");
  const moved = JSON.parse((await shell.exec("pptx inspect deck.pptx --slide 2 --json")).stdout);
  assert.equal(moved.data.records[0].id, "400");
});

test("pptx discovery is explicit and reports the narrow read profile", async () => {
  const { shell } = fixture();
  const schema = await shell.exec("pptx schema inspect --json");
  assert.equal(schema.exitCode, 0, schema.stderr);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.options.properties.slide.minimum, 1);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.options.additionalProperties, false);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.result.properties.version.const, 1);
  assert.equal(JSON.parse(schema.stdout).data.operations.inspect.selectionQuery.additionalProperties, false);
  const capabilities = JSON.parse((await shell.exec("pptx capabilities --json")).stdout);
  assert.equal(capabilities.data.features.selectors.level, "read");
  assert.equal(capabilities.data.features.editing.level, "reject");
  assert.ok((await shell.exec("pptx --help")).stdout.includes("--slide N"));
});

test("pptx reports output admission failure as a bounded JSON result", async () => {
  const { shell } = fixture();
  shell.use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 512, maxArgumentBytes: 8192 }), replace: true }));
  const result = await shell.exec("pptx inspect deck.pptx --json");
  assert.equal(result.exitCode, 4);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.data, null);
  assert.equal(body.errors[0].code, "resource-limit");
  assert.ok(new TextEncoder().encode(result.stdout).length <= 512);
});

for (const args of ["--slide 0", "--slide -1", "--slide 1.5", "--slide 1 --slide 2", "--shape heading", "--scope nowhere", "--output out.pptx", "--select x --slide 1", "--all --all"]) {
  test(`pptx rejects invalid inspection arguments ${args}`, async () => {
    const result = await fixture().shell.exec(`pptx inspect deck.pptx ${args} --json`);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, false);
  });
}

test("pptx separates missing selections, missing files and option-terminated paths", async () => {
  const { shell } = fixture();
  assert.equal((await shell.exec("pptx inspect deck.pptx --slide 3 --json")).exitCode, 1);
  assert.equal((await shell.exec("pptx inspect absent.pptx --json")).exitCode, 3);
  assert.equal((await shell.exec("pptx inspect --json -- -deck.pptx")).exitCode, 0);
});

test("pptx treats numeric shape strings as names within the owning slide", async () => {
  const result = await fixture().shell.exec("pptx inspect deck.pptx --slide 2 --shape 7 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "9");
  assert.equal(JSON.parse(result.stdout).data.records[0].part, "/ppt/slides/slide1.xml");
});

test("pptx classifies malformed location tokens as usage failures", async () => {
  const result = await fixture().shell.exec("pptx inspect deck.pptx --select malformed --json");
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "invalid-selection");
  const absent = await fixture().shell.exec("pptx inspect absent.pptx --select malformed --json");
  assert.equal(absent.exitCode, 2);
  assert.equal(JSON.parse(absent.stdout).errors[0].code, "invalid-selection");
});

test("pptx rejects malformed part selectors before attempting file reads", async () => {
  const result = await fixture().shell.exec("pptx inspect absent.pptx --part ../outside.xml --json");
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).errors[0].code, "invalid-selection");
});

test("pptx preserves an initial byte-order character in a literal filename", async () => {
  const result = await fixture().shell.exec("pptx inspect '\uFEFFdeck.pptx' --slide 1 --json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.records[0].id, "900");
});

test("pptx accepts bounded stdin and virtual script workflows", async () => {
  const { shell } = fixture();
  const input = await shell.exec("pptx inspect - --slide 1 --json", { stdin: toByteSource(deck()) });
  assert.equal(input.exitCode, 0, input.stderr);
  assert.equal(JSON.parse(input.stdout).data.records[0].id, "400");
  const script = await shell.exec("sh inspect.sh");
  assert.equal(script.exitCode, 0, script.stderr);
  assert.equal(JSON.parse(script.stdout).data.records[0].id, "900");
  const over = await shell.exec("pptx inspect - --json", { stdin: toByteSource(new Uint8Array(65537)) });
  assert.equal(over.exitCode, 4);
  assert.equal(JSON.parse(over.stdout).errors[0].code, "resource-limit");
});
