import { shellValueFromBytes } from "safe-bash-contracts/value";
import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPptxCommand, createPptxCommands } from "./index.js";

test("pptx exposes a single factory and rejects argument overflow before invoking the engine", async () => {
  let invoked = false;
  const engine = { async execute() { invoked = true; return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }; } };
  assert.equal(createPptxCommands({ engine }).length, 1);
  let guarded = false;
  const values = createCommandArguments(["é"], {
    assertOpen() {},
    reserve() {
      if (guarded) throw new Error("argument copied before admission");
      return { commit() {}, release() {} };
    }
  });
  guarded = true;
  const command = createPptxCommand({ engine, limits: { maxArgumentBytes: 1 } });
  await assert.rejects(Promise.resolve(command.execute({
    command: "pptx", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
  })), (error: unknown) => error instanceof Error && 'code' in error && error.code === "EFBIG");
  assert.equal(invoked, false);
});

for (const maxArgumentBytes of [Infinity, 2]) test("pptx preserves raw arguments with one admitted copy", async () => {
  let copies = 0;
  let counting = false;
  const values = createCommandArguments([shellValueFromBytes(new Uint8Array([0xff, 0xfe]))], {
    assertOpen() {},
    reserve() {
      if (counting) copies++;
      return { commit() {}, release() {} };
    }
  });
  counting = true;
  const engine = { async execute(request: { args: readonly Uint8Array[] }) {
    assert.deepEqual(request.args, [new Uint8Array([0xff, 0xfe])]);
    return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
  } };
  const result = await createPptxCommand({ engine, limits: { maxArgumentBytes } }).execute({
    command: "pptx", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal
  });
  assert.equal(result.exitCode, 0);
  assert.equal(copies, 1);
});

test("pptx auto-creates missing --output-dir directories during publication", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const engine = {
    async execute(request: { publishOutput?: (pub: any) => Promise<void> }) {
      await request.publishOutput!({
        outputPath: ".qa/media/part-000001.png",
        bytes: new Uint8Array([137, 80, 78, 71]),
        originalBytes: new Uint8Array(),
        inPlace: false,
        force: true,
        dryRun: true
      });
      await request.publishOutput!({
        outputPath: ".qa/media/part-000001.png",
        bytes: new Uint8Array([137, 80, 78, 71]),
        originalBytes: new Uint8Array(),
        inPlace: false,
        force: true,
        dryRun: false
      });
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    }
  };
  const values = createCommandArguments(["images", "extract", "deck.pptx", "--output-dir", ".qa/media"]);
  const result = await createPptxCommand({ engine }).execute({
    command: "pptx",
    args: values.args,
    argumentValues: values,
    cwd: "/work",
    env: {},
    fs,
    stdin: toByteSource(""),
    stdout: { async write() {} },
    stderr: { async write() {} },
    signal: new AbortController().signal
  });
  assert.equal(result.exitCode, 0);
  const written = await fs.readFile("/work/.qa/media/part-000001.png");
  assert.deepEqual(written, new Uint8Array([137, 80, 78, 71]));
});
