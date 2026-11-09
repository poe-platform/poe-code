import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { Shell } from "../../../../src/shell/shell.js";

for (const extension of [false, true]) {
  for (const command of ["mapfile", "readarray"]) {
    for (const readonly of [false, true]) {
      test(`${command} ${extension ? "extension" : "builtin"} follows chained ${readonly ? "readonly" : "writable"} namerefs`, async context => {
        const shell = new Shell({
          fs: createMemoryFileSystem(),
          extensions: [arraysExtension(), ...(extension ? [mapfileExtension()] : [])],
        });
        context.after(() => shell.dispose());
        for (const definition of basicCommands()) shell.register(definition);
        const result = await shell.exec(`
target=(old tail)
declare -n ref=target
declare -n alias=ref
${readonly ? "readonly target" : ":"}
${command} -t alias
status=$?
read -r rest
printf 'status=%s target=<%s> rest=<%s>\n' "$status" "\${target[*]}" "$rest"
declare -p ref alias
`, { stdin: "new\n" });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, `status=${readonly ? "1 target=<old tail> rest=<new>" : "0 target=<new> rest=<>"}\ndeclare -n ref="target"\ndeclare -n alias="ref"\n`);
        if (readonly) assert.ok(result.stderr.includes("readonly variable"), result.stderr);
        else assert.equal(result.stderr, "");
      });
    }
  }
}
