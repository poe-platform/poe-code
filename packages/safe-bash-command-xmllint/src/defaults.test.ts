import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createXmllintCommand, createXmllintCommands, xmllintCommand, xmllintCommands } from "./index.js";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";

for (const [entrypoint, create] of [
  ["xmllintCommand", () => xmllintCommand],
  ["createXmllintCommand()", () => createXmllintCommand()],
  ["createXmllintCommand({})", () => createXmllintCommand({})],
  ["createXmllintCommands()", () => createXmllintCommands()[0]],
  ["xmllintCommands()", async () => {
    const commands = new CommandRegistry();
    await xmllintCommands().setup({ commands, use() {}, registerFileSystem() {} });
    return commands.get("xmllint");
  }],
] as const) {
  test(`${entrypoint} reads relative virtual files and reports invalid XML without a runtime`, async () => {
    const command = await create();
    assert.ok(command);
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/input.xml", new TextEncoder().encode("<root><item>hello</item></root>"));
    let stdout = "", stderr = "";
    const context: CommandContext = {
      command: "xmllint", ...createCommandArguments(["--xpath", "string(/root/item)", "input.xml"]),
      cwd: "/work", env: {}, fs, signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    };
    assert.equal((await command.execute(context)).exitCode, 0, stderr);
    assert.equal(stdout, "hello\n");
    assert.equal(stderr, "");

    await fs.writeFile("/work/input.xml", new TextEncoder().encode("<root>"));
    stdout = "";
    assert.equal((await command.execute(context)).exitCode, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.startsWith("xmllint: "), stderr);
  });
}

test("portable runtime cancels a pending VFS read", { timeout: 200 }, async () => {
  const controller = new AbortController();
  const failure = new Error("cancelled read");
  const context: CommandContext = {
    command: "xmllint", ...createCommandArguments(["--noout", "/input.xml"]), cwd: "/", env: {},
    signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    fs: { capabilities: { retainedRead: true }, async openReadFile() { return {
      async read() { controller.abort(failure); return new Promise<Uint8Array>(() => {}); },
      async close() {}
    }; } } as unknown as CommandContext["fs"]
  };
  await assert.rejects(Promise.resolve(createXmllintCommand().execute(context)), failure);
});
