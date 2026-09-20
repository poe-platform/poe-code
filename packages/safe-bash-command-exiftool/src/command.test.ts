import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import type { ByteSink } from "safe-bash-contracts/io";
import { shellValueFromBytes, type ShellValue } from "safe-bash-contracts/value";
import { createExiftoolCommand, type ExiftoolCommandOptions } from "./command.js";
import { fixture } from "./fixtures.js";
import { pngChunk } from "./png.js";

test("buffered VFS fallback refuses bytes beyond the admitted stat extent", async () => {
  for (const argfile of [false, true]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/image.png", fixture("old"));
    await fs.writeFile("/args", new TextEncoder().encode("-Title\nimage.png\n"));
    Object.defineProperty(fs, "readStream", { value: undefined });
    const read = fs.readFile.bind(fs);
    fs.readFile = async (path, options) => {
      const bytes = await read(path, options);
      const result = new Uint8Array(bytes.length + 1);
      result.set(bytes);
      return result;
    };
    const result = await invoke(argfile ? ["-@", "args"] : ["-Title=new", "image.png"], fs);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /grew beyond admitted size/);
    assert.equal(result.stdout, "");
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["args", "image.png"]);
  }
});

test("conditional publication refuses a concurrently replaced source and cleans staging", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("old"));
  const replacement = fixture("concurrent");
  const publish = fs.publishStagedFile.bind(fs);
  fs.publishStagedFile = async (...args) => {
    await fs.unlink("/image.png");
    await fs.writeFile("/image.png", replacement);
    return publish(...args);
  };
  const result = await invoke(["-overwrite_original", "-Title=new", "image.png"], fs);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/image.png"), replacement);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("exclusive destinations refuse same-file, hardlink and symlink aliases", async () => {
  const fs = createMemoryFileSystem(); const original = fixture("old");
  await fs.writeFile("/image.png", original);
  await fs.link("/image.png", "/hard.png");
  await fs.symlink("/image.png", "/soft.png");
  for (const destination of ["./image.png", "hard.png", "soft.png"]) {
    const result = await invoke(["-o", destination, "-Title=new", "image.png"], fs);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await fs.readFile("/image.png"), original);
  }
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["hard.png", "image.png", "soft.png"]);
});

test("rebound directory symlink refuses publication without deleting either target", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/first"); await fs.mkdir("/second");
  const first = fixture("first"), second = fixture("second");
  await fs.writeFile("/first/image.png", first); await fs.writeFile("/second/image.png", second);
  await fs.symlink("/first", "/alias");
  const create = fs.createStagedFile.bind(fs);
  fs.createStagedFile = async (...args) => {
    const stage = await create(...args);
    await fs.unlink("/alias"); await fs.symlink("/second", "/alias");
    return stage;
  };
  const result = await invoke(["-overwrite_original", "-Title=new", "/alias/image.png"], fs);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/first/image.png"), first);
  assert.deepEqual(await fs.readFile("/second/image.png"), second);
  assert.deepEqual((await fs.readdir("/first")).map(entry => entry.name), ["image.png"]);
  assert.deepEqual((await fs.readdir("/second")).map(entry => entry.name), ["image.png"]);
});

test("streamed output is partial on later quota failure, JSON remains un-emitted", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("first", "second"));
  for (const format of ["-s3", "-j"]) {
    const fragments: Uint8Array[] = [];
    await assert.rejects(invoke([format, "-a", "-Title", "image.png"], fs,
      new AbortController().signal, { async write(bytes) { fragments.push(new Uint8Array(bytes)); } },
      { limits: { maxOutputBytes: 20 } }), /output (budget|bytes exceeded)/);
    assert.equal(Buffer.concat(fragments).toString(), format === "-s3" ? "first\n" : "");
  }
});

test("failed staging cleanup escapes rather than reporting ordinary command success", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("old"));
  const remove = fs.removeStagedFile.bind(fs);
  fs.removeStagedFile = async (...args) => { await remove(...args); throw new Error("cleanup failed"); };
  await assert.rejects(invoke(["-overwrite_original", "-Title=new", "image.png"], fs), /invocation and cleanup failed/);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

