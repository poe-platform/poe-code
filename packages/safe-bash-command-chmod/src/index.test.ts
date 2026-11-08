import assert from "node:assert/strict";
import test from "node:test";
import { createChmodCommand, createChmodCommands, chmodCommands } from "./index.js";
test("chmod exports its command and plugin", () => {
  assert.equal(createChmodCommand().name, "chmod");
  assert.equal(createChmodCommands().length, 1);
  assert.equal(chmodCommands().name, "chmod-commands");
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { evalSyncChmod } from "./command.js";

async function run(args: string[], fs = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createChmodCommand({ umask: 0 }).execute({
    command: "chmod", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

test("chmod accepts root controls with minus modes and reference operands", async () => {
  for (const option of ["--preserve-root", "--no-preserve-root"]) {
    for (const [mode, expected] of [["-r", 0o333], ["-w", 0o555], ["-x", 0o666], ["-rx", 0o222], ["-002", 0o775]] as const) {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/file", new Uint8Array(), { mode: 0o777 });
      assert.deepEqual(await run([option, mode, "/file"], fs), { exitCode: 0, stdout: "", stderr: "" });
      assert.equal((await fs.stat("/file")).mode & 0o777, expected);
      let syncMode = 0o777;
      assert.equal(evalSyncChmod([option, mode, "/file"], 0, (_path, change) => {
        syncMode = change({ type: "file", mode: syncMode });
        return true;
      }), "");
      assert.equal(syncMode, expected);
    }
    const fs = createMemoryFileSystem();
    await fs.writeFile("/--no-preserve-root", new Uint8Array(), { mode: 0o640 });
    await fs.writeFile("/file", new Uint8Array(), { mode: 0o777 });
    assert.equal((await run([option, "--reference", "--no-preserve-root", "/file"], fs)).exitCode, 0);
    assert.equal((await fs.stat("/file")).mode & 0o777, 0o640);
  }
});

test("chmod root controls obey the last option and canonical root aliases", async () => {
  for (const target of ["/", "/root-link"]) {
    for (const controls of [[], ["--preserve-root"], ["--no-preserve-root", "--preserve-root"], ["--no-preserve-root"], ["--preserve-root", "--no-preserve-root"]]) {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/tree");
      await fs.writeFile("/tree/file", Uint8Array.of(7), { mode: 0o640 });
      await fs.symlink!("/", "/root-link");
      const allowed = controls.at(-1) === "--no-preserve-root";
      const result = await run(["-R", ...controls, "755", target], fs);
      assert.equal(result.exitCode, allowed ? 0 : 1, result.stderr);
      assert.equal((await fs.stat("/tree/file")).mode & 0o777, allowed ? 0o755 : 0o640);
      assert.deepEqual(await fs.readFile("/tree/file"), Uint8Array.of(7));
    }
  }
});
