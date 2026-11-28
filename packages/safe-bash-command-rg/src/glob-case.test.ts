import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const files of [false, true]) {
  for (const flagFirst of [false, true]) {
    test(`rg case-insensitive globs: files=${files}, flagFirst=${flagFirst}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/work/d", { recursive: true });
      for (const name of ["A.TXT", "b.txt"]) {
        await fs.writeFile(`/work/d/${name}`, new TextEncoder().encode("x\n"));
      }
      const glob = ["-g", files ? "*.txt" : "*.TXT"];
      const flag = ["--glob-case-insensitive"];
      const values = createCommandArguments([
        files ? "--files" : "x",
        ...(flagFirst ? [...flag, ...glob] : [...glob, ...flag]),
      ]);
      let stdout = "", stderr = "";
      const result = await createRgCommand().execute({
        command: "rg", args: values.args, argumentValues: values, cwd: "/work", env: {}, fs,
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, files ? "d/A.TXT\nd/b.txt\n" : "d/A.TXT:x\nd/b.txt:x\n");
    });
  }
}
