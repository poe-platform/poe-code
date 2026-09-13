import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { createPresentation, createPptxCommandEngine, readAnimations } from "pptx";
import { readPackage } from "../../../../pptx/src/package-reader.js";
import { writePackageArchive } from "../../../../pptx/src/package-writer.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { FsError } from "../../../src/contracts/index.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: { maxArchiveBytes: 65536, maxEntryBytes: 8192, maxTotalBytes: 32768, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 8192, chunkSize: 512 },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

test("animation inventory runs from virtual scripts and agrees with the public SDK", async () => {
  const original = await createPresentation({ slides: [{}, {}] }, context);
  const reader = await readPackage(original, context);
  const bytes = await writePackageArchive(reader.names.map(part => {
    const name = part.slice(1);
    const payload = reader.get(part);
    if (part !== "/ppt/slides/slide1.xml") return { name, bytes: payload };
    const doc = parseXmlPart(payload, context.xmlLimits);
    return { name, bytes: doc.spliceChildren(doc.root, doc.root.children.length, 0, ['<p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:tnLst><p:seq><p:cTn id="7"><p:childTnLst><p:par><p:cTn id="8"/></p:par></p:childTnLst></p:cTn></p:seq></p:tnLst></p:timing>']).bytes() };
  }), context, { compression: "store" });
  const volume = Volume.fromJSON({ "/work/check.sh": "pptx animations list 'quiet deck.pptx' --json\npptx animations get 'quiet deck.pptx' --slide 2 --json" });
  volume.writeFileSync("/work/quiet deck.pptx", bytes);
  const fs = new MemoryFileSystem();
  fs.stat = async path => {
    try {
      const stat = volume.statSync(path);
      return { type: stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs) };
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = fs.stat;
  fs.access = async (path, mode) => {
    try { volume.accessSync(path, mode); }
    catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    const data = new Uint8Array(volume.readFileSync(path) as Buffer);
    if (options?.maxBytes !== undefined && data.length > options.maxBytes) throw new FsError("EFBIG");
    return data;
  };
  fs.readStream = async function* (path, options) { yield await fs.readFile(path, options); };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 65536 }) }));
  try {
    const result = await shell.exec("sh check.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    const outputs = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(outputs.map(output => output.operation), ["animations.list", "animations.get"]);
    assert.deepEqual(outputs[0].data.items.map((item: { name: string }) => item.name), ["timing", "tnLst", "seq", "cTn", "childTnLst", "par", "cTn"]);
    assert.deepEqual(outputs[1].data, { items: [] });
    const sdk = await readAnimations(bytes, {}, context);
    assert.deepEqual(sdk.map(record => [record.slide, record.nodes.length, record.executionVerified]), [[1, 7, false], [2, 0, false]]);
    assert.deepEqual(outputs[0].data.items.map((item: { fields: { name: string; value: { value: unknown } }[] }) => item.fields.find(field => field.name === "id")!.value.value), sdk[0]!.nodes.map(node => node.id));
    const ambiguity = await shell.exec("pptx animations get 'quiet deck.pptx' --json");
    assert.equal(ambiguity.exitCode, 1);
    assert.equal(JSON.parse(ambiguity.stdout).errors[0].code, "ambiguous-selection");
    const limit = await shell.exec("pptx animations list 'quiet deck.pptx' --limit maxNodes=1 --json");
    assert.equal(limit.exitCode, 4);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/quiet deck.pptx") as Buffer), bytes);
    assert.deepEqual(volume.readdirSync("/work"), ["check.sh", "quiet deck.pptx"]);
  } finally { await shell.dispose(); }
});
