import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShell, ShellSyntaxError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

test("non-shell whitespace remains literal and never stalls tokenization", { timeout: 1000 }, async () => {
  const { shell } = setup();
  for (const whitespace of ["\u00a0", "\v", "\r", "\f", "\u2028", "\u2029", "\ufeff"]) {
    assert.doesNotThrow(() => parseShell(`args a${whitespace}b`));
    assert.deepEqual(JSON.parse((await shell.exec(`args a${whitespace}b`)).stdout), [`a${whitespace}b`]);
  }
});

test("continuations preserve keyword, operator and descriptor recognition", async () => {
  const { shell, fs } = setup();
  assert.equal((await shell.exec("i\\\nf true; th\\\nen say yes; f\\\ni")).stdout, "yes\n");
  assert.equal((await shell.exec("true |\\\n| say no; false &\\\n& say no; say yes")).stdout, "yes\n");
  const result = await shell.exec("both 2\\\n>errors");
  assert.equal(result.stdout, "out\n");
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/errors")), "err\n");
  assert.equal((await shell.exec("args 'a\\\nb' \"c\\\nd\" e\\\nf")).stdout, '["a\\\\\\nb","cd","ef"]');
});

test("misplaced negation and unsupported expansion syntax reject before effects", async () => {
  for (const source of ["say touched; ! ! true", "say touched; true | ! false", "say touched; args $'a\\nb'", 'say touched; args $"text"', "say touched; args $$ $! $-", "say touched; args $((1 constructor 2))"]) {
    const { shell } = setup();
    assert.throws(() => parseShell(source), ShellSyntaxError);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 2, source);
    assert.equal(result.stdout, "", source);
  }
  assert.equal((await setup().shell.exec("args ! '$$' \\$!")).stdout, '["!","$$","$!"]');
});

test("parameter alternates inherit outer double-quote rules", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('args "${missing:-\'hello\'}" ${missing:-\'hello world\'}')).stdout, '["\'hello\'","hello world"]');
  assert.equal((await shell.exec('args "${missing:-a\'b\'c}" "${missing:-${other:-\'nested\'}}"')).stdout, '["a\'b\'c","\'nested\'"]');
});
