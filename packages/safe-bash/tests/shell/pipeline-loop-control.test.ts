import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/index.js";

for (const control of ["break", "continue"]) {
  for (const lastpipe of [false, true]) {
    for (const position of ["first", "last"] as const) {
      test(`${control} in the ${position} pipeline stage with lastpipe=${lastpipe}`, async t => {
        const { shell } = setup();
        shell.use(standardCommands());
        t.after(() => shell.dispose());
        const stage = `{ ${control}; echo stage; }`;
        const pipeline = position === "first" ? `${stage} | cat` : `true | ${stage}`;
        const result = await shell.exec(`shopt -${lastpipe ? "s" : "u"} lastpipe
for i in 1 2; do echo before:$i; ${pipeline}; echo item:$i; done; echo end`);
        const inCaller = lastpipe && position === "last";
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, inCaller
          ? control === "break" ? "before:1\nend\n" : "before:1\nbefore:2\nend\n"
          : "before:1\nstage\nitem:1\nbefore:2\nstage\nitem:2\nend\n");
        assert.equal(result.stderr, inCaller ? "" : `${control}: only meaningful in a loop\n`.repeat(2));
      });
    }

    test(`${control} still controls a loop inside a pipeline stage with lastpipe=${lastpipe}`, async t => {
      const { shell } = setup();
      shell.use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`shopt -${lastpipe ? "s" : "u"} lastpipe
for i in 1 2; do
  true | { for j in a b; do echo inner:$j; ${control} 2; echo unreachable; done; echo stage; }
  echo item:$i
done; echo end`);
      const inner = control === "break" ? "inner:a\n" : "inner:a\ninner:b\n";
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, lastpipe
        ? control === "break" ? "inner:a\nend\n" : "inner:a\ninner:a\nend\n"
        : `${inner}stage\nitem:1\n${inner}stage\nitem:2\nend\n`);
    });
  }

  test(`${control} in a command substitution keeps its existing loop behavior`, async t => {
    const { shell } = setup();
    shell.use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`for i in 1 2; do value=$(${control}; echo stage); echo item:$i:value:$value; done; echo end`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "item:1:value:\nitem:2:value:\nend\n");
    assert.equal(result.stderr, "");
  });
}
