import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const [source, expected] of [
  ['a=hello; unset -v a; printf \'status=%s,value=<%s>\' "$?" "${a-unset}"', 'status=0,value=<unset>'],
  ['f(){ printf hello; }; unset -f f; r=$?; printf \'status=%s,type=\' "$r"; type -t f || true', 'status=0,type='],
  ['f=value; f(){ printf function; }; unset -v f; printf "%s:%s:" "$?" "${f-unset}"; f', '0:unset:function'],
  ['f=value; f(){ printf function; }; unset -f f; printf "%s:%s:" "$?" "$f"; type -t f || true', '0:value:'],
  ['a=outer; f(){ local a=inner; unset -v a; printf "%s:" "${a-unset}"; }; f; printf %s "$a"', 'unset:outer'],
  ['export a=old; unset -v a; a=new; envget a', '<unset>'],
  ['f(){ printf parent; }; (unset -f f); f', 'parent'],
  ['a=hello; unset -vv -- a; printf "%s:%s" "$?" "${a-unset}"', '0:unset'],
] as const) {
  test(`unset selection options: ${source}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