async function invoke(args: readonly ShellValue[], fs = createMemoryFileSystem(), signal = new AbortController().signal, stdoutOverride?: ByteSink, options?: ExiftoolCommandOptions, stdin: CommandContext["stdin"] = (async function* () {})()) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const carrier = createCommandArguments(args);
  const context: CommandContext = {
    command: "exiftool", args: carrier.args, argumentValues: carrier,
    fs, signal, cwd: "/", env: {}, stdin,
    stdout: stdoutOverride ?? { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  const result = await createExiftoolCommand(options).execute(context);
  for (const cleanup of cleanups) { await cleanup(); await cleanup(); }
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

test("VFS argument files expand in place with BOM, CSTR, nesting and last assignment", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("old"));
  await fs.writeFile("/nested.args", new TextEncoder().encode("-Title = first\n"));
  await fs.writeFile("/write.args", new TextEncoder().encode("\uFEFF# comment\r\n-@\nnested.args\n#[CSTR]-Title=next\\nline\nimage.png\n"));
  const result = await invoke(["-@", "write.args", "-Title=last"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await invoke(["-s3", "-Title", "image.png"], fs)).stdout, "last\n");
  assert.equal((await invoke(["-s3", "-Title", "-@", "write.args"], fs)).exitCode, 0);
  assert.equal((await invoke(["-b", "-Title", "image.png"], fs)).stdout, "next\nline");
});

test("argument files refuse cycles, stdin, config and symlinks before publication", async () => {
  const fs = createMemoryFileSystem(); const original = fixture("old"); await fs.writeFile("/image.png", original);
  await fs.writeFile("/cycle.args", new TextEncoder().encode("-@\ncycle.args\n"));
  await fs.writeFile("/config.args", new TextEncoder().encode("-config\n\n-Title=x\nimage.png\n"));
  await fs.symlink("/config.args", "/link.args");
  for (const file of ["cycle.args", "config.args", "link.args", "-"]) {
    const result = await invoke(["-@", file], fs);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "");
  }
  assert.deepEqual(await fs.readFile("/image.png"), original);
  await assert.rejects(fs.lstat("/image.png_original"), { code: "ENOENT" });
});

test("argument-file resource exhaustion escapes and cancellation finalizes producers", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/args", new TextEncoder().encode("-s3\n-Title\nimage.png\n"));
  await assert.rejects(invoke(["-@", "args"], fs, new AbortController().signal, undefined, { limits: { maxInputBytes: 1 } }), /input budget/);
  const controller = new AbortController(); const reason = new Error("cancel args"); let finalized = false;
  fs.readStream = () => (async function* () { try { yield new TextEncoder().encode("-s3\n"); controller.abort(reason); yield new Uint8Array(); } finally { finalized = true; } })();
  await assert.rejects(invoke(["-@", "args"], fs, controller.signal), error => error === reason);
  assert.equal(finalized, true);
});

test("argument-file authority preserves option values and literal -- filenames", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("old"));
  const created = await invoke(["-o", "-@", "-Title=new", "image.png"], fs);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal((await invoke(["-b", "-Title", "--", "-@"], fs)).stdout, "new");
  await fs.writeFile("/literal.args", new TextEncoder().encode("--\n-@\n"));
  assert.equal((await invoke(["-b", "-Title", "-@", "literal.args"], fs)).stdout, "new");
});

test("argument files reject malformed UTF-8 and excessive depth without image acquisition", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/invalid.args", new Uint8Array([255]));
  const invalid = await invoke(["-@", "invalid.args"], fs);
  assert.equal(invalid.exitCode, 1); assert.match(invalid.stderr, /UTF-8 argument files/);
  for (let index = 0; index < 17; index++) await fs.writeFile("/depth" + index, new TextEncoder().encode("-@\ndepth" + (index + 1) + "\n"));
  const deep = await invoke(["-@", "depth0"], fs);
  assert.equal(deep.exitCode, 1); assert.match(deep.stderr, /nesting limit/);
  await fs.writeFile("/large.args", new TextEncoder().encode("-Title\n".repeat(4097)));
  const many = await invoke(["-@", "large.args"], fs);
  assert.equal(many.exitCode, 1); assert.match(many.stderr, /argument count/);
});

