import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, FsError, toByteSource, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

async function fixture(args: string[], stdin: ByteSource, separator = "\n") {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/A", new TextEncoder().encode(`1${separator}2${separator}`));
 await fs.writeFile("/B", new TextEncoder().encode(`x${separator}`));
 const values = createCommandArguments(args);
 const output = { stdout: "", stderr: "" };
 const context: CommandContext = {
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env: {}, fs, stdin,
  stdout: { async write(bytes) { output.stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output.stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 };
 return { context, output };
}

for (const separator of ["\n", "\0"]) {
 for (const code of ["EISDIR", "EIO"] as const) {
  for (const [args, expected] of [
   [["-", "A"], `\t1${separator}\t2${separator}`],
   [["A", "-"], `1\t${separator}2\t${separator}`],
   [["-s", "A", "-", "B"], `1\t2${separator}${separator}x${separator}`],
  ] as const) {
   test(`paste continues after ${code} reading stdin: ${JSON.stringify(args)}, separator ${JSON.stringify(separator)}`, async () => {
    const stdin = { [Symbol.asyncIterator]() { return { async next() { throw new FsError(code); } }; } };
    const { context, output } = await fixture([...(separator === "\0" ? ["-z"] : []), ...args], stdin, separator);
    const result = await createPasteCommand().execute(context);
    assert.equal(result.exitCode, 1);
    assert.equal(output.stdout, expected);
    assert.equal(output.stderr.split(code).length - 1, 1, output.stderr);
   });
  }
 }
}

for (const serial of [false, true]) {
 test(`paste continues after a named stream read error, serial=${serial}`, async () => {
  const { context, output } = await fixture([...(serial ? ["-s"] : []), "A", "B"], toByteSource(""));
  const readStream = context.fs.readStream!.bind(context.fs);
  let closed = false;
  context.fs.readStream = async function* (path, options) {
   if (path !== "/A") { yield* readStream(path, options); return; }
   try {
    yield new TextEncoder().encode("partial");
    throw new FsError("EIO", { path });
   } finally { closed = true; }
  };
  const result = await createPasteCommand().execute(context);
  assert.equal(result.exitCode, 1);
  assert.equal(output.stdout, serial ? "partial\nx\n" : "partial\tx\n");
  assert.equal(output.stderr.split("EIO").length - 1, 1, output.stderr);
  assert.equal(closed, true);
 });
 for (const partial of [false, true]) {
  test(`paste retains records before a read error, serial=${serial}, partial=${partial}`, async () => {
   const stdin = { async *[Symbol.asyncIterator]() {
    yield new TextEncoder().encode(partial ? "a\nb" : "a\nb\n");
    throw new FsError("EIO");
   } };
   const { context, output } = await fixture(serial ? ["-s", "-", "B"] : ["-", "A"], stdin);
   const result = await createPasteCommand().execute(context);
   assert.equal(result.exitCode, 1);
   assert.equal(output.stdout, serial ? "a\tb\nx\n" : "a\t1\nb\t2\n");
   assert.equal(output.stderr.split("EIO").length - 1, 1, output.stderr);
  });
 }
 test(`paste handles a failed shared stdin only once, serial=${serial}`, async () => {
  let reads = 0;
  const stdin = { [Symbol.asyncIterator]() { return { async next() { reads++; throw new FsError("EIO"); } }; } };
  const { context, output } = await fixture([...(serial ? ["-s"] : []), "-", "A", "-"], stdin);
  const result = await createPasteCommand().execute(context);
  assert.equal(result.exitCode, 1);
  assert.equal(output.stdout, serial ? "\n1\t2\n\n" : "\t1\t\n\t2\t\n");
  assert.equal(output.stderr.split("EIO").length - 1, 1, output.stderr);
  assert.equal(reads, 1);
 });
 test(`paste preserves cancellation during an input read, serial=${serial}`, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel paste");
  const stdin = { [Symbol.asyncIterator]() { return { async next() { controller.abort(reason); throw reason; } }; } };
  const { context, output } = await fixture([...(serial ? ["-s"] : []), "-", "A"], stdin);
  await assert.rejects(async () => createPasteCommand().execute({ ...context, signal: controller.signal }), error => error === reason);
  assert.deepEqual(output, { stdout: "", stderr: "" });
 });
 test(`paste stops on output failure while advancing a reader, serial=${serial}`, async () => {
  const stdin = { async *[Symbol.asyncIterator]() {
   yield new TextEncoder().encode("a\nb\nc\n");
   yield new TextEncoder().encode("d\n");
  } };
  const { context, output } = await fixture([...(serial ? ["-s"] : []), "-", "A"], stdin);
  let writes = 0;
  const result = await createPasteCommand().execute({ ...context, stdout: { async write() {
   if (++writes === 2) throw new FsError("EIO", { message: "output write failed" });
  } } });
  assert.equal(result.exitCode, 1);
  assert.equal(writes, 2);
  assert.ok(output.stderr.includes("output write failed"), output.stderr);
 });
 for (const limits of [{ maxInputBytes: 1 }, { maxRecordBytes: 1 }, { maxSteps: 1 }]) {
  test(`paste stops on reader limits, serial=${serial}, ${JSON.stringify(limits)}`, async () => {
   const { context, output } = await fixture([...(serial ? ["-s"] : []), "-", "B"], toByteSource("abc\n"));
   const result = await createPasteCommand({ limits }).execute(context);
   assert.equal(result.exitCode, 1);
   assert.equal(output.stdout, "");
   assert.ok(output.stderr.includes("limit exceeded"), output.stderr);
  });
 }
}
