import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createWgetCommand } from "../../../src/commands/network/wget.js";
import { toByteSource } from "../../../src/contracts/index.js";

const durations = [
  [".75", 750], ["3.", 3000], ["+3.5", 3500], [" \t3.5", 3500],
  ["3.5 \t", 3500], ["3.5s", 3500], ["0.1m", 6000],
  ["0.01h", 36000], ["0.001d", 86400], ["-0.00", 100000],
  ["0", 100000], ["0.75", 750], ["3", 3000], ["200s", 100000],
] as const;

test("wget timeout spellings download bytes through the Node HTTP transport", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(performance, "now", () => 0);
  const bytes = Uint8Array.of(248, 0, 13, 10);
  const server = createServer((_request, response) => response.end(bytes));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register(createWgetCommand({ authorize: request => new URL(request.url).origin === origin }));
  try {
    for (const [operand] of durations) {
      const result = await shell.exec(`wget -q --tries=1 -O- --timeout='${operand}' ${origin}/file`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, bytes);
    }
  } finally {
    await shell.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("wget timeout spellings preserve successful binary downloads", async () => {
  const bytes = Uint8Array.of(248, 0, 13, 10);
  let calls = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register(createWgetCommand({
    authorize: () => true,
    transport: async () => {
      calls++;
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(bytes), async dispose() {} };
    },
  }));
  try {
    for (const [operand] of durations) {
      const result = await shell.exec(`wget -q --tries=1 -O- --timeout='${operand}' https://example.test/file`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, bytes);
    }
    assert.equal(calls, durations.length);
    for (const operand of [".75", "+3", "3s", "-0", " 3", "3."]) {
      assert.equal((await shell.exec(`wget -q --tries='${operand}' https://example.test/file`)).exitCode, 2);
    }
    assert.equal(calls, durations.length);
  } finally { await shell.dispose(); }
});

for (const [operand, milliseconds] of durations) {
  for (const option of [`--timeout '${operand}'`, `--timeout='${operand}'`, `-T '${operand}'`, `-T'${operand}'`]) {
    test(`wget timeout grammar and host-capped deadline: ${option}`, async context => {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      context.mock.method(performance, "now", () => 0);
      let calls = 0;
      const shell = new Shell({ fs: new MemoryFileSystem() });
      shell.register(createWgetCommand({
        authorize: () => true,
        limits: { maxTimeMs: 100000, maxTotalTimeMs: 200000 },
        transport: async request => {
          calls++;
          context.mock.timers.tick(milliseconds - 1);
          assert.equal(request.signal.aborted, false);
          context.mock.timers.tick(1);
          assert.equal(request.signal.aborted, true);
          return { status: 200, statusText: "OK", headers: [], body: toByteSource("reply"), async dispose() {} };
        },
      }));
      try {
        const result = await shell.exec(`wget -q --tries=1 -O- ${option} https://example.test/file`);
        assert.equal(result.exitCode, 4, result.stderr);
        assert.equal(calls, 1);
      } finally { await shell.dispose(); }
    });
  }
}

for (const operand of ["", ".", "+", "1e2", "0x10", "Inf", "NaN", "-1", "-.1", "3ms", "3S", "3 s", "3m junk", "1.2.3", "\u00a03", "9007199254740992"]) {
  test(`wget rejects invalid timeout before transport: ${JSON.stringify(operand)}`, async () => {
    let calls = 0;
    const shell = new Shell({ fs: new MemoryFileSystem() });
      shell.register(createWgetCommand({
      authorize: () => true,
      transport: async () => {
        calls++;
        return { status: 200, statusText: "OK", headers: [], body: toByteSource("reply"), async dispose() {} };
      },
    }));
    try {
      const result = await shell.exec(`wget -q --tries=1 -O- --timeout='${operand}' https://example.test/file`);
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(calls, 0);
    } finally { await shell.dispose(); }
  });
}
