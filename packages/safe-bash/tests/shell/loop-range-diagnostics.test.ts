import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { mapfileExtension } from "../../src/shell/extensions/mapfile/index.js";
import { setup } from "./helpers.js";

for (const command of ["break", "continue"]) {
  for (const extension of [false, true]) {
    for (const count of ["0", "-1", "1"]) {
      test(`${command} ${count} preserves loop output and reports its range, mapfile=${extension}`, async context => {
        const { shell, commands } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        for (const builtin of basicCommands()) commands.register(builtin);
        context.after(() => shell.dispose());
        const result = await shell.exec(`for x in A B; do printf '%s;' "$x"; ${command} ${count}; printf 'tail:%s;' "$?"; done; printf 'done:%s;' "$?"`);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], count === "1"
          ? [0, command === "break" ? "A;done:0;" : "A;B;done:0;", ""]
          : [0, "A;done:1;", `shell: line 1: ${command}: ${count}: loop count out of range\n`]);
      });
    }
  }
  for (const prefix of ["", "builtin ", "command "]) {
    test(`${prefix}${command} retains the count spelling and source location`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`bash -c 'for x in A B; do
  ${prefix}${command} -- -01
  say unreachable
done' named-shell`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [
        1, "", `named-shell: line 2: ${command}: -01: loop count out of range\n`,
      ]);
    });
  }
}
