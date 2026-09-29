import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const declaration of ["local x=1; local x", "local x=1 x", "local x; local x=1; local x"]) {
  test(`function locals preserve redeclarations: ${declaration}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec(`x=outer; fn() { ${declaration}; echo "<$x>"; }; for i in 1 2; do fn; done; echo "$x"`);
    assert.equal(result.stdout, "<1>\n<1>\nouter\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("local arguments expand before each declaration command applies bindings", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('a=outer; fn() { local a=1 b="$a"; local c="$a"; echo "<$a:$b:$c>"; }; for i in 1 2; do fn; done; echo "$a"');
  assert.equal(result.stdout, "<1:outer:1>\n<1:outer:1>\nouter\n");
  assert.equal(result.stderr, "");
});

for (const body of [":", "local a=1", "return 3", "say inner", "nested() { :; }; nested inner"]) {
  for (const args of ["", " arg1 arg2"]) {
    for (const loop of [false, true]) {
      test(`function return restores invocation $_: ${body}, args=${args}, loop=${loop}`, async () => {
        const { shell, commands } = setup();
        for (const command of basicCommands()) commands.register(command);
        const call = `fn${args}; echo "s=$? _=$_"`;
        const result = await shell.exec(`fn() { ${body}; }; ${loop ? `for i in 1 2; do ${call}; done` : call}`);
        const expected = `${body === "say inner" ? "inner\n" : ""}s=${body === "return 3" ? 3 : 0} _=${args ? "arg2" : "fn"}\n`;
        assert.equal(result.stdout, expected.repeat(loop ? 2 : 1));
        assert.equal(result.stderr, "");
      });
    }
  }
}

for (const body of ['set -- changed; :', 'return 3']) {
  test(`middleware-dispatched function returns invocation $_: ${body}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    shell.use(async (_context, next) => next());
    const result = await shell.exec(`fn() { ${body}; }; fn arg1 arg2; echo "s=$? _=$_"`);
    assert.equal(result.stdout, `s=${body === 'return 3' ? 3 : 0} _=arg2\n`);
    assert.equal(result.stderr, "");
  });
}