test("argument-file path normalization scratch is admitted before VFS acquisition", async () => {
  const fs = createMemoryFileSystem(); let acquired = false;
  fs.lstat = async () => { acquired = true; throw new Error("unexpected acquisition"); };
  await assert.rejects(invoke(["-@", "/".repeat(1000)], fs, new AbortController().signal, undefined,
    { limits: { maxRetainedBytes: 6000 } }), /retained budget/);
  assert.equal(acquired, false);
});

test("operand path scratch is admitted before VFS acquisition", async () => {
  const fs = createMemoryFileSystem(); let acquired = false;
  fs.lstat = async () => { acquired = true; throw new Error("unexpected acquisition"); };
  await assert.rejects(invoke(["/".repeat(1000)], fs, new AbortController().signal, undefined,
    { limits: { maxRetainedBytes: 6000 } }), /retained budget/);
  assert.equal(acquired, false);
});

test("destination path scratch is admitted before backup or staging acquisition", async () => {
  const fs = createMemoryFileSystem(); const original = fixture("old");
  await fs.writeFile("/image.png", original);
  await assert.rejects(invoke(["-Title=new", "-o", "/".repeat(5000), "image.png"], fs,
    new AbortController().signal, undefined, { limits: { maxRetainedBytes: 100000 } }), /retained budget/);
  assert.deepEqual(await fs.readFile("/image.png"), original);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("argument-file streamed fragments are owned before producer reuse", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("old"));
  const contents = new TextEncoder().encode("-Title=new\nimage.png\n"); await fs.writeFile("/args", contents);
  const originalStream = fs.readStream.bind(fs); let finalized = false;
  fs.readStream = (path, options) => path !== "/args" ? originalStream(path, options) : (async function* () {
    const reused = new Uint8Array(3);
    try { for (let offset = 0; offset < contents.length; offset += 3) {
      const length = Math.min(3, contents.length - offset); reused.set(contents.subarray(offset, offset + length)); yield reused.subarray(0, length);
    } } finally { reused.fill(0); finalized = true; }
  })();
  const result = await invoke(["-@", "args"], fs);
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(finalized, true);
  assert.equal((await invoke(["-b", "-Title", "image.png"], fs)).stdout, "new");
});

test("command uses native duplicate winner, -a, -s3, -b, JSON and JSONQ", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("first", "1e999"));
  assert.equal((await invoke(["-s3", "-Title", "image.png"], fs)).stdout, "1e999\n");
  assert.equal((await invoke(["-a", "-s3", "-Title", "image.png"], fs)).stdout, "first\n1e999\n");
  assert.equal((await invoke(["-b", "-Title", "image.png"], fs)).stdout, "1e999");
  assert.equal((await invoke(["-j", "-Title", "image.png"], fs)).stdout, '[{\n  "SourceFile": "image.png",\n  "Title": 1e999\n}]\n');
  assert.equal((await invoke(["-j", "-api", "StructFormat=JSONQ", "-Title", "image.png"], fs)).stdout, '[{\n  "SourceFile": "image.png",\n  "Title": "1e999"\n}]\n');
});

