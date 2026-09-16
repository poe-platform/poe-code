import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import * as sdk from "docx";
import * as rootSdk from "poe-code/docx";
import { Shell, agentCommands, FsError } from "@poe-platform/safe-bash";
import { docxCommands, type DocxCommandEngine } from "@poe-platform/safe-bash/commands/docx";
import { docxCommands as rootCommands } from "poe-code/safe-bash/commands/docx";
import type { FileSystem, FileStat } from "@poe-platform/safe-bash/contracts";

const limits: sdk.ArchiveLimits = {
  maxArchiveBytes: 131072, maxEntryBytes: 65536, maxTotalBytes: 131072,
  maxMembers: 32, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024,
  maxCommentBytes: 1024, maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 1024
};
const context = () => ({ limits, signal: new AbortController().signal });
const content: sdk.DocxContent = { version: 1, blocks: [
  { kind: "paragraph", runs: [{ text: 'Coast café 日本語 "quoted"', bold: true }] }
] };

function fixture() {
  const volume = Volume.fromJSON({ "/work/content.json": JSON.stringify(content) });
  const stat = (path: string): FileStat => {
    if (!volume.existsSync(path)) throw new FsError("ENOENT", { path });
    const value = volume.lstatSync(path);
    return { type: value.isDirectory() ? "directory" : value.isSymbolicLink() ? "symlink" : "file",
      size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, atimeMs: value.atimeMs,
      ctimeMs: value.ctimeMs, ino: value.ino, dev: value.dev, identityScope: volume };
  };
  const fs: FileSystem = {
    capabilities: { read: true, write: true, append: true, open: false, explicitDirectories: true },
    async readFile(path, options) { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Uint8Array); },
    async writeFile(path, bytes, options) { options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes); },
    async appendFile(path, bytes, options) { options?.signal?.throwIfAborted(); volume.appendFileSync(path, bytes); },
    async stat(path, options) { options?.signal?.throwIfAborted(); return stat(path); },
    async lstat(path, options) { options?.signal?.throwIfAborted(); return stat(path); },
    async readdir(path, options) { options?.signal?.throwIfAborted(); return volume.readdirSync(path).map(name => ({ name: String(name), type: stat(`${path}/${String(name)}`).type })); },
    async mkdir(path, options) { options?.signal?.throwIfAborted(); volume.mkdirSync(path, { recursive: options?.recursive ?? false }); },
    async rm(path, options) { options?.signal?.throwIfAborted(); volume.rmSync(path, { recursive: options?.recursive ?? false, force: options?.force ?? false }); },
    async rename(from, to, options) { options?.signal?.throwIfAborted(); volume.renameSync(from, to); },
    async copyFile(from, to, options) { options?.signal?.throwIfAborted(); volume.copyFileSync(from, to); },
    async realpath(path, options) { options?.signal?.throwIfAborted(); if (!volume.existsSync(path)) throw new FsError("ENOENT", { path }); return String(volume.realpathSync(path)); },
    async access(path, mode, options) { options?.signal?.throwIfAborted(); if (!volume.existsSync(path)) throw new FsError("ENOENT", { path }); volume.accessSync(path, mode); }
  };
  const engine: DocxCommandEngine = sdk.createDocxInspectionCommandEngine({ limits });
  const shell = new Shell({ fs, cwd: "/work", deviceView: "provided" }).use(agentCommands()).use(docxCommands({ engine }));
  return { volume, fs, shell };
}

test("built package and root subpaths expose the same SDK and plugin", () => {
  assert.equal(rootSdk.createDocumentArchive, sdk.createDocumentArchive);
  assert.equal(rootSdk.replaceDocumentText, sdk.replaceDocumentText);
  assert.equal(rootCommands, docxCommands);
  assert.ok(import.meta.resolve("poe-code/docx").endsWith("/dist/index.js"));
  assert.ok(import.meta.resolve("poe-code/safe-bash/commands/docx").endsWith("/dist/commands/docx/index.js"));
});

