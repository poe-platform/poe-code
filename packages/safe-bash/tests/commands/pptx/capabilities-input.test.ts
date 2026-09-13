import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { createPresentation, createPptxCommandEngine } from "pptx";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, toByteSource } from "../../../src/contracts/index.js";
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

function fixture(bytes: Uint8Array) {
  const volume = Volume.fromJSON({ "/work/review deck.pptx": Buffer.from(bytes) });
  const fs = new MemoryFileSystem();
  const reads: string[] = [];
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    reads.push(path);
    if (!volume.existsSync(path)) throw new FsError("ENOENT");
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 262144 }) }));
  return { volume, shell, reads };
}

test("pptx capabilities accepts a quoted input and stdin without publishing", async () => {
  const bytes = await createPresentation({ slides: [{ name: "Review" }] }, context);
  const { volume, shell, reads } = fixture(bytes);
  try {
    const general = await shell.exec("pptx capabilities --json");
    assert.equal(general.exitCode, 0, general.stdout + general.stderr);
    assert.deepEqual(reads, []);
    const file = await shell.exec("pptx capabilities 'review deck.pptx' --json");
    assert.equal(file.exitCode, 0, file.stdout + file.stderr);
    assert.equal(file.stderr, "");
    const envelope = JSON.parse(file.stdout);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.operation, "capabilities");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.errors, []);
    assert.deepEqual(envelope.data.features, JSON.parse(general.stdout).data.features);
    assert.deepEqual(envelope.data.io, { input: "explicit-vfs-or-stdin", network: false, nativeRuntime: false });
    assert.equal(envelope.data.assessment.complete, false);
    assert.ok(envelope.data.assessment.parts.some((part: { part: string }) => part.part === "/ppt/presentation.xml"));
    const stdin = await shell.exec("pptx capabilities - --json", { stdin: toByteSource(bytes) });
    assert.equal(stdin.exitCode, 0, stdin.stdout + stdin.stderr);
    assert.deepEqual(JSON.parse(stdin.stdout).data, envelope.data);
    assert.deepEqual(reads, ["/work/review deck.pptx"]);
    const limited = await shell.exec("pptx capabilities - --limit maxNodes=1 --json", { stdin: toByteSource(bytes) });
    assert.equal(limited.exitCode, 4, limited.stdout + limited.stderr);
    assert.equal(JSON.parse(limited.stdout).errors[0].code, "resource-limit");
    assert.equal(JSON.parse(limited.stdout).affected, 0);
    assert.deepEqual(volume.readFileSync("/work/review deck.pptx"), Buffer.from(bytes));
    assert.deepEqual(volume.readdirSync("/work"), ["review deck.pptx"]);
  } finally { await shell.dispose(); }
});

test("pptx capabilities reports original unknown namespace content without claiming editing", async () => {
  const parts = inspectZip(await createPresentation({ slides: [{ name: "Review" }] }, context));
  const slide = parts.find(part => part.name === "ppt/slides/slide1.xml")!;
  const xml = parseXmlPart(slide.payload, context.xmlLimits);
  const changed = xml.spliceChildren(xml.root, xml.root.children.length, 0, ['<review:annotation xmlns:review="urn:original:capability-review"/>']).bytes();
  const bytes = storedArchive(parts.map(part => ({ name: part.name, bytes: part === slide ? changed : part.payload })));
  const { volume, shell } = fixture(bytes);
  try {
    const result = await shell.exec("pptx capabilities 'review deck.pptx' --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout);
    const unknown = envelope.data.assessment.namespaces.find((entry: { namespace: string }) => entry.namespace === "urn:original:capability-review");
    assert.ok(unknown);
    assert.equal(unknown.level, "preserve");
    assert.deepEqual(unknown.parts, ["/ppt/slides/slide1.xml"]);
    assert.ok(unknown.reason.length > 0);
    assert.equal(envelope.data.assessment.complete, false);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(volume.readFileSync("/work/review deck.pptx"), Buffer.from(bytes));
  } finally { await shell.dispose(); }
});

test("pptx capabilities rejects invalid options before input reads and maps read failures", async () => {
  const { volume, shell, reads } = fixture(new Uint8Array([1, 2, 3]));
  try {
    for (const flags of ["--in-place", "--output target.pptx", "--slide 1", "--scope notes", "--json"]) {
      const result = await shell.exec(`pptx capabilities missing.pptx ${flags} --json`);
      assert.equal(result.exitCode, 2, result.stdout + result.stderr);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.data, null);
      assert.equal(envelope.affected, 0);
    }
    assert.deepEqual(reads, []);
    const missing = await shell.exec("pptx capabilities missing.pptx --json");
    assert.equal(missing.exitCode, 3, missing.stdout + missing.stderr);
    assert.equal(JSON.parse(missing.stdout).errors[0].code, "io-failure");
    const invalid = await shell.exec("pptx capabilities 'review deck.pptx' --json");
    assert.equal(invalid.exitCode, 1, invalid.stdout + invalid.stderr);
    assert.equal(JSON.parse(invalid.stdout).data, null);
    assert.equal(JSON.parse(invalid.stdout).affected, 0);
    assert.deepEqual(volume.readFileSync("/work/review deck.pptx"), Buffer.from([1, 2, 3]));
    assert.deepEqual(volume.readdirSync("/work"), ["review deck.pptx"]);
  } finally { await shell.dispose(); }
});