test("default backup is byte exact and pre-existing backup stays intact", async () => {
  const fs = createMemoryFileSystem(); const original = fixture("old"); await fs.writeFile("/image.png", original);
  const before = await fs.stat("/image.png");
  const result = await invoke(["-Title=new", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "    1 image files updated\n");
  assert.deepEqual(await fs.readFile("/image.png_original"), original);
  assert.notEqual((await fs.stat("/image.png")).ino, before.ino);
  const backup = await fs.readFile("/image.png_original");
  assert.equal((await invoke(["-Title=again", "image.png"], fs)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/image.png_original"), backup);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["image.png", "image.png_original"]);
});

test("UTF-8 and timestamp writes share CLI/SDK publication and converted binary output", async () => {
  const fs = createMemoryFileSystem();
  const original = fixture("old");
  await fs.writeFile("/image.png", original);
  const result = await invoke(["-Title=café 水😀", "-ModifyDate=2024-02-29T12:34:56.789+05:30", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/image.png_original"), original);
  assert.equal((await invoke(["-b", "-ModifyDate", "image.png"], fs)).stdout, "2024:02:29 12:34:56");
  assert.equal((await invoke(["-n", "-s3", "-ModifyDate#", "image.png"], fs)).stdout, "2024:02:29 12:34:56\n");
  assert.equal((await invoke(["-s3", "-Title", "image.png"], fs)).stdout, "café 水😀\n");
});

test("invalid timestamps preserve input and create no backup or staging", async () => {
  const fs = createMemoryFileSystem();
  const original = fixture("old");
  await fs.writeFile("/image.png", original);
  const result = await invoke(["-Title=new", "-ModifyDate=now", "image.png"], fs);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/image.png"), original);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("binary text output retains ValueConv UTF-8 while SDK raw bytes stay stored Latin-1", async () => {
  const fs = createMemoryFileSystem();
  const base = fixture();
  const data = new Uint8Array([84, 105, 116, 108, 101, 0, 99, 97, 102, 233]);
  await fs.writeFile("/image.png", new Uint8Array(Buffer.concat([base.subarray(0, 33), pngChunk("tEXt", data), base.subarray(33)])));
  assert.equal((await invoke(["-b", "-Title", "image.png"], fs)).stdout, "café");
});

test("overwrite in place preserves inode and hardlink alias, replacement has separate control", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("old")); await fs.link("/image.png", "/alias.png");
  const before = await fs.stat("/image.png");
  const refused = await invoke(["-overwrite_original", "-Title=new", "image.png"], fs);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /hardlink replacement.*not yet supported/);
  const result = await invoke(["-overwrite_original_in_place", "-Title=new", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/image.png")).ino, before.ino);
  assert.deepEqual(await fs.readFile("/alias.png"), await fs.readFile("/image.png"));
  assert.equal((await invoke(["-s3", "-Title", "alias.png"], fs)).stdout, "new\n");
});

test("-o creates exclusively, preserves source, refuses collision without mutation", async () => {
  const fs = createMemoryFileSystem(); const original = fixture("old"); await fs.writeFile("/image.png", original);
  const result = await invoke(["-o", "copy.png", "-Title=new", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "    1 image files created\n");
  assert.deepEqual(await fs.readFile("/image.png"), original);
  const destination = await fs.readFile("/copy.png");
  assert.equal((await invoke(["-o", "copy.png", "-Title=other", "image.png"], fs)).exitCode, 1);
  assert.deepEqual(await fs.readFile("/copy.png"), destination);
  assert.deepEqual(await fs.readFile("/image.png"), original);
});

test("unsupported eval/config, Office writers, PDF redaction and unknown flags are explicit errors", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/doc.docx", new Uint8Array([80,75,3,4]));
  const doc = await invoke(["-Title=x", "doc.docx"], fs);
  assert.equal(doc.exitCode, 1); assert.match(doc.stderr, /Writing of DOCX files is not yet supported/);
  for (const args of [["-if", "1", "doc.docx"], ["-config", "evil.pm", "doc.docx"], ["-invented", "doc.docx"]]) {
    assert.equal((await invoke(args, fs)).exitCode, 1);
  }
  await fs.writeFile("/doc.pdf", new TextEncoder().encode("%PDF-1.7"));
  const pdf = await invoke(["-all=", "doc.pdf"], fs);
  assert.equal(pdf.exitCode, 1); assert.match(pdf.stderr, /historical revisions.*redaction/);
});

test("non-matching scalar removal does not create a backup or replace identity", async () => {
  const fs = createMemoryFileSystem(); const bytes = fixture("old"); await fs.writeFile("/image.png", bytes);
  const before = await fs.stat("/image.png");
  const result = await invoke(["-Title-=absent", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "    0 image files updated\n    1 image files unchanged\n");
  assert.equal((await fs.stat("/image.png")).ino, before.ino);
  assert.deepEqual(await fs.readFile("/image.png"), bytes);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("unadmitted known readers report unsupported instead of empty successful extraction", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/doc.xmp", new TextEncoder().encode("<x:xmpmeta/>"));
  const result = await invoke(["-Title", "doc.xmp"], fs);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /reader not yet supported/);
});

test("publication failure preserves input, cleans owned staging, and is not suppressed", async () => {
  const fs = createMemoryFileSystem(); const input = fixture("old"); await fs.writeFile("/image.png", input);
  fs.publishStagedFile = async () => { throw new Error("injected publication failure"); };
  const result = await invoke(["-overwrite_original", "-Title=new", "image.png"], fs);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /injected publication failure/);
  assert.deepEqual(await fs.readFile("/image.png"), input);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("cancellation after staging cleans resources before invocation settles", async () => {
  const fs = createMemoryFileSystem(); const input = fixture("old"); await fs.writeFile("/image.png", input);
  const controller = new AbortController(); const reason = new Error("cancel staging");
  const create = fs.createStagedFile.bind(fs);
  fs.createStagedFile = async (...args) => { const stage = await create(...args); controller.abort(reason); return stage; };
  await assert.rejects(invoke(["-overwrite_original", "-Title=new", "image.png"], fs, controller.signal), error => error === reason);
  assert.deepEqual(await fs.readFile("/image.png"), input);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("invocation cancellation awaits enrolled cooperative stdout writes", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("value"));
  const controller = new AbortController(), consumer = new AbortController();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const write = async (): Promise<void> => { entered(); await blocked; };
  const sink: ByteSink = { write, ownedOutput: { write, consumerClosed: consumer.signal } };
  const reason = new Error("stop output");
  let settled = false;
  const result = invoke(["-s3", "-Title", "image.png"], fs, controller.signal, sink);
  void result.then(() => { settled = true; }, () => { settled = true; });
  await started; controller.abort(reason);
  await new Promise<void>(resolve => setImmediate(resolve));
  const settledBeforeRelease = settled;
  release();
  await assert.rejects(result, error => error === reason);
  assert.equal(settledBeforeRelease, false);
});

test("unqualified byte argv charset is explicitly refused before VFS acquisition", async () => {
  const fs = createMemoryFileSystem(); let acquired = false;
  fs.lstat = async () => { acquired = true; throw new Error("must not acquire"); };
  const result = await invoke(["-Title", shellValueFromBytes(new Uint8Array([255]))], fs);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /UTF-8 argv/); assert.equal(acquired, false);
});

test("VFS byte streaming owns reused fragments before producer advance/finalization", async () => {
  const fs = createMemoryFileSystem(); const source = fixture("value"); await fs.writeFile("/image.png", source);
  let finalized = false;
  fs.readFile = async () => { throw new Error("unexpected buffered read"); };
  fs.readStream = () => (async function* () {
    const fragment = Buffer.alloc(7);
    try { for (let offset = 0; offset < source.length; offset += 7) { const length = Math.min(7, source.length - offset); fragment.set(source.subarray(offset, offset + length)); yield fragment.subarray(0, length); } }
    finally { fragment.fill(0); finalized = true; }
  })();
  const result = await invoke(["-s3", "-Title", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "value\n"); assert.equal(finalized, true);
});

test("invalid scalar Title shift uses pinned warning and Nothing to do without publication", async () => {
  const fs = createMemoryFileSystem(); const bytes = fixture("old"); await fs.writeFile("/image.png", bytes);
  const result = await invoke(["-Title+=extra", "image.png"], fs);
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Warning: Shift value for XMP-xmp:Title is not a number\nNothing to do.\n");
  assert.deepEqual(await fs.readFile("/image.png"), bytes);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["image.png"]);
});

test("unknown tag names cannot acquire inherited registry policy", async () => {
  const fs = createMemoryFileSystem(); const bytes = fixture("old"); await fs.writeFile("/image.png", bytes);
  const result = await invoke(["-toString+=extra", "image.png"], fs);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /Tag write not yet supported: toString/);
  assert.deepEqual(await fs.readFile("/image.png"), bytes);
});

test("JSON suppresses identical output tokens for repeated case-normalized selectors", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("first", "second"));
  const result = await invoke(["-j", "-a", "-Title", "-title", "image.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '[{\n  "SourceFile": "image.png",\n  "Title": "second"\n}]\n');
});

test("selection algorithm work and matching-array retention are admitted before filtering", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture(...Array<string>(1000).fill("x")));
  const args = ["-s3", ...Array<string>(4000).fill("-Title"), "image.png"];
  await assert.rejects(invoke(args, fs, new AbortController().signal, undefined, { limits: { maxWork: 600000 } }), /work budget/);
  await assert.rejects(invoke(args, fs, new AbortController().signal, undefined, { limits: { maxWork: 100_000_000, maxRetainedBytes: 2_000_000 } }), /retained budget/);
});

test("JSON SourceFile provenance cannot be shadowed by a same-token stored keyword", async () => {
  const fs = createMemoryFileSystem(); const base = fixture("value");
  const input = new Uint8Array(Buffer.concat([base.subarray(0,33), pngChunk("tEXt", new TextEncoder().encode("SourceFile\0untrusted")), base.subarray(33)]));
  await fs.writeFile("/image.png", input);
  const result = await invoke(["-j", "image.png"], fs);
  assert.equal(result.stdout, '[{\n  "SourceFile": "image.png",\n  "Title": "value"\n}]\n');
});

test("repeated text rendering shares cumulative algorithm work admission", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/image.png", fixture("x".repeat(256)));
  const args = ["-s3", ...Array<string>(4000).fill("-Title"), "image.png"];
  await assert.rejects(invoke(args, fs, new AbortController().signal, undefined, { limits: { maxWork: 300000 } }), /work budget/);
});

test("CSV buffers union headers, preserves stored controls and quotes fields without Printable", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.png", fixture("first", "a\0b\x01\x7f\n"));
  const base = fixture();
  await fs.writeFile("/b.png", new Uint8Array(Buffer.concat([base.subarray(0,33), pngChunk("tEXt", new TextEncoder().encode('Author\0 A,"B" \r\n')), base.subarray(33)])));
  const result = await invoke(["-csv", "-Title", "-Author", "a.png", "b.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'SourceFile,Title,Author\na.png,"a\0b\x01\x7f\n",\nb.png,," A,""B"" \r\n"\n');
  assert.equal(result.stderr, "    2 image files read\n");
  const forced = await invoke(["-csv", "-f", "-Title", "-Author", "a.png", "b.png"], fs);
  assert.equal(forced.stdout, 'SourceFile,Title,Author\na.png,"a\0b\x01\x7f\n",-\nb.png,-," A,""B"" \r\n"\n');
});

test("CSV omits never-found headers, suppresses repeated tokens and preserves repeated files", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("first", "last"));
  const result = await invoke(["-csv", "-a", "-Title", "-Title", "-Author", "a.png", "a.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "SourceFile,Title\na.png,last\na.png,last\n");
  assert.equal(result.stderr, "    2 image files read\n");
});

test("CSV union retention is cumulative and emits no partial table when admission fails", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("x".repeat(256)));
  const fragments: Uint8Array[] = [];
  const sink: ByteSink = { async write(bytes) { fragments.push(new Uint8Array(bytes)); } };
  await assert.rejects(invoke(["-csv", "-Title", ...Array<string>(32).fill("a.png")], fs,
    new AbortController().signal, sink, { limits: { maxRetainedBytes: 100_000 } }), /retained budget/);
  assert.equal(fragments.length, 0);
});

