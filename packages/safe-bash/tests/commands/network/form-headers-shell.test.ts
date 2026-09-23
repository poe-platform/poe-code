import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Shell } from "../../../src/shell/shell.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { fixture, server } from "./helpers.js";

test("Shell attached and long inline part headers agree with native curl", async () => {
  const host = await server();
  try {
    const fs = await fixture();
    const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({
      authorize: request => new URL(request.url).origin === host.origin,
    }));
    for (const option of ["-F", "--form"]) {
      const field = 'changed=inline;type=text/plain;charset=UTF-8;headers="X-Owned: changed";headers="X-Other: second"';
      const actual = await shell.exec(`curl -s ${option === "-F" ? "-F" : "--form "}'${field}' '${host.origin}'`);
      assert.equal(actual.exitCode, 0, actual.stderr);
      const virtual = host.requests.at(-1)!.body;
      await promisify(execFile)("/usr/bin/curl", ["-q", "-sS", "--noproxy", "*", option, field, host.origin]);
      const native = host.requests.at(-1)!.body;
      const part = (body: Buffer) => body.subarray(body.indexOf("\r\n") + 2, body.lastIndexOf("\r\n--"));
      assert.deepEqual(part(virtual), part(native));
    }
    await fs.writeFile("/work/input", Buffer.from([249, 0, 248]));
    await fs.writeFile("/work/headers", Buffer.from("X-Owned: file\nX-Other: second\n"));
    for (const option of ["-F", "--form"]) {
      const actual = await shell.exec(`curl -s ${option === "-F" ? "-F" : "--form "}'changed=@input;headers=@headers' '${host.origin}'`);
      assert.equal(actual.exitCode, 0, actual.stderr);
      const body = host.requests.at(-1)!.body;
      assert.ok(body.includes("X-Owned: file\r\nX-Other: second\r\n\r\n"));
      assert.ok(body.includes(Buffer.from([249, 0, 248])));
      assert.equal(host.requests.at(-1)!.headers["x-owned"], undefined);
    }
  } finally { await host.close(); }
});
