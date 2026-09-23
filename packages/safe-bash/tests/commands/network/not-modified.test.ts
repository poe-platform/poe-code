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