test("CSV accepts literal option-looking VFS filenames with trailing #", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/-image.png#", fixture("x"));
  const result = await invoke(["-csv", "-Title", "--", "-image.png#"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "SourceFile,Title\n-image.png#,x\n");
});

test("missing-placeholder rendering cannot bypass cumulative work admission", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("x"));
  const args = ["-f", "-s3", ...Array<string>(2000).fill("-Title"), ...Array<string>(2000).fill("-MissingTag"), "a.png"];
  await assert.rejects(invoke(args, fs, new AbortController().signal, undefined,
    { limits: { maxWork: 300_000 } }), /work budget/);
});

test("PNG write algorithm work accumulates across files within the invocation", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("x"));
  const args = [...Array<string>(32).fill("-Title-=" + "z".repeat(64)), ...Array<string>(20).fill("a.png")];
  await assert.rejects(invoke(args, fs, new AbortController().signal, undefined, { limits: { maxWork: 150_000 } }), /work budget/);
});

test("JSON -f includes explicit missing placeholders while default JSON omits them", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("x"));
  const absent = await invoke(["-j", "-MissingTag", "a.png"], fs);
  assert.equal(absent.stdout, '[{\n  "SourceFile": "a.png"\n}]\n');
  const forced = await invoke(["-j", "-f", "-MissingTag", "a.png"], fs);
  assert.equal(forced.stdout, '[{\n  "SourceFile": "a.png",\n  "MissingTag": "-"\n}]\n');
});

