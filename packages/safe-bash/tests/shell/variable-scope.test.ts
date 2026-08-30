import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

for (const source of [
  'value=old; value=new export value; say "<$value>"',
  'value=old; value=new export value=explicit; say "<$value>"',
  'value=old; value=new export other; say "<$value>"',
  'value=old; value=new other=new export value; say "<$value>|<$other>"',
  'value=outer; func() { local value; say "<$value>|<${value+set}>"; }; func; say "<$value>"',
  'value=outer; func() { local value; value=inner; local value; say "<$value>"; }; func; say "<$value>"',
  'value=outer; func() { local value=inner; say "<$value>"; }; func; say "<$value>"',
  'value=outer; func() { value=new local value; say "<$value>"; }; func; say "<$value>"',
  'value=outer; func() { value=new local other; say "<$value>"; }; func; say "<$value>"',
  'value=outer; func() { value=changed; }; value=new func; say "<$value>"',
]) {
  test(`declarations preserve the right variable scope: ${source}`, async () => {
    const expected = bashResult('say() { printf "%s\\n" "$*"; }; ' + source);
    const { shell } = setup();
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, { stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode });
  });
}
