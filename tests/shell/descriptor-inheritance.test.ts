import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

const prelude = 'say() { printf "%s\\n" "$*"; }; err() { printf "%s\\n" "$*" >&2; }; pass() { cat; }; ';
for (const source of [
  "{ say x >&3; } 3>out",
  "func() { say x >&3; }; func 3>out",
  "(say x >&3) 3>out",
  "if true; then say x >&3; fi 3>out",
  "for value in a b; do say \"$value\" >&3; done 3>out",
  "{ say x >&3 | pass; } 3>out",
  "{ value=$(say x >&3); say \"$value\"; } 3>out",
  "{ { say first >&4; } 4>&3; say second >&3; } 3>out",
  "{ say before >&3; { :; } 3>&-; say after >&3; } 3>out",
  "{ say before >&3; { say inner >&3; } 3>other; say after >&3; } 3>out",
  "{ read -r first <&3; say \"$first\"; pass <&3; } 3<input",
  'say hi 2>err >"$(err diagnostic; say out)"',
  'say hi 3>err >"$(say diagnostic >&3; say out)"',
  '{ say hi 2>err >"$(err diagnostic; say out)"; } 2>outer',
]) {
  test(`descriptors inherit and redirect expansions observe ordering: ${source}`, async () => {
    const files = { input: "a\nb\n" };
    const expected = bashResult(prelude + source, { files });
    const { shell, fs } = setup();
    await fs.writeFile("/input", new TextEncoder().encode(files.input));
    const actual = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    const actualFiles = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) => [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode, files: actualFiles }, expected);
  });
}

test("closed inherited descriptors stay closed for duplication", async () => {
  for (const source of ["{ : 3>&1; } 1>&-", "{ : 3<&0; } 0<&-", "{ : 3>&2; } 2>&-"]) {
    const expected = bashResult(source);
    assert.equal(expected.exitCode, 1);
    const { shell } = setup();
    assert.equal((await shell.exec(source)).exitCode, expected.exitCode, source);
  }
});

test("literal command invocation preserves inherited descriptors", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "delegate", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("func", []);
  } });
  const actual = await shell.exec("func() { say x >&3; }; delegate 3>out");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "x\n");
});
