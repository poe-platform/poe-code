import assert from "node:assert/strict";
import test from "node:test";
import { executionCommands } from "../../../src/commands/execution.js";
import { createCommandArguments, getCommandArguments, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { shellValueFromBytes, type ShellValue } from "../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { agentCommands } from "../../../src/plugins/index.js";

for (const form of ["separate", "attached", "cluster", "long", "long-equals", "last"]) {
  for (const template of [[128], [239, 191, 189], [255]]) {
    test(`GNU raw replacement pattern ${form}, template=${template.join(",")}`, async () => {
      const pattern = shellValueFromBytes(Uint8Array.of(128));
      const option: ShellValue[] = form === "separate" ? ["-I", pattern]
        : form === "attached" ? [shellValueFromBytes(Uint8Array.of(45, 73, 128))]
        : form === "cluster" ? [shellValueFromBytes(Uint8Array.of(45, 114, 73, 128))]
        : form === "long" ? ["--replace", pattern]
        : form === "long-equals" ? [shellValueFromBytes(Uint8Array.from([...Buffer.from("--replace="), 128]))]
        : ["-I", "unused", "-I", pattern];
      const incoming = createCommandArguments(["-0", ...option, "capture", shellValueFromBytes(Uint8Array.from(template))]);
      const captured: number[][] = [];
      const errors: Uint8Array[] = [];
      const context: CommandContext = { command: "xargs", args: incoming.args, argumentValues: incoming, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: toByteSource(Uint8Array.of(255, 0)), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } };
      const result = await executionCommands(child => {
        captured.push(Array.from(getCommandArguments(child).bytes(0)!));
        return { exitCode: 0 };
      }).find(command => command.name === "xargs")!.execute(context);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(captured, [template[0] === 128 ? [255] : template]);
      assert.equal(Buffer.concat(errors).length, 0);
    });
  }
}

test("raw verbose trace distinguishes octal-looking ASCII and can replay its argv", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec("xargs -0 -t printf '%s\\0'", { stdin: Uint8Array.of(128, 0, 92, 50, 48, 48, 0) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "80005c32303000");
    const replay = await shell.exec(result.stderr);
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.deepEqual(replay.stdoutBytes, result.stdoutBytes);
  } finally { await shell.dispose(); }
});
