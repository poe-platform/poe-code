import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { openFileOutput } from "../../src/contracts/filesystem-output.js";
import { agentCommands } from "../../src/index.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import type { ByteSource, FileSystem, WriteFileOptions } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";

test("actual Shell custom output API retains the native-qualified renamed target", async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  shell.register({ name: "retained", async execute(invocation) {
    const target = await openFileOutput(invocation, "/out", { flag: "w", descriptor: true });
    await target.sink.write(Uint8Array.of(97));
    await fs.rename("/out", "/moved");
    await target.sink.write(Uint8Array.of(98));
    await target.finish();
    const moved = await fs.readFile("/moved");
    let out = 0;
    try { await fs.stat("/out"); } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      out = 1;
    }
    await invocation.stdout.write(Buffer.from(`moved=<${Buffer.from(moved).toString()}>;out=${out}`));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("retained");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "6d6f7665643d3c61623e3b6f75743d31");
  assert.deepEqual(await fs.readFile("/moved"), Uint8Array.of(97, 98));
  await assert.rejects(fs.stat("/out"), { code: "ENOENT" });
});

for (const maximum of [2, 3]) test(`canonical named bytes and stdout share one actual Shell budget: ${maximum}`, async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, limits: { maxOutputBytes: maximum } });
  context.after(() => shell.dispose());
  shell.register({ name: "write", async execute(invocation) {
    const target = await openFileOutput(invocation, "/out", { flag: "w", descriptor: true });
    await target.sink.write(Uint8Array.of(0, 255));
    await target.finish();
    await invocation.stdout.write(Uint8Array.of(128));
    return { exitCode: 0 };
  } });
  if (maximum === 2) await assert.rejects(shell.exec("write"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  else {
    const result = await shell.exec("write");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(128));
  }
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(0, 255));
});

function streamingFixture(preferStreamingRedirection: boolean, maxOutputBytes = 4096, queryCapabilities = true) {
  const backing = createMemoryFileSystem();
  const state = { streams: 0, opens: 0, active: 0 };
  const capabilities = { ...backing.capabilities, preferStreamingRedirection, streamingWrite: true, streamingAppend: true };
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return queryCapabilities ? async () => capabilities : undefined;
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      state.opens++;
      return backing.open!(...args);
    };
    if (key === "writeStream") return async (path: string, source: ByteSource, options?: WriteFileOptions) => {
      state.streams++;
      state.active++;
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of source) {
          options?.signal?.throwIfAborted();
          chunks.push(Uint8Array.from(chunk));
        }
        options?.signal?.throwIfAborted();
        const bytes = new Uint8Array(Buffer.concat(chunks));
        if (options?.flag === "a") await backing.appendFile(path, bytes, options);
        else await backing.writeFile(path, bytes, options);
      } finally { state.active--; }
    };
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs, limits: { maxFileSystemOperations: 64, maxOutputBytes } }).use(agentCommands());
  return { backing, fs, shell, state };
}

for (const queryCapabilities of [true, false]) test(`streaming redirection preference preserves whole concurrent appends and explicit native handles (query=${queryCapabilities})`, async context => {
  const { backing, shell, state } = streamingFixture(true, 4096, queryCapabilities);
  context.after(() => shell.dispose());
  const lines = ["alpha", "bravo", "charlie", "delta"];
  const results = await Promise.all(lines.map(line => shell.exec(`echo ${line} >> /out`)));
  for (const result of results) assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(state.streams, 4);
  assert.equal(state.opens, 0);
  assert.deepEqual(new TextDecoder().decode(await backing.readFile("/out")).trim().split("\n").sort(), lines);
  shell.register({ name: "native", async execute(invocation) {
    const descriptor = await openCommandFile(invocation, "/out", { access: "readwrite" });
    try {
      await backing.rename("/out", "/moved");
      await descriptor.write(Uint8Array.of(90), 0);
    } finally { await descriptor.close(); }
    return { exitCode: 0 };
  } });
  const native = await shell.exec("native");
  assert.equal(native.exitCode, 0, native.stderr);
  assert.equal((await backing.readFile("/moved"))[0], 90);
  assert.equal(state.opens, 1);
  assert.equal(state.active, 0);
});

test("streaming redirection batches tiny writes without consuming one filesystem operation per fragment", async context => {
  const { backing, shell, state } = streamingFixture(true);
  context.after(() => shell.dispose());
  shell.register({ name: "fragments", async execute(invocation) {
    for (let index = 0; index < 1024; index++) await invocation.stdout.write(Uint8Array.of(120));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("fragments > /out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await backing.readFile("/out"), new Uint8Array(1024).fill(120));
  assert.equal(state.streams, 1);
  assert.equal(state.opens, 0);
});

test("streaming redirection still enforces output limits and drains the failed stream", async context => {
  const { backing, shell, state } = streamingFixture(true, 2);
  context.after(() => shell.dispose());
  await backing.writeFile("/out", Uint8Array.of(90));
  await assert.rejects(shell.exec("printf abc > /out"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(90));
  assert.equal(state.active, 0);
});

test("native output remains the default when no streaming preference is selected", async context => {
  const { backing, shell, state } = streamingFixture(false);
  context.after(() => shell.dispose());
  const result = await shell.exec("printf abc > /out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await backing.readFile("/out")), "abc");
  assert.equal(state.opens, 1);
  assert.equal(state.streams, 0);
});
