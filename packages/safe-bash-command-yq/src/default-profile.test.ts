import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { CommandRegistry, createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand, createYqCommands, yqCommands } from "./index.js";

for (const factory of [() => createYqCommand(), () => createYqCommands()[0]!, () => {
  const commands = new CommandRegistry();
  yqCommands().setup({ commands, use() { assert.fail("unexpected middleware"); }, registerFileSystem() { assert.fail("unexpected filesystem"); } });
  return commands.get("yq")!;
}]) {
  test(`default yq factory supports native flags: ${factory.toString()}`, async () => {
    const fs = createMemoryFileSystem();
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    await fs.writeFile("/data.yaml", encoder.encode("a: 1\nb: hello\n"));
    for (const [args, input, expected, status] of [
      [["-i", ".a = 2", "/data.yaml"], "", "", 0],
      [[".a", "/data.yaml"], "", "2\n", 0],
      [["-n", ".a = 1"], "", "a: 1\n", 0],
      [["-p=yaml", "-o=json", "."], "a: 1\n", '{\n  "a": 1\n}\n', 0],
      [["-pyaml", "-ojson", "."], "a: 1\n", '{\n  "a": 1\n}\n', 0],
      [["-p=toml", "-o=json", "."], "a = 1\n", '{\n  "a": 1\n}\n', 0],
      [["-ptoml", "-ojson", "."], "a = 1\n", '{\n  "a": 1\n}\n', 0],
      [["-p=yaml", "-o=yaml", "."], "a: 1\n", "a: 1\n", 0],
      [["-pyaml", "-oyaml", "."], "a: 1\n", "a: 1\n", 0],
      [["-e", ".missing", "/data.yaml"], "", "null\n", 1],
      [["ea", ".a"], "a: 1\n---\na: 2\n", "1\n---\n2\n", 0],
      [["-P", "-I", "4", "."], '{"a":{"b":1}}', "a:\n    b: 1\n", 0],
    ] as const) {
      const stdout: string[] = [], stderr: string[] = [];
      const carrier = createCommandArguments([...args]);
      const result = await factory().execute({ command: "yq", args: carrier.args, argumentValues: carrier,
        cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: toByteSource(encoder.encode(input)),
        stdout: { async write(bytes) { stdout.push(decoder.decode(bytes)); } },
        stderr: { async write(bytes) { stderr.push(decoder.decode(bytes)); } },
      });
      assert.equal(result.exitCode, status, stderr.join(""));
      assert.equal(stdout.join(""), expected);
      if (status === 0) assert.equal(stderr.join(""), "");
    }
  });
}