test("JSON -G4 exposes duplicate instances without colliding output tokens", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("first", "second", "1e999"));
  const result = await invoke(["-j", "-G4", "-Title", "-Title", "a.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '[{\n  "SourceFile": "a.png",\n  "Copy1:Title": "first",\n  "Copy2:Title": "second",\n  ":Title": 1e999\n}]\n');
  const missing = await invoke(["-j", "-G4", "-f", "-MissingTag", "a.png"], fs);
  assert.equal(missing.stdout, '[{\n  "SourceFile": "a.png",\n  ":MissingTag": "-"\n}]\n');
});

test("lowercase -g4 grouped JSON is independently refused rather than interpreted as -G4", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/a.png", fixture("first", "second"));
  const result = await invoke(["-j", "-g4", "-Title", "a.png"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /not yet supported: -g4/);
  assert.equal(result.stdout, "");
});

test("shared cumulative output admission never changes per-file PNG extents", async () => {
  const fs = createMemoryFileSystem(); const original = fixture("old");
  await fs.writeFile("/a.png", original); await fs.writeFile("/b.png", original);
  const result = await invoke(["-overwrite_original", "-Title=new", "a.png", "b.png"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/a.png"), await fs.readFile("/b.png"));
  assert.equal((await invoke(["-s3", "-Title", "b.png"], fs)).stdout, "new\n");
});


test("stdin extraction owns reused byte fragments and never accesses the VFS", async () => {
  const fs = createMemoryFileSystem();
  fs.lstat = async () => { throw new Error("unexpected VFS access"); };
  const bytes = fixture("1e999");
  let finalized = false;
  const stdin = (async function* () {
    const buffer = new Uint8Array(7);
    try {
      for (let offset = 0; offset < bytes.length; offset += buffer.length) {
        const size = Math.min(buffer.length, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + size));
        yield buffer.subarray(0, size);
      }
    } finally { buffer.fill(0); finalized = true; }
  })();
  const result = await invoke(["-j", "-Title", "-"], fs, new AbortController().signal, undefined, undefined, stdin);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '[{\n  "SourceFile": "-",\n  "Title": 1e999\n}]\n');
  assert.equal(finalized, true);
});

test("stdin admission and cancellation finalize producers without partial output", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(); const reason = new Error("cancel stdin"); let finalized = false;
    const stdin = (async function* () {
      try {
        if (cancel) controller.abort(reason);
        yield fixture("old");
      } finally { finalized = true; }
    })();
    await assert.rejects(invoke(["-b", "-Title", "-"], createMemoryFileSystem(), controller.signal,
      undefined, { limits: { maxInputBytes: 1 } }, stdin), error => cancel ? error === reason : /input budget/.test(String(error)));
    assert.equal(finalized, true);
  }
});

test("stdin editing and repeated stdin operands fail before reading", async () => {
  let read = false;
  const stdin = (async function* () { read = true; yield fixture("old"); })();
  for (const args of [["-Title=new", "-"], ["-Title", "-", "-"]]) {
    const result = await invoke(args, createMemoryFileSystem(), new AbortController().signal, undefined, undefined, stdin);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /stdin/);
  }
  assert.equal(read, false);
});
