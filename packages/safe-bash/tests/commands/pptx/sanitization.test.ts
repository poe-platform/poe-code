import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPptxCommandEngine, createPresentation, mutateProperty, sanitizeProperties } from "pptx";
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
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

async function fixture() {
  const original = (await mutateProperty(
    await createPresentation({ slides: [{ name: "Birch" }] }, context),
    "set", { name: "title", value: "Confidential itinerary" }, context
  )).bytes;
  const volume = Volume.fromJSON({ "/work/deck.pptx": Buffer.from(original) });
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
  return { original, volume, reads, shell };
}

test("sanitization removes explicit properties without altering slide or layout payloads", async () => {
  const f = await fixture();
  try {
    const result = await f.shell.exec("pptx sanitize deck.pptx --remove properties --output -");
    assert.equal(result.exitCode, 0, result.stderr);
    const sdk = await sanitizeProperties(f.original, context);
    assert.deepEqual(result.stdoutBytes, sdk.bytes);
    const originalParts = new Map(inspectZip(f.original).map(part => [part.name, part.payload]));
    const outputParts = new Map(inspectZip(result.stdoutBytes).map(part => [part.name, part.payload]));
    assert.ok(originalParts.has("docProps/core.xml"));
    assert.ok(outputParts.has("docProps/core.xml"));
    for (const [name, bytes] of originalParts) {
      if (name.startsWith("docProps/")) continue;
      assert.deepEqual(outputParts.get(name), bytes, name);
    }
    const elements: string[] = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", tag => { elements.push(tag.local); });
    parser.write(new TextDecoder().decode(outputParts.get("docProps/core.xml")!)).close();
    assert.deepEqual(elements, ["coreProperties"]);
    assert.deepEqual(new Uint8Array(f.volume.readFileSync("/work/deck.pptx") as Buffer), f.original);
  } finally { await f.shell.dispose(); }
});

test("sanitization rejects unknown categories before input reads or binary publication", async () => {
  const f = await fixture();
  try {
    const result = await f.shell.exec("pptx sanitize deck.pptx --remove unknown-category --output -");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdoutBytes.length, 0);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(new Uint8Array(f.volume.readFileSync("/work/deck.pptx") as Buffer), f.original);
  } finally { await f.shell.dispose(); }
});
