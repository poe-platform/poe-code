import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPrCommand } from "./index.js";

for (const { args, input, expected } of [
  ...[["-D", "%Y"], ["-D%Y"]].map(dateArgs => ({
    args: ["-l", "12", "-h", "TITLE", ...dateArgs],
    input: "a\nb\n",
    expected: "\n\n2000                            TITLE                             Page 1\n\n\na\nb\n\n\n\n\n\n",
  })),
  ...[["--date-format=X"], ["--date-format", "X"]].map(dateArgs => ({
    args: ["-l", "12", ...dateArgs, "-h", "T"],
    input: "a\n",
    expected: "\n\nX                                T                                Page 1\n\n\na\n\n\n\n\n\n\n",
  })),
]) {
  test(`pr formats page headers with ${args.join(" ")}`, async () => {
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createPrCommand({ clock: () => 946684800000 }).execute({
      command: "pr", args: values.args, argumentValues: values, cwd: "/work",
      env: { LC_ALL: "C.UTF-8", TZ: "UTC" }, fs: createMemoryFileSystem(),
      stdin: toByteSource(input), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(stdout, expected);
  });
}

test("pr -D requires a format argument", async () => {
  const values = createCommandArguments(["-D"]);
  let stdout = "", stderr = "";
  const result = await createPrCommand().execute({
    command: "pr", args: values.args, argumentValues: values, cwd: "/work", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource("a\n"),
    signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "pr: option requires an argument -- 'D'\nTry 'pr --help' for more information.\n");
});
