import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandRegistry } from "safe-bash-contracts/command";
import type { PluginHost } from "safe-bash-contracts/plugin";
import { wkhtmltopdfCommands, wkhtmltopdfLimits, type WkhtmltopdfCommandOptions } from "./command.js";

for (const replace of [undefined, false, true]) {
  test(`wkhtmltopdf registration requires explicit replacement: ${replace}`, async () => {
    const commands = new CommandRegistry([
      { name: "wkhtmltopdf", execute: () => ({ exitCode: 23 }) },
      { name: "unrelated", execute: () => ({ exitCode: 17 }) },
    ]);
    const before = commands.list();
    const host: PluginHost = { commands,
      use() { throw new Error("Unexpected middleware installation"); },
      registerFileSystem() { throw new Error("Unexpected filesystem installation"); },
    };
    const options: WkhtmltopdfCommandOptions = { ...{ limits: wkhtmltopdfLimits }, ...(replace === undefined ? {} : { replace }) };
    if (replace) {
      await wkhtmltopdfCommands(options).setup(host);
      assert.notEqual(commands.get("wkhtmltopdf"), before[0]);
      assert.equal(commands.get("unrelated"), before[1]);
      assert.deepEqual(commands.list().map(command => command.name), ["wkhtmltopdf", "unrelated"]);
    } else {
      assert.throws(() => wkhtmltopdfCommands(options).setup(host), { message: "Command already registered: wkhtmltopdf" });
      assert.deepEqual(commands.list(), before);
    }
  });
}
