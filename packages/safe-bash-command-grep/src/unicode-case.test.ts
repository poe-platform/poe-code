import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createGrepCommands } from "./grep.js";

for (const [args, input, expected] of [
  [["-i", "é"], "É\né\nÀ\n", "É\né\n"],
  [["-ci", "école"], "ÉCOLE\n", "1\n"],
  [["-io", "ÜNÏCODE"], "Ünïcode\n", "Ünïcode\n"],
  [["-ai", "[é]"], "É\né\nÀ\n", "É\né\n"],
  [["-ai", "^[^é]$"], "É\né\nÀ\n", "À\n"],
  [["-ai", "[À-Ö]"], "à\né\nö\nø\n", "à\né\nö\n"],
  [["-ai", "[à-ö]"], "À\nÉ\nÖ\nØ\n", "À\nÉ\nÖ\n"],
  [["-ai", "[Z-a]"], "z\nA\n_\né\n", "z\nA\n_\n"],
  [["-ai", "[Ā-Ă]"], "ā\nă\n", "ā\nă\n"],
  [["-ai", "[à-ā]"], "Ā\nĂ\n", "Ā\n"],
  [["-io", "σ"], "Σ σ ς\n", "Σ\nσ\nς\n"],
  [["-ibo", "K"], "KKk\n", "0:K\n3:K\n4:k\n"],
  [["-io", "𐐨"], "𐐀𐐨\n", "𐐀\n𐐨\n"],
  [["-ai", "i"], "İ\nı\ni\nI\n", "i\nI\n"],
  [["-ai", "s"], "ß\ns\n", "s\n"],
  [["-ai", "ss"], "ß\nss\n", "ss\n"],
  [["-Ei", "école"], "ÉCOLE\n", "ÉCOLE\n"],
  [["é"], "É\né\nÀ\n", "é\n"],
  [["-i", "é"], "À\n", ""],
] as const) {
  test(`grep Unicode case matching: ${args.join(" ")} on ${JSON.stringify(input)}`, async t => {
    const executor = new RegexExecutor(createBoundedRegexProvider());
    t.after(() => executor.dispose());
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createGrepCommands(executor, { ergonomicRegex: true })[0]!.execute({
      command: "grep", args: values.args, argumentValues: values, cwd: "/work", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, {
      exitCode: expected ? 0 : 1, stdout: expected, stderr: "",
    });
  });
}
