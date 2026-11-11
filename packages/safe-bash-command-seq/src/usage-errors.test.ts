import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

for (const { args, message } of [
  { args: [], message: "missing operand" },
  { args: ["--"], message: "missing operand" },
  { args: ["1", "2", "3", "4"], message: "extra operand '4'" },
  { args: ["1", "2", "3", "four", "five"], message: "extra operand 'four'" },
  { args: ["3", "0", "4"], message: "invalid Zero increment value: '0'" },
  { args: ["3", "-0.00", "4"], message: "invalid Zero increment value: '-0.00'" },
  { args: ["3", "0x0", "4"], message: "invalid Zero increment value: '0x0'" },
  { args: ["--", "notanumber"], message: "invalid floating point argument: 'notanumber'" },
  { args: ["bad", "3"], message: "invalid floating point argument: 'bad'" },
  { args: ["1", "bad", "3"], message: "invalid floating point argument: 'bad'" },
  { args: ["1", "2", "bad"], message: "invalid floating point argument: 'bad'" },
]) {
  test(`seq operand diagnostic: ${JSON.stringify(args)}`, async () => {
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createSeqCommand().execute({
      command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, "");
    assert.equal(stderr, `seq: ${message}\nTry 'seq --help' for more information.\n`);
  });
}
