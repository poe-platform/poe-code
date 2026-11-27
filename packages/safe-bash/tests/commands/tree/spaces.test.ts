import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem } from "../../../src/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { run } from "./helpers.js";

for (const env of [{}, { LC_ALL: "C" }, { LC_ALL: "C.UTF-8" }]) {
  test(`tree preserves directory and file spaces with ${JSON.stringify(env)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work", env }).use(agentCommands());
    try {
      const result = await shell.exec("mkdir 'a b'; touch 'a b/c d'; tree --charset=ascii");
      const expected = ".\n`-- a b\n    `-- c d\n\n2 directories, 1 file\n";
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
      const standalone = await run(["--charset=ascii"], {}, { fs, cwd: "/work", env });
      assert.deepEqual(standalone, { exitCode: 0, stdout: expected, stderr: "" });
    } finally {
      await shell.dispose();
    }
  });

  test(`tree preserves spaces in root paths and symlink labels with ${JSON.stringify(env)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/a b");
    await fs.writeFile("/a b/c d", new Uint8Array());
    await fs.symlink!("c d", "/a b/e f");
    const expected = "a b\n|-- a b/c d\n`-- a b/e f -> c d\n\n1 directory, 2 files\n";
    const standalone = await run(["--charset=ascii", "-f", "a b"], {}, { fs, env });
    assert.deepEqual(standalone, { exitCode: 0, stdout: expected, stderr: "" });
    const shell = new Shell({ fs, env }).use(agentCommands());
    try {
      const result = await shell.exec("tree --charset=ascii -f 'a b'");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally {
      await shell.dispose();
    }
  });
}
