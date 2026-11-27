import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { FsError, toByteSource } from "safe-bash-contracts";
import { command, settings as format } from "./stream-format/shared.js";
import { settings as inspection } from "./stream-inspection/shared.js";
test("stream families reject invalid byte ceilings", () => { assert.throws(() => format({ limits: { maxInputBytes: -1 } }), RangeError); assert.throws(() => inspection({ limits: { maxInputBytes: -1 } }), RangeError); });

for (const code of ["EPIPE", "EIO"] as const) {
  test(`stream-format output reports SIGPIPE status without diagnosing broken pipes: ${code}`, async () => {
    const error = new FsError(code);
    let stderr = "";
    const execution = command("seq", format({}), session => session.text("1\n")).execute({
      command: "seq", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write() { throw error; } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    if (code === "EPIPE") {
      assert.equal((await execution).exitCode, 141);
      assert.equal(stderr, "");
    } else {
      assert.equal((await execution).exitCode, 1);
      assert.equal(stderr, `seq: ${error.message}\n`);
    }
  });
}
