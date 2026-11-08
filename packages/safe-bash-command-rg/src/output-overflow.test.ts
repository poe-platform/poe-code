import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const mode of ["--files", "-l", "--files-without-match", "-L", "-c"]) {
  test(`rg ${mode} emits overflowing speculative output exactly once on repeated calls`, async () => {
    const fs = createMemoryFileSystem();
    const names: string[] = [];
    for (let d = 0; d < 30; d++) {
      const dir = `/subdir_${String(d).padStart(2, "0")}_extra_directory_padding`;
      await fs.mkdir(dir);
      for (let f = 0; f < 30; f++) {
        const name = `${dir}/very_long_filename_prefix_${String(f).padStart(4, "0")}_padding_name_more_chars.txt`;
        names.push(name);
        await fs.writeFile(name, new TextEncoder().encode("needle\n"));
      }
    }
    const expected = names.map(name => `${name}${mode === "-c" ? ":1" : ""}\n`).join("");
    assert.ok(Buffer.byteLength(expected) > 65536);
    const command = createRgCommand();
    for (let invocation = 0; invocation < 3; invocation++) {
      let stdout = "", stderr = "";
      const append = (bytes: Uint8Array) => { stdout += new TextDecoder().decode(bytes); };
      const result = await command.execute({
        command: "rg", args: mode === "--files" ? [mode, "/"] : [mode, ...(mode === "-L" ? ["-l"] : []), mode === "--files-without-match" ? "absent" : "needle", "/"],
        cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
        ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true, _chargeFastFsOp() {} },
        stdout: {
          ...{ _scratch4k: new Uint8Array(4096),
            writeRangeSync(bytes: Uint8Array, length: number) { append(bytes.subarray(0, length)); return true; },
            writeSync(bytes: Uint8Array) { append(bytes); return true; } },
          async write(bytes) { append(bytes); },
        },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, expected, `invocation ${invocation}`);
    }
  });
}
