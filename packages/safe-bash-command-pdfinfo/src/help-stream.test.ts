import assert from "node:assert/strict";
import { it } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createPdfinfoCommand, createPdffontsCommand, createPdfdetachCommand, createPdfseparateCommand, createPdfuniteCommand } from "./index.js";

for (const create of [createPdfinfoCommand, createPdffontsCommand, createPdfdetachCommand, createPdfseparateCommand, createPdfuniteCommand]) {
  const flags = ["-h", "-help", "--help", "-?", "-v", "--version", ...(create === createPdfinfoCommand ? ["-listenc"] : [])];
  for (const args of flags.flatMap(flag => [[flag], [flag, "-"], [flag, "in.pdf"]])) {
    it(`${create().name} ${args.join(" ")} does not acquire input`, async () => {
      let reads = 0;
      const context = {
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: { [Symbol.asyncIterator]() { reads++; throw new Error("unexpected stdin"); } },
        fs: { async readFile() { reads++; throw new Error("unexpected file read"); } },
        stdout: { async write() {} }, stderr: { async write() {} }
      } as unknown as CommandContext;
      assert.equal((await create().execute(context)).exitCode, 0);
      assert.equal(reads, 0);
    });
  }
}
