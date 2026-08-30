import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createStandardCommands } from "../../src/commands/index.js";
import { setup } from "./helpers.js";

test("GNU 5.3 executes a complete earlier newline unit before nested syntax failure", async () => {
  const { shell, fs } = setup();
  const source = ': >before;\nvalue=$(true |); : >after';
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 127);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: -c: line 2: syntax error near unexpected token `)'\nshell: -c: line 2: `value=$(true |); : >after'\n");
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["before"]);
});

const evidence = JSON.parse(readFileSync(new URL("./unit-reference.json", import.meta.url), "utf8")) as { records: { source: string; stdin: string; stdout: string; stderr: string; exitCode: number; files: Record<string, string> }[] };
for (const { source, stdin, ...expected } of evidence.records) {
  test(`frozen GNU 5.3 complete-input-unit boundary: ${source}`, async () => {
    const { shell, fs, commands } = setup();
    for (const command of createStandardCommands()) commands.register(command);
    const result = await shell.exec(source, { stdin });
    const files = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) => [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, files }, expected);
  });
}
