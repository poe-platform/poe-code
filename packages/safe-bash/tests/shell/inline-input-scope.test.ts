import assert from "node:assert/strict";
import { test } from "node:test";
import { runBash, runVirtualScript } from "../shell-stress/helpers.js";

for (const redirect of ["<<<${VALUE:=first}", "<<EOF\n${VALUE:=first}\nEOF\n"]) {
  for (const command of ["cat", "read -r INPUT", ":", "printf output", "func", ""]) {
    const script = `func() { cat; }; ${command} ${redirect}\nprintf '<%s>:<%s>' "$VALUE" "$INPUT"`;
    test(`inline input assignment scope: ${JSON.stringify(command)} ${JSON.stringify(redirect)}`, async () => {
      const fixture = { name: "inline input assignment scope", script };
      assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
    });
  }
}

for (const redirect of ["<<<\"$((VALUE=3))\"", "<<EOF\n$((VALUE=3))\nEOF\n"]) {
  const script = `cat ${redirect}\nprintf '<%s>' "$VALUE"`;
  test(`inline input arithmetic scope: ${JSON.stringify(redirect)}`, async () => {
    const fixture = { name: "inline input arithmetic scope", script };
    assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
  });
}

for (const redirect of ["<<<\"$(printf '%s' \"$VALUE\" >seen)\"", "<<EOF\n$(printf '%s' \"$VALUE\" >seen)\nEOF\n"]) {
  for (const command of ["cat", "read -r INPUT", ":", "printf output", "func", ""]) {
    const script = `func() { cat; }; VALUE=outer; VALUE=inner ${command} ${redirect}\nprintf '<%s>' "$VALUE"; cat seen`;
    test(`inline input prefix assignment order: ${JSON.stringify(command)} ${JSON.stringify(redirect)}`, async () => {
      const fixture = { name: "inline input prefix assignment order", script };
      assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
    });
  }
}

for (const redirect of ["<<<\"$VALUE\"", "<<EOF\n$VALUE\nEOF\n"]) {
  test(`function caller inline parameters precede prefix bindings: ${JSON.stringify(redirect)}`, async () => {
    const fixture = { name: "function caller inline parameters", script: `func() { cat; }; VALUE=outer; VALUE=inner func ${redirect}` };
    assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
  });
  test(`inline input assignment substitution reads prior stdin: ${JSON.stringify(redirect)}`, async () => {
    const fixture = { name: "inline input assignment substitution", script: `VALUE=$(cat) cat ${redirect}`, stdin: "original" };
    assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
  });
}
