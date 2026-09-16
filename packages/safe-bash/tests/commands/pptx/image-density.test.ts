import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after, mock } from "node:test";
import { inflateRawSync } from "node:zlib";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation, createPptxCommandEngine } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144,
    maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024,
    maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};

before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

test("pptx images add rounds centimeter density ties to even before native sizing", async () => {
  // Original metadata/scan container bytes; this case does not assert pixel decoding.
  const image = new Uint8Array([
    255, 216,
    255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 2, 0, 75, 0, 25, 0, 0,
    255, 192, 0, 11, 8, 0, 64, 0, 190, 1, 1, 17, 0,
    255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 19, 43, 255, 217
  ]);
  const original = await createPresentation({ slides: [{}] }, context);
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/deck.pptx", original);
  volume.writeFileSync("/work/density study.jpg", image);
  volume.writeFileSync("/work/add.sh", "pptx images add deck.pptx --slide 1 --file 'density study.jpg' --output result.pptx --json");
  const fs = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async path => {
    try {
      const stat = volume.statSync(path);
      return { type: stat.isDirectory() ? "directory" : "file", size: Number(stat.size),
        mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs),
        ctimeMs: Number(stat.ctimeMs), identityScope, dev: Number(stat.dev), ino: Number(stat.ino),
        revision: Number(stat.mtimeMs), nlink: Number(stat.nlink) };
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = fs.stat;
  fs.access = async (path, mode) => {
    try { volume.accessSync(path, mode); } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Buffer);
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.stat(path) : null;
    if (current?.ino !== options.expected?.ino || current?.revision !== options.expected?.revision)
      throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({
    engine: createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 262144 })
  }));
  const result = await shell.exec("sh add.sh");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operation, "images.add");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.affected, 1);

  const output = volume.readFileSync("/work/result.pptx") as Buffer;
  const members = new Map<string, Buffer>();
  let offset = 0;
  while (output.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(output.readUInt16LE(offset + 6) & 8, 0, "Known writer stores local sizes");
    const method = output.readUInt16LE(offset + 8);
    assert.ok(method === 0 || method === 8);
    const packedSize = output.readUInt32LE(offset + 18);
    const nameLength = output.readUInt16LE(offset + 26);
    const extraLength = output.readUInt16LE(offset + 28);
    const name = output.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const packed = output.subarray(start, start + packedSize);
    assert.equal(packed.length, packedSize);
    const bytes = method === 8 ? inflateRawSync(packed) : packed;
    assert.equal(bytes.length, output.readUInt32LE(offset + 22));
    members.set(name, bytes);
    offset = start + packedSize;
  }
  assert.equal(output.readUInt32LE(offset), 0x02014b50);
  const slide = members.get("ppt/slides/slide1.xml");
  assert.ok(slide);
  const extents: string[][] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", tag => {
    if (tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main" && tag.local === "ext") {
      extents.push([tag.attributes.cx!.value, tag.attributes.cy!.value]);
    }
  });
  parser.write(slide.toString("utf8")).close();
  assert.deepEqual(extents, [["0", "0"], ["914400", "914400"]]);
  const media = [...members].filter(([name]) => name.startsWith("ppt/media/"));
  assert.equal(media.length, 1);
  assert.equal(createHash("sha256").update(media[0]![1]).digest("hex"),
    createHash("sha256").update(image).digest("hex"));
  assert.deepEqual(volume.readFileSync("/work/deck.pptx"), Buffer.from(original));
  assert.deepEqual(volume.readFileSync("/work/density study.jpg"), Buffer.from(image));
});