test("built shell creates from JSON stdin and retains binary bytes through pipes and redirection", async () => {
  const { shell, volume } = fixture();
  try {
    const result = await shell.exec("cat content.json | docx create --content-file - --output - | cat > 'coast café.docx'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderr, "");
    const bytes = new Uint8Array(volume.readFileSync("/work/coast café.docx") as Uint8Array);
    assert.deepEqual(bytes.slice(0, 4), Uint8Array.of(80, 75, 3, 4));
    const archive = await sdk.readDocumentArchive(bytes, context());
    assert.equal(sdk.validateDocumentArchive(archive).valid, true);
    const sdkText = await sdk.extractDocumentText(bytes, context());
    assert.equal(sdkText.segments.find(segment => segment.kind === "text")?.formatting.bold, true);
    const read = await shell.exec("cat 'coast café.docx' | docx text - --json");
    assert.equal(read.exitCode, 0, read.stderr);
    const envelope = JSON.parse(read.stdout);
    assert.equal(envelope.operation, "text.get");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.data, sdkText);
    const expected = Volume.fromJSON({ "/bytes": "" });
    await sdk.createDocument({ content }, { output: "-" }, { ...context(),
      encoding: { order: "name", compression: "store" }, stdout: {
        async write(chunk) { expected.appendFileSync("/bytes", chunk); }
      } });
    assert.deepEqual(bytes, new Uint8Array(expected.readFileSync("/bytes") as Uint8Array));
    volume.writeFileSync("/work/deflated.docx", "");
    await sdk.writeDocumentArchive(archive, {
      async write(chunk) { volume.appendFileSync("/work/deflated.docx", chunk); }
    }, { order: "name", compression: "deflate" }, context());
    const inflated = await shell.exec("cat deflated.docx | docx text - --json");
    assert.equal(inflated.exitCode, 0, inflated.stderr);
    const compressedBytes = new Uint8Array(volume.readFileSync("/work/deflated.docx") as Uint8Array);
    assert.deepEqual(JSON.parse(inflated.stdout).data, await sdk.extractDocumentText(compressedBytes, context()));
    assert.equal(JSON.parse(inflated.stdout).data.text, sdkText.text);
  } finally { await shell.dispose(); }
});

test("built stored sh workflow preserves quoted replacements and CLI SDK mutation parity", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/edit.sh", `set -e\nset -o pipefail\ncat content.json | docx create --content-file - -o - > 'source doc.docx'\ndocx text replace 'source doc.docx' --find 'Coast café' --with 'Harbor 🌊' --all -o - | cat > 'edited doc.docx'\ndocx text 'edited doc.docx' --json\n`);
  try {
    const result = await shell.exec("sh edit.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    const bytes = new Uint8Array(volume.readFileSync("/work/source doc.docx") as Uint8Array);
    const expected = Volume.fromJSON({ "/bytes": "" });
    await sdk.replaceDocumentText(bytes, { find: "Coast café", with: "Harbor 🌊", all: true, output: "-" }, {
      ...context(), encoding: { order: "input", compression: "store" }, stdout: {
        async write(chunk) { expected.appendFileSync("/bytes", chunk); }
      }
    });
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/edited doc.docx") as Uint8Array), new Uint8Array(expected.readFileSync("/bytes") as Uint8Array));
    assert.equal(JSON.parse(result.stdout).data.text, 'Harbor 🌊 日本語 "quoted"');
    assert.equal(JSON.parse(result.stdout).data.segments.find((segment: sdk.TextSegment) => segment.kind === "text")?.formatting.bold, true);
    const edited = new Uint8Array(volume.readFileSync("/work/edited doc.docx") as Uint8Array);
    const different = await shell.exec("docx diff 'source doc.docx' 'edited doc.docx' --mode text --scope body --json");
    assert.equal(different.exitCode, 1, different.stderr);
    assert.equal(JSON.parse(different.stdout).ok, true);
    const comparison = await sdk.compareDocument(bytes, edited, context(), { mode: "text", scope: "body" });
    assert.equal(comparison.equal, false);
    assert.deepEqual(JSON.parse(different.stdout).data, comparison);
    const equal = await shell.exec("docx diff 'source doc.docx' 'source doc.docx' --mode parts --scope package --json");
    assert.equal(equal.exitCode, 0, equal.stderr);
    assert.equal(JSON.parse(equal.stdout).data.equal, true);
    volume.writeFileSync("/work/invalid comparison.docx", "Invalid archive");
    const trouble = await shell.exec("docx diff 'source doc.docx' 'invalid comparison.docx' --mode parts --scope package --json");
    assert.equal(trouble.exitCode, 2, trouble.stderr);
    assert.equal(JSON.parse(trouble.stdout).ok, false);
  } finally { await shell.dispose(); }
});

test("built shell validates JSON stdin through the same batch schema as SDK", async () => {
  const { shell, volume } = fixture();
  const batch: sdk.DocumentBatchInput = { version: 1, operations: [
    { operation: "text.replace", arguments: { find: "Coast", with: "Harbor", all: true } }
  ] };
  volume.writeFileSync("/work/ops.json", JSON.stringify(batch));
  try {
    assert.equal((await shell.exec("docx create --content-file content.json -o - > source.docx")).exitCode, 0);
    const input = new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array);
    const result = await shell.exec("cat ops.json | docx batch source.docx --ops-file - --dry-run --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const data = await sdk.executeDocumentBatch(input, batch, { dryRun: true, json: true }, { ...context(), encoding: { order: "input", compression: "store" } });
    assert.deepEqual(JSON.parse(result.stdout).data, data);
    const invalid = { ...batch, unexpected: true };
    await assert.rejects(sdk.executeDocumentBatch(input, invalid, { dryRun: true }, { ...context(), encoding: { order: "input", compression: "store" } }), sdk.DocxUsageError);
    const refused = await shell.exec("docx batch source.docx --ops-file - --dry-run --json", { stdin: new TextEncoder().encode(JSON.stringify(invalid)) });
    assert.equal(refused.exitCode, 2);
    assert.equal(JSON.parse(refused.stdout).ok, false);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.docx") as Uint8Array), input);
  } finally { await shell.dispose(); }
});

