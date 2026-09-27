import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const body of ["if true; then echo sub_arg; fi", "echo first; echo sub_arg"]) {
  for (const portable of [false, true]) {
    test(`previously defined function substitution restores parent last argument: ${body}, portable=${portable}`, async context => {
      const { shell, commands } = setup();
      context.after(() => shell.dispose());
      for (const command of basicCommands()) commands.register(command);
      const source = `f(){ ${body}; }; : parent_arg; echo "$(f)" "$_"; echo "$_"`;
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source]);
      const original = globalThis.Buffer;
      let result;
      try {
        if (portable) Reflect.deleteProperty(globalThis, "Buffer");
        result = await shell.exec(source);
      } finally {
        globalThis.Buffer = original;
      }
      assert.equal(result.stdout, native.stdout.toString());
      assert.equal(result.exitCode, native.status, result.stderr);
    });
  }
}
