import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";

for (const extensions of [[], [arraysExtension()]]) {
  for (const declaration of ["local", "declare", "typeset"]) {
    for (const allexport of [false, true]) {
      for (const [body, call, expected] of [
        [`${declaration} x`, "x=temp f", "temp"],
        [`${declaration} x`, "x= f", ""],
        [`${declaration} x`, "f", "unset"],
        [`${declaration} x=chosen`, "x=temp f", "chosen"],
        [`g() { ${declaration} x; report; }; g`, "x=temp f", "temp"],
        [`${declaration} x; g() { ${declaration} x; report; }; g`, "x=temp f", "temp"],
        [`${declaration} x=chosen; g() { ${declaration} x; report; }; g`, "x=temp f", "chosen"],
        [`${declaration} x; g() { ${declaration} x; report; }; g`, "f", "unset"],
        [`${declaration} x+=suffix`, "x=temp f", "tempsuffix"],
        [`${declaration} x+=suffix`, "f", "suffix"],
      ]) {
        test(`local prefix (arrays=${extensions.length}, allexport=${allexport}): ${body}; ${call}`, async t => {
          const { shell, commands } = setup({ extensions });
          for (const command of basicCommands()) commands.register(command);
          t.after(() => shell.dispose());
          const report = "printf \"inside:%s\\n\" \"${x-unset}\"; bash -c 'printf \"child:%s\\n\" \"${x-unset}\"'";
          const result = await shell.exec(`x=outer; set ${allexport ? "-a" : "+a"};
            report() { ${report}; };
            f() { ${body}; report; };
            ${call}; printf 'after:%s\\n' "$x"`);
          const child = call !== "f" || allexport && body.includes("+=") ? expected : "unset";
          const output = `inside:${expected}\nchild:${child}\n`;
          assert.equal(result.stdout, `${body.includes("g()") ? output : ""}${output}after:outer\n`);
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        });
      }
    }
  }
}

for (const middleware of [false, true]) for (const allexport of [false, true]) {
  test(`bare local preserves function prefix in child shells (middleware=${middleware}, allexport=${allexport})`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    if (middleware) shell.use((_invocation, next) => next());
    const result = await shell.exec(`x=outer; set ${allexport ? "-a" : "+a"};
      f() { local x; echo "inside=$x"; bash -c 'echo "child=$x"'; };
      x=temp f; echo "after=$x"`);
    assert.equal(result.stdout, "inside=temp\nchild=temp\nafter=outer\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
