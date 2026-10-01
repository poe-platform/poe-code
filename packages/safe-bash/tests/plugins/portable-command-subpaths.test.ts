import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

for (const entry of [
  "du/index", "archive/index", "table-text/index", "stream-inspection/index",
  "stream-format/index", "split/index", "time-env/index", "tree/index",
  "file/index", "column/index", "html-to-markdown/index", "expr/index",
  "apply-patch/index", "metadata/index", "python/index", "python/worker",
  "network/public", "node/browser",
]) {
  test(`standalone commands/${entry} loads without installing Buffer`, async () => {
    const { api, buffer } = await portableRuntime(`
      export * from "./packages/safe-bash/src/commands/${entry}.ts";
      export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    `);
    assert.equal(buffer, undefined);
    if (entry === "du/index") {
      const fs = new api.MemoryFileSystem();
      await fs.writeFile("/a.txt", new TextEncoder().encode("hello\n"));
      let output = "";
      const status = await api.createDuCommands()[0]!.execute({
        command: "du", args: ["--apparent-size", "-b", "/a.txt"], cwd: "/", env: {}, fs,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } },
        signal: new AbortController().signal,
      });
      assert.equal(status.exitCode, 0);
      assert.equal(output, "6\t/a.txt\n");
    }
  });
}
