import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createYqCommand } from "./query.js";

for (const [args, input, expected] of [
  [["-p=yaml", "-o=json", "."], "name: Alpha\n", '{\n  "name": "Alpha"\n}\n'],
  [["-p=toml", "-o=json", "."], 'name = "Alpha"\n', '{\n  "name": "Alpha"\n}\n'],
  [["-p=yaml", "-o=yaml", ".name"], "name: Alpha\n", '"Alpha"\n']
] as const) {
  test(`restricted yq attached short formats ${args.join(" ")}`, async () => {
    let output = "", errors = "";
    const context = {
      ...createCommandArguments(args), command: "yq", cwd: "/", env: {},
      signal: new AbortController().signal, stdin: toByteSource(input),
      stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors += new TextDecoder().decode(bytes); } },
    } as unknown as CommandContext;
    assert.equal((await createYqCommand().execute(context)).exitCode, 0, errors);
    assert.equal(output, expected);
  });
}
