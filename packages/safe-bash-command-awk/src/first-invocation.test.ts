import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const largeInput = "alpha:beta:gamma:delta\n".repeat(1000);

for (const [name, input, program, expected, redirected] of [
  ["buffered printf", largeInput, '{ printf "%s\\n", $0 }', largeInput, undefined],
  ["buffered print", largeInput, '{ print $0 }', largeInput, undefined],
  ["async BEGIN", "a:b\nc:d\n", 'BEGIN { print "HDR" } { print $1 }', "HDR\na\nc\n", undefined],
  ["append redirect", "a:b\nc:d\n", '{ print $1 >> "/out" }', "", "seed\na\nc\n"],
  ["overwrite redirect", "a:b\nc:d\n", '{ print $1 > "/out" }', "", "a\nc\n"],
] as const) {
  test(`first memory awk invocation executes ${name} exactly once`, async () => {
    // A fresh module instance makes each case the first invocation even if a
    // module-scoped JIT warmup is accidentally reintroduced.
    const { awkCommand } = await import(new URL(`./awk.ts?first=${encodeURIComponent(name)}`, import.meta.url).href);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/data", encoder.encode(input));
    await fs.writeFile("/out", encoder.encode("seed\n"));
    const args = ["-F:", program, "/data"];
    let stdout = "", stderr = "";
    const context: CommandContext = {
      command: "awk", args, argumentValues: createCommandArguments(args),
      cwd: "/", env: {}, fs, stdin: toByteSource(""),
      signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += decoder.decode(bytes); } },
      stderr: { async write(bytes) { stderr += decoder.decode(bytes); } },
    };
    Object.assign(context, { _fastMemoryBackingFs: fs });
    const result = await awkCommand().execute(context);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
    assert.equal(decoder.decode(await fs.readFile("/out")), redirected ?? "seed\n");
  });
}