test("built explicit plugin collisions preserve registry and deliberate replacement", async () => {
  const { shell } = fixture();
  const replacement: DocxCommandEngine = { async execute() { return { exitCode: 4 }; } };
  try {
    assert.equal((await shell.exec("docx version --json")).exitCode, 0);
    const original = shell.commands.get("docx");
    const collision = new Shell({ fs: fixture().fs, commands: shell.commands }).use(docxCommands({ engine: replacement }));
    await assert.rejects(collision.exec("docx version"), /already registered/);
    assert.equal(shell.commands.get("docx"), original);
    await collision.dispose();
    shell.use(docxCommands({ engine: replacement, replace: true }));
    assert.equal((await shell.exec("docx version")).exitCode, 4);
  } finally { await shell.dispose(); }
});

test("built shell publishes pipeline statuses and applies pipefail to document failures", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/bad.docx", "Invalid archive");
  try {
    assert.equal((await shell.exec("docx text bad.docx | cat")).exitCode, 0);
    const failed = await shell.exec("set -o pipefail; docx text bad.docx --json | cat");
    assert.equal(failed.exitCode, 1);
    assert.equal(JSON.parse(failed.stdout).ok, false);
    const statuses = await shell.exec('docx text bad.docx | cat; printf "%s\\n" "${PIPESTATUS[@]}"');
    assert.equal(statuses.stdout, "1\n0\n");
    const usage = await shell.exec("set -o pipefail; docx text bad.docx --surprise | cat");
    assert.equal(usage.exitCode, 2);
  } finally { await shell.dispose(); }
});

test("built shell caller cancellation stops document admission before binary publication", async () => {
  const { shell, fs, volume } = fixture();
  const controller = new AbortController();
  const reason = new Error("Stopped document input");
  const originalRead = fs.readFile;
  let reads = 0;
  fs.readFile = async (path, options) => {
    if (path.endsWith("content.json")) { reads++; controller.abort(reason); }
    return originalRead(path, options);
  };
  try {
    await assert.rejects(shell.exec("docx create --content-file content.json -o -", { signal: controller.signal }), error => error === reason);
    assert.equal(reads, 1);
    assert.equal(volume.existsSync("/work/output.docx"), false);
    fs.readFile = originalRead;
    assert.equal((await shell.exec("docx version --json")).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("built discovery and end-of-options retain common names and real failure categories", async () => {
  const { shell, volume } = fixture();
  try {
    const created = await shell.exec("docx create --content-file content.json -o - > ./--survey.docx");
    assert.equal(created.exitCode, 0, created.stderr);
    const text = await shell.exec("docx text --json -- '--survey.docx'");
    assert.equal(text.exitCode, 0, text.stderr);
    assert.equal(JSON.parse(text.stdout).data.text, 'Coast café 日本語 "quoted"');
    for (const resource of ["images", "tables", "properties"]) {
      const schema = await shell.exec(`docx schema ${resource} list --json`);
      assert.equal(schema.exitCode, 0, schema.stderr);
      assert.equal(JSON.parse(schema.stdout).data.operations[0].id, `${resource}.list`);
    }
    for (const alias of ["image", "table", "metadata", "replace"]) {
      assert.equal((await shell.exec(`docx ${alias} --help`)).exitCode, 2);
    }
    const missing = await shell.exec("docx text missing.docx --json");
    assert.equal(missing.exitCode, 3);
    assert.equal(JSON.parse(missing.stdout).errors[0].code, "source-failure");
    const limited = await shell.exec("docx text ./--survey.docx --limit compressedInput=1 --json");
    assert.equal(limited.exitCode, 4, limited.stderr);
    assert.equal(JSON.parse(limited.stdout).errors[0].code, "limit-exceeded");
    const bytes = new Uint8Array(volume.readFileSync("/work/--survey.docx") as Uint8Array);
    await assert.rejects(sdk.extractDocumentText(bytes, context(), { limit: [{ name: "compressedInput", value: 1 }] }), sdk.ResourceLimitError);
  } finally { await shell.dispose(); }
});
