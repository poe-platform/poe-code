import assert from "node:assert/strict";
import { test } from "node:test";
import { printfCommand } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const cases = [
  ['i=01; while (( i < 3 )); do printf "%d," "$i"; (( i++ )); done; :', '1,2,'],
  ['i=1; while (( i >= -1 )); do printf "%u," "$i"; (( i-- )); done; :', '1,0,18446744073709551615,'],
  ['out=""; i=-2; while (( i < 2 )); do out+=$(printf "%x," "$i"); (( i++ )); done; printf "%s\\n" "$out"', 'fffffffffffffffe,ffffffffffffffff,0,1,\n'],
  ['i=0; while (( i < 2 )); do printf "%u," "$i"; let i=-1; break; done; :', '0,'],
  ['i=0; while (( i < 3 )); do printf "%u," "$i"; (( i++ )); done; :', '0,1,2,'],
  ['i=0; while (( i < 2 )); do (( i-- )); printf "%u," "$i"; (( i++ )); (( i++ )); done; :', '18446744073709551615,0,'],
  ['i=0; while (( i <= 2 )); do printf "%u," "$(( i + 3 ))"; (( i++ )); done; :', '3,4,5,'],
  ['for (( i=0; i<2; i++ )); do printf "%u," "$(( 999999999999999 * (i + 10) ))"; done; :', '9999999999999990,10999999999999989,'],
  ['for (( i=0; i<2; i++ )); do printf "%u," "$(( 2147483647 + i ))"; done; :', '2147483647,2147483648,'],
] as const;
for (const [source, expected] of cases) {
  test(`printf induction safety: ${source}`, async () => {
    const { shell, commands } = setup();
    commands.register(printfCommand);
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  });
}
for (const name of ['i1', 'i0', 'ii']) for (const format of ['x', 'u']) {
  test(`printf arithmetic treats ${name} as a separate identifier (%${format})`, async () => {
    const { shell, commands } = setup();
    commands.register(printfCommand);
    const result = await shell.exec(`${name}=-5; for (( i = 0; i < 2; i++ )); do printf "%${format}," "$(( ${name} ))"; done; :`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, format === 'x' ? 'fffffffffffffffb,fffffffffffffffb,' : '18446744073709551611,18446744073709551611,');
    assert.equal(result.exitCode, 0);
  });
}
test('UTF-8 printf width works without a global Buffer', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  try {
    Reflect.deleteProperty(globalThis, 'Buffer');
    for (const source of [
      'x="é"; printf -v out "%5s" "$x"; printf "%s" "$out"',
      'x="é"; out=$(printf "%5s" "$x"); printf "%s" "$out"',
      'x="é"; for (( i=0; i<2; i++ )); do printf -v out "%5s" "$x"; done; printf "%s" "$out"',
    ]) {
      const { shell, commands } = setup();
      commands.register(printfCommand);
      const result = await shell.exec(source);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, '   é');
      assert.equal(result.exitCode, 0);
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, 'Buffer', saved);
  }
});
