import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createReadlinkCommand } from "./index.js";

async function run(args: string[], fs = createMemoryFileSystem(), env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createReadlinkCommand().execute({
    command: "readlink", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

// GNU coreutils 9.10 forces operand diagnostics when POSIXLY_CORRECT is set,
// even if -q or -s was explicitly supplied. Outside POSIX mode, the last flag wins.
for (const posix of [undefined, "1", ""]) {
  test(`readlink operand diagnostics with POSIXLY_CORRECT=${JSON.stringify(posix)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array());
    await fs.symlink!("loop", "/loop");
    const env = posix === undefined ? {} : { POSIXLY_CORRECT: posix };
    const options = [
      { flags: [], verbose: false },
      { flags: ["-v"], verbose: true },
      { flags: ["-q"], verbose: false },
      { flags: ["-s"], verbose: false },
      { flags: ["-v", "-q"], verbose: false },
      { flags: ["-q", "-v"], verbose: true },
      { flags: ["-v", "-s"], verbose: false },
      { flags: ["-s", "-v"], verbose: true },
      { flags: ["-vq"], verbose: false },
      { flags: ["-qv"], verbose: true },
      { flags: ["-vs"], verbose: false },
      { flags: ["-sv"], verbose: true },
      { flags: ["--verbose", "--quiet"], verbose: false },
      { flags: ["--silent", "--verbose"], verbose: true },
      { flags: ["--verbose", "--silent"], verbose: false },
      { flags: ["--quiet", "--verbose"], verbose: true },
    ];
    for (const { flags, verbose } of options) {
      for (const operand of [["missing"], ["file"], ["file/"], ["-e", "loop"], ["-f", "loop"]]) {
        const args = [...flags, ...operand];
        const result = await run(args, fs, env);
        const label = JSON.stringify(args);
        assert.equal(result.exitCode, 1, label);
        assert.equal(result.stdout, "", label);
        if (posix !== undefined || verbose) {
          assert.ok(result.stderr.startsWith("readlink: "), label);
          assert.ok(result.stderr.includes(operand.at(-1)!), label);
        } else {
          assert.equal(result.stderr, "", label);
        }
      }
    }
  });
}

test("readlink continues after failed operands and preserves successful output", async () => {
  const fs = createMemoryFileSystem();
  await fs.symlink!("target", "/link");
  for (const env of [{}, { POSIXLY_CORRECT: "1" }]) {
    const result = await run(["missing", "link"], fs, env);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "target\n");
    assert.equal(result.stderr.length > 0, env.POSIXLY_CORRECT !== undefined);
  }
});
