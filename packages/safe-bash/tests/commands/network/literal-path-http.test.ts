import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { run, server } from "./helpers.js";

test('Node curl request targets match native curl with globbing disabled', async () => {
  const host = await server();
  try {
    for (const path of ['/changed/{left,right}', '/changed/left\\right', '/changed/%2E%2E/end', '/changed/%2e/end', '/changed/%2E./end', '/changed/"left"', '/changed/<left>', '/changed/`left`', '/changed/%7Bleft%7D', '/changed/%5C/end', '/changed/%20/end', '/changed/./end', '/changed/../end']) {
      const url = host.origin + path;
      const native = await promisify(execFile)('/usr/bin/curl', ['-q', '-sS', '-g', '--noproxy', '*', url]);
      const result = await run(['-sS', '-g', url]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(result.stdout, Buffer.from(native.stdout), path);
    }
  } finally { await host.close(); }
});
