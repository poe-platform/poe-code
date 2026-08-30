import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createStandardCommands } from "../../src/commands/index.js";
import { setup } from "./helpers.js";

const evidence = JSON.parse(readFileSync(new URL("./fatal-reference.json", import.meta.url), "utf8")) as { records: { source: string; stdout: string; stderr: string; exitCode: number; files: Record<string, string> }[] };
for (const { source, ...expected } of evidence.records) {
  test(`pinned GNU 5.3 diagnostic, status and effects: ${source}`, async () => {
    const { shell, fs, commands } = setup();
    for (const command of createStandardCommands()) commands.register(command);
    const result = await shell.exec(source);
    const files = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) => [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, files }, expected);
  });
}
