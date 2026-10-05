import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createHash } from "node:crypto";
import { createPptxCommandEngine, createPresentation, extractPackage } from "safe-bash-pptx-engine";
import { inspectZip } from "../../../../safe-bash-presentation-engine/tests/zip-reader.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 200000, maxReads: 1000, chunkBytes: 65536 },
  archiveLimits: { maxArchiveBytes: 200000, maxEntryBytes: 100000, maxTotalBytes: 200000, maxMembers: 100, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 100000, chunkSize: 65536 },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());
async function setup() {
  const input = await createPresentation({}, context);
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/out", { recursive: true });
  await fs.writeFile("/work/deck.pptx", input);
  await fs.writeFile("/work/out/keep.txt", Buffer.from("untouched"));
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 200000, maxArgumentBytes: 20000 }) }));
  return { input, fs, shell };
}

test("package extraction preflights directory collisions and preserves unrelated files", async t => {
  const { shell, fs } = await setup();
  t.after(() => shell.dispose());
  await fs.mkdir("/work/out/part-000002.xml");
  const result = await shell.exec("pptx extract deck.pptx --output-dir out --allow-partial-output --force --json");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).data, null);
  await assert.rejects(fs.lstat("/work/out/part-000001.xml"), { code: "ENOENT" });
  assert.equal(Buffer.from(await fs.readFile("/work/out/keep.txt")).toString(), "untouched");
  assert.equal((await fs.stat("/work/out/part-000002.xml")).type, "directory");
});

test("package extraction reports exact completed members on conditional provider failure", async t => {
  const { shell, fs } = await setup();
  t.after(() => shell.dispose());
  const publish = fs.publishStagedFile.bind(fs);
  const attempts: string[] = [];
  t.mock.method(fs, "publishStagedFile", async (...[staging, path, options]: Parameters<typeof fs.publishStagedFile>) => {
    attempts.push(path);
    if (path.endsWith("part-000002.xml")) throw new FsError("EIO");
    return publish(staging, path, options);
  });
  const result = await shell.exec("pptx extract deck.pptx --output-dir out --allow-partial-output --json");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.deepEqual(attempts, ["/work/out/part-000001.xml", "/work/out/part-000002.xml"]);
  assert.notEqual(JSON.parse(result.stdout).data, null, result.stdout);
  const outputs = JSON.parse(result.stdout).data.outputs;
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].path, "out/part-000001.xml");
  const bytes = await fs.readFile("/work/out/part-000001.xml");
  assert.equal(outputs[0].bytes, bytes.length);
  assert.equal(outputs[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  await assert.rejects(fs.lstat("/work/out/part-000002.xml"), { code: "ENOENT" });
  assert.equal(Buffer.from(await fs.readFile("/work/out/keep.txt")).toString(), "untouched");
  assert.deepEqual((await fs.readdir("/work/out")).map(entry => entry.name).sort(), ["keep.txt", "part-000001.xml"]);
});

test("package packing rejects incomplete graphs and traversal before overwriting an existing output", async t => {
  const { input, shell, fs } = await setup();
  t.after(() => shell.dispose());
  const files = await extractPackage(input, context);
  for (const file of files) await fs.writeFile(`/work/out/${file.name}`, file.bytes);
  const parts = files.filter(file => file.part !== "/ppt/slideLayouts/slideLayout1.xml").map(file => ({ part: file.part, sha256: file.sha256, file: { vfsPath: file.name } }));
  await fs.writeFile("/work/out/manifest.json", Buffer.from(JSON.stringify({ parts })));
  const incomplete = await shell.exec("pptx pack --manifest out/manifest.json --output deck.pptx --force --json");
  assert.equal(incomplete.exitCode, 1, incomplete.stdout + incomplete.stderr);
  assert.equal(JSON.parse(incomplete.stdout).data, null);
  assert.deepEqual(await fs.readFile("/work/deck.pptx"), input);
  parts[0]!.part = "/../outside.xml";
  await fs.writeFile("/work/out/manifest.json", Buffer.from(JSON.stringify({ parts })));
  const unsafe = await shell.exec("pptx pack --manifest out/manifest.json --output deck.pptx --force --json");
  assert.notEqual(unsafe.exitCode, 0, unsafe.stdout + unsafe.stderr);
  assert.deepEqual(await fs.readFile("/work/deck.pptx"), input);
  assert.equal(Buffer.from(await fs.readFile("/work/out/keep.txt")).toString(), "untouched");
});


test("package tools roundtrip all explicit relative manifest files through the shell", async t => {
  const { input, shell, fs } = await setup();
  t.after(() => shell.dispose());
  const extracted = await shell.exec("pptx extract deck.pptx --output-dir out --allow-partial-output --json");
  assert.equal(extracted.exitCode, 0, extracted.stdout + extracted.stderr);
  const outputs = JSON.parse(extracted.stdout).data.outputs;
  await fs.writeFile("/work/out/manifest.json", Buffer.from(JSON.stringify({ parts: outputs.map((file: {part: string; sha256: string; name: string}) => ({ part: file.part, sha256: file.sha256, file: { vfsPath: file.name } })) })));
  const packed = await shell.exec("pptx pack --manifest out/manifest.json --output rebuilt.pptx --json");
  assert.equal(packed.exitCode, 0, packed.stdout + packed.stderr);
  const bytes = await fs.readFile("/work/rebuilt.pptx");
  assert.deepEqual(inspectZip(bytes).map(file => [file.name, file.payload]), inspectZip(input).map(file => [file.name, file.payload]));
  assert.deepEqual(await fs.readFile("/work/deck.pptx"), input);
  assert.equal(Buffer.from(await fs.readFile("/work/out/keep.txt")).toString(), "untouched");
});
