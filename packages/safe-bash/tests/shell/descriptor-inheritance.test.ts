import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

const prelude = 'say() { printf "%s\\n" "$*"; }; err() { printf "%s\\n" "$*" >&2; }; pass() { cat; }; ';

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
