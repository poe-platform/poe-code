import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { runMetadata } from "./helpers.js";

for (const [mode, initial, expected] of [
  ["-x", 0o755, 0o644], ["-w", 0o644, 0o444],
  ["-r", 0o755, 0o311], ["-X", 0o755, 0o644],
  ["-s", 0o6755, 0o755], ["-t", 0o1755, 0o755],
  ["-rwx", 0o755, 0], ["-755", 0o777, 0o022],
] as const) {
  test(`chmod ${mode} updates every operand without an option terminator`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const path of ["first", "second"]) {
      await fs.writeFile(`/work/${path}`, new Uint8Array(), { mode: initial });
    }
    const result = await runMetadata("chmod", ["-v", mode, "first", "second"], fs, { umask: 0o022 });
    assert.equal(result.exitCode, 0, result.stderr);
    for (const path of ["first", "second"]) {
      assert.equal((await fs.stat(`/work/${path}`)).mode & 0o7777, expected);
    }
  });
}
