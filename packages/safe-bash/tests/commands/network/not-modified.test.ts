import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem } from "../../../src/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";

for (const status of [200, 204, 304]) for (const existing of [false, true]) {
  for (const flags of ["", "--fail-with-body", "-f", "-i", "-I"]) {
    test(`curl HTTP ${status} ${flags} with ${existing ? "existing" : "missing"} body output`, async () => {
      const fs = createMemoryFileSystem();
      const cached = new Uint8Array([67, 254, 0, 10]);
      if (existing) await fs.writeFile("/cached", cached);
      let disposed = 0;
      let reads = 0;
      const headers = `HTTP/1.1 ${status} Fixture\r\nETag: "cached"\r\nContent-Length: 0\r\n\r\n`;
      const shell = new Shell({ fs }).use(networkCommands({
        authorize: () => true,
        transport: async request => {
          assert.ok(request.headers.some(([name, value]) => name.toLowerCase() === "if-none-match" && value === '"cached"'));
          return {
            status, statusText: "Fixture", headers: [["ETag", '"cached"'], ["Content-Length", "0"]],
            body: (async function* () { reads++; yield new Uint8Array(); })(),
            async dispose() { disposed++; },
          };
        },
      }));
      try {
        const result = await shell.exec(`curl -s ${flags} -H 'If-None-Match: "cached"' -D /headers -o /cached -w '%{http_code}:%{size_download}:%{exitcode}' https://offline.invalid/cached`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, `${status}:0:0`);
        assert.equal(result.stderr, "");
        assert.equal(new TextDecoder().decode(await fs.readFile("/headers")), headers);
        const includesHeaders = flags === "-i" || flags === "-I";
        if (status === 304 && !includesHeaders) {
          if (existing) assert.deepEqual(await fs.readFile("/cached"), cached);
          else await assert.rejects(fs.stat("/cached"), { code: "ENOENT" });
        } else {
          assert.deepEqual(await fs.readFile("/cached"), new TextEncoder().encode(includesHeaders ? headers : ""));
        }
        assert.equal(reads, status === 304 || flags === "-I" ? 0 : 1);
        assert.equal(disposed, 1);
      } finally { await shell.dispose(); }
    });
  }
}

for (const comparison of [undefined, '"current"\n', '"changed"\r\n']) {
  test(`curl saves and compares VFS ETags: ${comparison ?? "save only"}`, async () => {
    const fs = createMemoryFileSystem();
    if (comparison !== undefined) await fs.writeFile("/tag", new TextEncoder().encode(comparison));
    const current = comparison === '"current"\n';
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => true,
      transport: async request => {
        const conditional = request.headers.find(([name]) => name.toLowerCase() === "if-none-match");
        assert.equal(conditional?.[1], comparison?.trim());
        return {
          status: current ? 304 : 200, statusText: "Fixture", headers: [["ETag", '"current"']],
          body: (async function* () { if (!current) yield new TextEncoder().encode("representation\n"); })(),
          async dispose() {},
        };
      },
    }));
    try {
      const result = await shell.exec(`curl -sS --etag-save /tag ${comparison === undefined ? "" : "--etag-compare /tag"} https://offline.invalid/resource`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, current ? "" : "representation\n");
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/tag")), '"current"\n');
    } finally { await shell.dispose(); }
  });
}

for (const content of [undefined, "", 'W/"tag"\r\n', '"tag"\nsecond\n', '"tag"  \n']) {
  test(`curl ETag comparison file normalization: ${JSON.stringify(content)}`, async () => {
    const fs = createMemoryFileSystem();
    if (content !== undefined) await fs.writeFile("/tag", new TextEncoder().encode(content));
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => true,
      transport: async request => {
        assert.equal(request.headers.find(([name]) => name.toLowerCase() === "if-none-match")?.[1],
          content?.split("\r").join("").split("\n").join("") || '""');
        return { status: 200, statusText: "OK", headers: [], body: (async function* () {})(), async dispose() {} };
      },
    }));
    try {
      const result = await shell.exec("curl -sS --etag-compare /tag --etag-save /saved https://offline.invalid/resource");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await fs.readFile("/saved")).length, 0);
    } finally { await shell.dispose(); }
  });
}

for (const content of ['"tag"\0injected', "x".repeat(65)]) {
  test("curl refuses unsafe or oversized ETag input before transport", async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/tag", new TextEncoder().encode(content));
    let requests = 0;
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => true, limits: { maxBufferBytes: 64 },
      transport: async () => { requests++; throw new Error("Unexpected transport"); },
    }));
    try {
      const result = await shell.exec("curl -sS --etag-compare /tag https://offline.invalid/");
      assert.notEqual(result.exitCode, 0);
      assert.equal(requests, 0);
    } finally { await shell.dispose(); }
  });
}

test("curl ETag files work through actual HTTP transport", async () => {
  const { server } = await import("./helpers.js");
  const { createHash } = await import("node:crypto");
  const body = "owned representation\n";
  const tag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const service = await server((request, response) => {
    response.setHeader("ETag", tag);
    if (request.headers["if-none-match"] === tag) { response.writeHead(304); response.end(); }
    else response.end(body);
    return true;
  });
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(networkCommands({ authorize: request => request.url.startsWith(`${service.origin}/`) }));
  try {
    const saved = await shell.exec(`curl -sS --etag-save /tag ${service.origin}/resource`);
    assert.equal(saved.exitCode, 0, saved.stderr);
    assert.equal(saved.stdout, body);
    assert.equal(new TextDecoder().decode(await fs.readFile("/tag")), `${tag}\n`);
    const current = await shell.exec(`curl -sS --etag-compare /tag ${service.origin}/resource`);
    assert.equal(current.exitCode, 0, current.stderr);
    assert.equal(current.stdout, "");
    await fs.writeFile("/tag", new TextEncoder().encode('"changed"\n'));
    const changed = await shell.exec(`curl -sS --etag-compare /tag ${service.origin}/resource`);
    assert.equal(changed.exitCode, 0, changed.stderr);
    assert.equal(changed.stdout, body);
  } finally { await shell.dispose(); await service.close(); }
});
