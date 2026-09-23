import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem } from "../../../src/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";

for (const [flags, stdout, files] of [
  ["-o /first", "/right", { "/first": "/left" }],
  ["-o /first -o /second", "", { "/first": "/left", "/second": "/right" }],
  ["-O -O", "", { "/left": "/left", "/right": "/right" }],
  ["-o /first -O", "", { "/first": "/left", "/right": "/right" }],
  ["-D /headers", "/left/right", { "/headers": "HTTP/1.1 200 OK\r\n\r\nHTTP/1.1 200 OK\r\n\r\n" }],
] as const) {
  test(`curl associates multiple URL outputs: ${flags}`, async () => {
    const fs = createMemoryFileSystem();
    let disposed = 0;
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => true,
      transport: async request => ({ status: 200, statusText: "OK", headers: [],
        body: toByteSource(new URL(request.url).pathname), async dispose() { disposed++; } }),
    }));
    try {
      const result = await shell.exec(`curl -sS ${flags} https://example.invalid/left https://example.invalid/right`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
      for (const [path, contents] of Object.entries(files)) {
        assert.equal(new TextDecoder().decode(await fs.readFile(path)), contents);
      }
      assert.equal(disposed, 2);
    } finally { await shell.dispose(); }
  });
}

test("curl multiple file outputs preserve bytes and authorize each transfer", async () => {
  const fs = createMemoryFileSystem();
  const payload = new Uint8Array([0, 255, 13, 10]);
  const authorized: string[] = [];
  let disposed = 0;
  await fs.writeFile("/headers", new TextEncoder().encode("old headers"));
  const shell = new Shell({ fs, limits: { maxOutputBytes: 0 } }).use(networkCommands({
    authorize: request => { authorized.push(request.url); return true; },
    transport: async () => ({ status: 200, statusText: "OK", headers: [],
      body: toByteSource(payload), async dispose() { disposed++; } }),
  }));
  try {
    const result = await shell.exec("curl -sS -o /first -O -D /headers https://example.invalid/left https://example.invalid/right");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readFile("/first"), payload);
    assert.deepEqual(await fs.readFile("/right"), payload);
    assert.equal(new TextDecoder().decode(await fs.readFile("/headers")), "HTTP/1.1 200 OK\r\n\r\nHTTP/1.1 200 OK\r\n\r\n");
    assert.deepEqual(authorized, ["https://example.invalid/left", "https://example.invalid/right"]);
    assert.equal(disposed, 2);
  } finally { await shell.dispose(); }
});
