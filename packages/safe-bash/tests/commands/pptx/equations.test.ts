import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation, createPptxCommandEngine, mutateEquations, readEquations, getXmlPart } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

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
function fixture() {
  const volume = Volume.fromJSON({ "/work": null });
  const fs: FileSystem = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async path => {
    try {
      const entry = volume.statSync(path);
      return { type: entry.isDirectory() ? "directory" : "file", size: Number(entry.size), mode: Number(entry.mode), atimeMs: Number(entry.atimeMs), mtimeMs: Number(entry.mtimeMs), ctimeMs: Number(entry.ctimeMs), identityScope, dev: Number(entry.dev), ino: Number(entry.ino), revision: Number(entry.mtimeMs), nlink: Number(entry.nlink) };
    } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.lstat = async path => {
    const value = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...value, type: "symlink" } : value;
  };
  fs.access = async (path, mode) => {
    try { volume.accessSync(path, mode); } catch (error) { throw new FsError((error as FsError).code); }
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
    if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) throw new FsError("EFBIG");
    return bytes;
  };
  fs.readStream = async function* (path, options) { options?.signal?.throwIfAborted(); yield new Uint8Array(volume.readFileSync(path) as Buffer); };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.lstat(path) : null;
    if (current?.ino !== options.expected?.ino || current?.size !== options.expected?.size || current?.revision !== options.expected?.revision) throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 65536, maxArgumentBytes: 65536 }) }));
  return { volume, shell };
}

test("equations insert and extract through a quoted virtual script with SDK parity", async () => {
  const { volume, shell } = fixture();
  const input = await createPresentation({ slides: [{ shapes: [{ name: "Math body", x: 0, y: 0, width: 100, height: 100, text: "Label" }] }] }, context);
  const math = '<q:oMath xmlns:q="http://schemas.openxmlformats.org/officeDocument/2006/math"><q:r><q:t>π + 8</q:t></q:r></q:oMath>';
  volume.writeFileSync("/work/input deck.pptx", input);
  volume.writeFileSync("/work/authored math.xml", math);
  volume.writeFileSync("/work/equations.sh", "pptx equations add 'input deck.pptx' --slide 1 --shape 'Math body' --file 'authored math.xml' --output 'math deck.pptx' --json\npptx equations get 'math deck.pptx' --json");
  try {
    const result = await shell.exec("sh equations.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const lines = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines[0].operation, "equations.add");
    assert.equal(lines[0].affected, 1);
    assert.equal(lines[1].data.equations[0].text, "π + 8");
    const bytes = new Uint8Array(volume.readFileSync("/work/math deck.pptx") as Buffer);
    const sdk = await mutateEquations(input, "add", { shape: "Math body", select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } }, file: new TextEncoder().encode(math) }, context);
    assert.deepEqual(bytes, sdk.bytes);
    assert.equal((await readEquations(bytes, {}, context))[0]!.supported, true);
    const { xml } = await getXmlPart(bytes, "/ppt/slides/slide1.xml", { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 32 } });
    const mathTexts: string[] = [];
    let inMathText = false;
    let fallbackCount = 0;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", tag => {
      inMathText = tag.uri === "http://schemas.openxmlformats.org/officeDocument/2006/math" && tag.local === "t";
      if (tag.uri === "http://schemas.openxmlformats.org/markup-compatibility/2006" && tag.local === "Fallback") fallbackCount++;
    });
    parser.on("text", value => { if (inMathText) mathTexts.push(value); });
    parser.on("closetag", () => { inMathText = false; });
    parser.write(xml).close();
    assert.deepEqual(mathTexts, ["π + 8"]);
    assert.equal(fallbackCount, 1);
  } finally { await shell.dispose(); }
});

test("equation errors and dry runs leave virtual inputs and destinations unchanged", async () => {
  const { volume, shell } = fixture();
  const input = await createPresentation({ slides: [{ shapes: [{ name: "Formula", x: 0, y: 0, width: 100, height: 100, text: "Keep" }] }] }, context);
  volume.writeFileSync("/work/deck.pptx", input);
  volume.writeFileSync("/work/formula.xml", '<m:oMath xmlns:m="urn:wrong"><m:r><m:t>x</m:t></m:r></m:oMath>');
  try {
    const invalid = await shell.exec("pptx equations add deck.pptx --slide 1 --shape Formula --file formula.xml --output invalid.pptx --json");
    assert.equal(invalid.exitCode, 1);
    assert.equal(JSON.parse(invalid.stdout).errors[0].code, "unsupported-edit");
    assert.equal(JSON.parse(invalid.stdout).affected, 0);
    assert.equal(volume.existsSync("/work/invalid.pptx"), false);
    volume.writeFileSync("/work/formula.xml", '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>');
    const dry = await shell.exec("pptx equations add deck.pptx --slide 1 --shape Formula --file formula.xml --dry-run --json");
    assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).affected, 1);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
    const missingFile = await shell.exec("pptx equations add deck.pptx --shape Formula --dry-run --json");
    assert.equal(missingFile.exitCode, 2);
    const removed = await shell.exec("pptx equations remove deck.pptx --all --in-place --json");
    assert.equal(removed.exitCode, 2);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
  } finally { await shell.dispose(); }
});
