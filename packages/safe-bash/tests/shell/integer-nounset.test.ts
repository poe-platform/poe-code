import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const source of [
  "declare -i n=missing",
  "typeset -i n=missing",
  "f(){ local -i n=missing; }; f",
  "declare -i n; n=missing",
  "declare -i n=2; n+=missing",
  "declare -i n=missing || say recovered",
  "declare -ai n=(missing)",
]) test(`integer nounset stops the shell with status 127: ${source}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`set -u\n${source}\nsay unreachable`);
  assert.equal(result.exitCode, 127);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: line 2: missing: unbound variable\n");
});

for (const source of [
  "(declare -i n=missing; say unreachable); say status:$?",
  "n=$(declare -i n=missing; say unreachable); say status:$?",
]) test(`integer nounset stays isolated with status 1: ${source}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`set -u\n${source}\nsay parent`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "status:1\nparent\n");
  assert.equal(result.stderr, "shell: line 2: missing: unbound variable\n");
});
