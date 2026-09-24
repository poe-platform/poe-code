import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";

for (const lines of [1024, 4095, 4096, 4097]) test(`wget bounds Worker URL-list turns for ${lines} blank lines`, async context => {
  const immediate = globalThis.setImmediate;
  const timeout = globalThis.setTimeout;
  let turns = 0;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate")!;
  Object.defineProperty(globalThis, "setImmediate", { ...descriptor, value: undefined });
  context.after(() => Object.defineProperty(globalThis, "setImmediate", descriptor));
  context.mock.method(globalThis, "setTimeout", (callback: () => void, delay?: number) => {
    if (delay === 0) { turns++; return immediate(callback); }
    return timeout(callback, delay);
  });
  const fs = new MemoryFileSystem();
  let authorized = 0;
  const shell = new Shell({ fs }).use(networkCommands({
    authorize: () => { authorized++; return false; },
    limits: { maxBufferBytes: 8192, maxUrls: 8 },
  }));
  const result = await shell.exec('wget -i -', { stdin: '\n'.repeat(lines) + 'https://example.test/\n' });
  assert.equal(result.exitCode, lines >= 4096 ? 2 : 4, result.stderr);
  assert.equal(authorized, lines >= 4096 ? 0 : 1);
  assert.ok(turns < 32, `scheduled ${turns} Worker turns`);
});

test("wget total deadline bounds a stalled URL-list read before authorization", async context => {
  const fs = new MemoryFileSystem();
  context.mock.method(fs, "readFile", async (_path: string, options: { signal: AbortSignal }) => {
    await new Promise<void>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    return new Uint8Array();
  });
  let authorized = 0;
  const shell = new Shell({ fs }).use(networkCommands({
    authorize: () => { authorized++; return false; }, limits: { maxTotalTimeMs: 10 },
  }));
  const result = await shell.exec('wget -i urls');
  assert.equal(result.exitCode, 4, result.stderr);
  assert.match(result.stderr, /timed out/);
  assert.equal(authorized, 0);
});

test("wget charges completed URL-list parsing to the transfer budget", async context => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const fs = new MemoryFileSystem();
  context.mock.method(fs, "readFile", async () => {
    now = 11;
    return new TextEncoder().encode('https://example.test/');
  });
  let authorized = 0;
  const shell = new Shell({ fs }).use(networkCommands({
    authorize: () => { authorized++; return false; }, limits: { maxTotalTimeMs: 10 },
  }));
  const result = await shell.exec('wget -i urls');
  assert.equal(result.exitCode, 4, result.stderr);
  assert.match(result.stderr, /timed out/);
  assert.equal(authorized, 0);
});
