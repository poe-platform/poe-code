import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createGzipCommand } from "./index.js";

for (const args of [["-c"], ["-qc"], ["-k", "/input"], ["-qc", "/input", "-"]]) {
  test(`gzip enforces cumulative host input limits: ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("bounded input"));
    const failure = new Error("host input exceeded");
    await assert.rejects(async () => createGzipCommand().execute({
      command: "gzip", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: toByteSource("bounded input"), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write() {} },
      inputBudget: { maxBytes: 8, check(total) { if (total > 8) throw failure; } },
    }), error => error === failure);
    assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "bounded input");
  });
}
