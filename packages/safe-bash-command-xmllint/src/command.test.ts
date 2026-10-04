import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand, xmllintCommands } from "./index.js";
for (const [args, input, expected] of [
  [["--xpath", '//item[@id=1]/text()'], '<root><item id="01">alpha</item><item id="2">beta</item></root>', "alpha\n"],
  [["--xpath", '//item[price=10.5]/name/text()'], '<root><item><price>10.50</price><name>alpha</name></item><item><price>11</price><name>beta</name></item></root>', "alpha\n"],
  [["--xpath", '//item[@id="1"]/text()'], '<root><item id="01">alpha</item><item id="1">beta</item></root>', "beta\n"],
  [["--xpath", '//item[@id=1 or @id="2"]/text()'], '<root><item id="1">Alpha</item><item id="2">Beta</item></root>', "Alpha\nBeta\n"],
  [["--xpath", 'boolean(//item[@price>15])'], '<root><item price="20"/></root>', "true\n"],
  [["--c14n"], '<root z="2" a="1"><item/></root>', '<root a="1" z="2"><item></item></root>']
] as const) {
  test(`zero-argument xmllint factory executes ${args[0]}`, async () => {
    let output = "", errors = "";
    const carrier = createCommandArguments(args);
    const context = {
      args: carrier.args, arguments: carrier, command: "xmllint", cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal, stdin: toByteSource(input),
      stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors += new TextDecoder().decode(bytes); } },
    } as unknown as CommandContext;
    assert.equal((await createXmllintCommand().execute(context)).exitCode, 0, errors);
    assert.equal(output, expected);
  });
}

test("xmllint plugin captures the replacement policy at creation", () => {
  const options = { replace: false };
  const plugin = xmllintCommands(options);
  const commands = new CommandRegistry();
  commands.register(createXmllintCommand());
  options.replace = true;
  assert.throws(() => plugin.setup({ commands, use() {}, registerFileSystem() {} }),
    (error: unknown) => error instanceof Error && error.message.includes("Command already registered"));
});

test("retaining sinks preserve xmllint output across batch reuse", async () => {
  const values = Array.from({ length: 2500 }, (_, i) => `value-${i}`);
  const chunks: Uint8Array[] = [];
  const context = {
    args: ["--xpath", "//item/text()"], command: "xmllint", cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource("<root>" + values.map(value => `<item>${value}</item>`).join("") + "</root>"),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  } as unknown as CommandContext;
  assert.equal((await createXmllintCommand().execute(context)).exitCode, 0);
  assert.equal(chunks.map(bytes => new TextDecoder().decode(bytes)).join(""), values.join("\n") + "\n");
});
