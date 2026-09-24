import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const kind of ["a", "A"]) {
  for (const [attribute, initial, assigned, appended, expected] of [
    ["i", "1+2", "5+6", "2*5", "13:11:15"],
    ["l", "HELLO", "WORLD", "FOO", "hellofoo:world:bar"],
    ["u", "hello", "world", "foo", "HELLOFOO:WORLD:BAR"],
  ]) test(`${kind} array ${attribute} transforms compound, element and zero writes`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const zero = attribute === "i" ? "2+3" : "bAr";
      const result = await shell.exec(`declare -${kind}${attribute} v=([0]=${initial}); v[1]=${assigned}; v[0]+=${appended}; printf '%s:' "\${v[0]}"; printf '%s:' "\${v[1]}"; v=${zero}; v+=${attribute === "i" ? "10" : ""}; printf '%s' "\${v[0]}"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
  for (const local of [false, true]) test(`${kind} readonly declaration without initializer (${local ? "local" : "global"})`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const body = `declare -${kind} v=([0]=old); ${local ? "local" : "declare"} -${kind}r v; v[0]=new`;
      const result = await shell.exec(local ? `f(){ ${body}; }; f` : body);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("readonly"), result.stderr);
    } finally { await shell.dispose(); }
  });
}

for (const kind of ["a", "A"]) {
  for (const attribute of ["i", "l", "u"]) test(`${kind} ${attribute} attributes on declarations without initializers and local restoration`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const value = attribute === "i" ? "3+4" : "MiXeD";
      const expected = attribute === "i" ? "7" : attribute === "l" ? "mixed" : "MIXED";
      const result = await shell.exec(`declare -${kind} v=([0]=outer); f(){ local -${kind}${attribute} v; v[0]=${value}; printf '%s:' "\${v[0]}"; }; f; printf '%s:' "\${v[0]}"; declare -${kind}${attribute} v; v[0]=${value}; printf '%s:' "\${v[0]}"; declare +${attribute} v; v[0]=${value}; printf '%s' "\${v[0]}"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `${expected}:outer:${expected}:${value}`);
    } finally { await shell.dispose(); }
  });
  test(`${kind} integer compound replacement and append`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const result = await shell.exec(`declare -${kind}i v=([0]=2); v+=([0]+=3*4 [1]=5+6); printf '%s:%s:' "\${v[0]}" "\${v[1]}"; v=([0]=6*7); printf '%s' "\${v[0]}"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "14:11:42");
    } finally { await shell.dispose(); }
  });
}
