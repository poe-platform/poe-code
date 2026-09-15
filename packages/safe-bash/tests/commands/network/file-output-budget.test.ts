import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError, cloudflareWorkerLimits, createMemoryFileSystem, standardCommands } from "../../../src/index.js";
import { FsError, type ByteSource } from "../../../src/contracts/index.js";
import { networkCommands, type NetworkLimits } from "../../../src/commands/network/index.js";

function fixture(options: { buffered?: boolean; chunkBytes?: number; maxOutputBytes?: number; limits?: Partial<NetworkLimits>; quota?: boolean; headers?: [string, string][] } = {}) {
  const fs = createMemoryFileSystem();
  const payload = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
  const state = { disposed: 0, produced: 0, streams: 0 };
  const writeStream = fs.writeStream.bind(fs);
  fs.writeStream = async (path, source: ByteSource, writeOptions) => {
    state.streams++;
    if (options.buffered) throw new FsError("ENOTSUP");
    if (options.quota) {
      for await (const chunk of source) {
        assert.equal(chunk.byteLength, 4096);
        throw new FsError("ENOSPC");
      }
      return;
    }
    await writeStream(path, source, writeOptions);
  };
  const shell = new Shell({ fs, limits: { ...cloudflareWorkerLimits, maxOutputBytes: options.maxOutputBytes ?? 1024 } })
    .use(standardCommands()).use(networkCommands({
      authorize: () => true,
      limits: { maxDownloadBytes: 8192, ...options.limits },
      transport: async () => ({
        status: 200, statusText: "OK", headers: options.headers ?? [],
        body: (async function* () {
          const size = options.chunkBytes ?? payload.length;
          for (let offset = 0; offset < payload.length; offset += size) {
            state.produced++;
            yield payload.subarray(offset, offset + size);
          }
        })(),
        async dispose() { state.disposed++; },
      }),
    }));
  return { fs, shell, payload, state };
}

for (const buffered of [false, true]) for (const chunkBytes of [256, 4096]) {
  for (const command of ["curl -s -o /file.bin", "curl -s -O", "wget -q -O /file.bin"]) {
    test(`${command}: ${buffered ? "buffered" : "streaming"} download in ${chunkBytes}-byte chunks ignores terminal budget`, async () => {
      const { fs, shell, payload, state } = fixture({ buffered, chunkBytes });
      try {
        const result = await shell.exec(`${command} https://example.invalid/file.bin`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(await fs.readFile("/file.bin"), payload);
        assert.equal(state.produced, payload.length / chunkBytes);
        assert.equal(state.disposed, 1);
        assert.equal(state.streams, 1);
      } finally { await shell.dispose(); }
    });
  }
}

for (const maxOutputBytes of [0, 3]) test(`body and header files leave ${maxOutputBytes} terminal bytes available`, async () => {
  const { fs, shell, payload, state } = fixture({ maxOutputBytes });
  try {
    const result = await shell.exec(`curl -s -o /file.bin -D /headers -w '${"x".repeat(maxOutputBytes)}' https://example.invalid/file.bin`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "x".repeat(maxOutputBytes));
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/file.bin"), payload);
    assert.equal(new TextDecoder().decode(await fs.readFile("/headers")), "HTTP/1.1 200 OK\r\n\r\n");
    assert.equal(state.disposed, 1);
  } finally { await shell.dispose(); }
});

for (const source of [
  "curl -s https://example.invalid/file.bin",
  "curl -s -o - https://example.invalid/file.bin",
  "curl -s https://example.invalid/file.bin | cat",
  "curl -s https://example.invalid/file.bin > /redirected",
  "curl -s -o /file.bin -D - https://example.invalid/file.bin",
  "curl -s -o /file.bin -w 12345 https://example.invalid/file.bin",
]) test(`terminal and pipeline limits remain enforced: ${source}`, async () => {
  const { shell, state } = fixture({ maxOutputBytes: 4 });
  try {
    await assert.rejects(shell.exec(source), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(state.disposed, 1);
  } finally { await shell.dispose(); }
});

for (const buffered of [false, true]) test(`download byte limit still bounds ${buffered ? "buffered" : "streaming"} files`, async () => {
  const { shell, state } = fixture({ buffered, chunkBytes: 1024, limits: { maxDownloadBytes: 2048 } });
  try {
    const result = await shell.exec("curl -sS -o /file.bin https://example.invalid/file.bin");
    assert.equal(result.exitCode, 63);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "curl: (63) Response exceeds download byte limit\n");
    assert.equal(state.produced, 3);
    assert.equal(state.disposed, 1);
  } finally { await shell.dispose(); }
});

test("filesystem quota errors are not masked by the terminal budget", async () => {
  const { shell, state } = fixture({ quota: true });
  try {
    const result = await shell.exec("curl -sS -o /file.bin https://example.invalid/file.bin");
    assert.equal(result.exitCode, 23);
    assert.ok(result.stderr.includes("ENOSPC"), result.stderr);
    assert.equal(state.disposed, 1);
  } finally { await shell.dispose(); }
});

test("header file output retains the network header limit", async () => {
  const { shell, state } = fixture({ limits: { maxHeaderBytes: 128 }, headers: [["X-Large", "x".repeat(256)]] });
  try {
    const result = await shell.exec("curl -sS -o /file.bin -D /headers https://example.invalid/file.bin");
    assert.equal(result.exitCode, 63);
    assert.equal(result.stdout, "");
    assert.equal(state.disposed, 1);
  } finally { await shell.dispose(); }
});
