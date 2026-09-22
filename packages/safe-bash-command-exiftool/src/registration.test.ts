import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandRegistry } from "safe-bash-contracts/command";
import type { PluginHost } from "safe-bash-contracts/plugin";
import { exiftoolCommands, type ExiftoolCommandOptions } from "./command.js";

for (const replace of [undefined, false, true]) {
  test(`exiftool registration requires explicit replacement: ${replace}`, async () => {
    const commands = new CommandRegistry([
      { name: "exiftool", execute: () => ({ exitCode: 23 }) },
      { name: "unrelated", execute: () => ({ exitCode: 17 }) },
    ]);
    const before = commands.list();
    const host: PluginHost = { commands,
      use() { throw new Error("Unexpected middleware installation"); },
      registerFileSystem() { throw new Error("Unexpected filesystem installation"); },
    };
    const options: ExiftoolCommandOptions = replace === undefined ? {} : { replace };
    if (replace) {
      await exiftoolCommands(options).setup(host);
      assert.notEqual(commands.get("exiftool"), before[0]);
      assert.equal(commands.get("unrelated"), before[1]);
      assert.deepEqual(commands.list().map(command => command.name), ["exiftool", "unrelated"]);
    } else {
      assert.throws(() => exiftoolCommands(options).setup(host), { message: "Command already registered: exiftool" });
      assert.deepEqual(commands.list(), before);
    }
  });
}
