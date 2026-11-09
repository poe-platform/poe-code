import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
import { createNlCommand } from "./index.js";

async function run(args: ShellValue[], input = "A\n") {
  const values = createCommandArguments(args);
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createNlCommand().execute({
    command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr };
}

for (const [name, minimum, value, input, expected] of [
  ["body-numbering", 1, "a", "\nA\n", "     1\t\n     2\tA\n"],
  ["header-numbering", 3, "a", "\\:\\:\\:\nA\n", "\n     1\tA\n"],
  ["footer-numbering", 1, "a", "\\:\nA\n", "\n     1\tA\n"],
  ["starting-line-number", 2, "2", "A\n", "     2\tA\n"],
  ["line-increment", 1, "2", "A\nB\n", "     1\tA\n     3\tB\n"],
  ["join-blank-lines", 1, "2", "\n\n", "       \n     1\t\n"],
  ["number-separator", 8, "|", "A\n", "     1|A\n"],
  ["number-width", 8, "1", "A\n", "1\tA\n"],
  ["number-format", 8, "rz", "A\n", "000001\tA\n"],
  ["section-delimiter", 2, "@", "@:@:\nA\n", "\n     1\tA\n"],
] as const) {
  test(`nl accepts every unique prefix of --${name} with either value spelling`, async () => {
    for (let length = minimum; length <= name.length; length++) {
      const prefix = `--${name.slice(0, length)}`;
      for (const args of [[`${prefix}=${value}`], [prefix, value]]) {
        const result = await run(["-ba", ...args], input);
        assert.equal(result.exitCode, 0, `${args}: ${result.stderr}`);
        assert.equal(result.stdout.toString(), expected, args.join(" "));
        assert.equal(result.stderr, "");
      }
    }
  });
}

test("nl accepts no-renumber prefixes across logical pages", async () => {
  for (let length = 2; length <= "no-renumber".length; length++) {
    const result = await run([`--${"no-renumber".slice(0, length)}`], "A\n\\:\\:\nB\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), "     1\tA\n\n     2\tB\n");
  }
});

for (const args of [["--num", "rz"], ["--num=rz"], ["--n"], ["--s", "2"], ["--h", "a"], ["--he=a"], ["--unknown"], ["--number-formats=rz"], ["--no-ren=yes"], ["--star"], ["--number-f"]]) {
  test(`nl rejects ambiguous, unknown or malformed options: ${args}`, async () => {
    const result = await run(args);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.notEqual(result.stderr, "");
  });
}

test("nl preserves abbreviated separator bytes and option-like values", async () => {
  const separator = Buffer.from([0xff, 0x81, 58]);
  for (const args of [["--number-s", shellValueFromBytes(separator)], [shellValueFromBytes(Buffer.concat([Buffer.from("--number-s="), separator]))]]) {
    const result = await run(args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, Buffer.concat([Buffer.from("     1"), separator, Buffer.from("A\n")]));
  }
  const result = await run(["--number-s", "--star"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "     1--starA\n");
});
