import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createNlCommand } from "./index.js";

for (const byte of [0xff, 0x80, 0x21]) {
  const raw = Uint8Array.of(byte);
  const pair = Uint8Array.of(byte, 0x3b);
  const long = Uint8Array.of(byte, 0x3b, 0x3f);
  for (const option of ["-d ", "-d", "--section-delimiter ", "--section-delimiter="]) {
    for (const [scenario, values, delimiter] of [
      ["single", [raw], Uint8Array.of(byte, 0x3a)],
      ["pair", [pair], pair],
      ["long", [long], long],
      ["repeat", [Uint8Array.of(0x3f, 0x3b), raw], pair],
      ["disabled", [raw, new Uint8Array()], pair],
    ] as const) {
      test(`nl preserves delimiter bytes: ${byte}, ${option}, ${scenario}`, async () => {
        const args = values.flatMap(value => option.endsWith(" ") || (option === "-d" && value.length === 0)
          ? [option.trimEnd(), shellValueFromBytes(value)]
          : [shellValueFromBytes(Buffer.concat([Buffer.from(option), value]))]);
        const argumentValues = createCommandArguments(args);
        const stdin = Buffer.concat([Buffer.from("a\n"), delimiter, Buffer.from("\nb\n")]);
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createNlCommand().execute({
          command: "nl", args: argumentValues.args, argumentValues, cwd: "/", env: { LC_ALL: "C" },
          fs: createMemoryFileSystem(), stdin: toByteSource(stdin),
          stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          signal: new AbortController().signal,
        });
        assert.equal(result.exitCode, 0);
        assert.equal(stderr, "");
        const expected = scenario === "disabled"
          ? Buffer.concat([Buffer.from("     1\ta\n     2\t"), delimiter, Buffer.from("\n     3\tb\n")])
          : Buffer.from("     1\ta\n\n       b\n");
        assert.deepEqual(Buffer.concat(stdout), expected);
      });
    }
  }
}
