import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Shell } from "../../../src/shell/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { createCurlCommand } from "../../../src/commands/network/curl.js";
import type { HttpTransport } from "../../../src/commands/network/types.js";

test("curl resume suffix matches native curl over HTTP", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.range, "bytes=12-");
    response.writeHead(206, { "Content-Range": "bytes 12-17/18", "Content-Length": "6" });
    response.end("owned\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/file`;
  const shell = new Shell({ fs: new MemoryFileSystem() }).register(createCurlCommand({ authorize: () => true }));
  try {
    for (const options of [["-C", "12"], ["-C12"], ["--continue-at", "12"]]) {
      const native = await promisify(execFile)("curl", ["-q", "--noproxy", "*", "-sS", ...options, url]);
      const actual = await shell.exec(`curl -sS ${options.join(" ")} ${url}`);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stdout, native.stdout);
      assert.equal(actual.stderr, native.stderr);
    }
  } finally {
    await shell.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("curl rejects invalid resume offsets before network authorization", async () => {
  let authorized = false;
  const shell = new Shell({ fs: new MemoryFileSystem() }).register(createCurlCommand({
    authorize() { authorized = true; return true; },
  }));
  try {
    for (const value of ["-1", "1.5", "abc", "9007199254740992"]) {
      const result = await shell.exec(`curl -sS -C ${value} http://example.test/file`);
      assert.equal(result.exitCode, 2);
    }
    assert.equal(authorized, false);
  } finally { await shell.dispose(); }
});

for (const option of ["-C 12", "-C12", "--continue-at 12", "--continue-at=12", "-C -", "--continue-at -"]) {
  test(`Shell curl resumes with ${option}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/restored", Buffer.from("Independent "));
    const transport: HttpTransport = async request => {
      assert.deepEqual(request.headers.find(([name]) => name === "Range"), ["Range", "bytes=12-"]);
      return { status: 206, statusText: "Partial Content", headers: [["Content-Range", "bytes 12-17/18"], ["Content-Length", "6"]], body: toByteSource("owned\n"), async dispose() {} };
    };
    const shell = new Shell({ fs }).register(createCurlCommand({ authorize: () => true, transport }));
    try {
      const result = await shell.exec(`curl -sS ${option} -o /restored http://example.test/file`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(await fs.readFile("/restored")).toString(), "Independent owned\n");
      if (!option.endsWith("-")) {
        const stdout = await shell.exec(`curl -sS ${option} http://example.test/file`);
        assert.equal(stdout.exitCode, 0, stdout.stderr);
        assert.equal(stdout.stdout, "owned\n");
      }
    } finally { await shell.dispose(); }
  });
}

for (const [status, range, code] of [[200, undefined, 33], [206, "bytes 11-17/18", 33], [416, "bytes */12", 0]] as const) {
  test(`curl resume protects output for HTTP ${status} ${range}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/restored", Buffer.from("Independent "));
    const shell = new Shell({ fs }).register(createCurlCommand({ authorize: () => true, transport: async () => ({
      status, statusText: "Response", headers: range ? [["Content-Range", range]] : [], body: toByteSource("wrong"), async dispose() {},
    }) }));
    try {
      const result = await shell.exec("curl -sS -C - -o /restored http://example.test/file");
      assert.equal(result.exitCode, code, result.stderr);
      assert.equal(Buffer.from(await fs.readFile("/restored")).toString(), "Independent ");
    } finally { await shell.dispose(); }
  });
}
