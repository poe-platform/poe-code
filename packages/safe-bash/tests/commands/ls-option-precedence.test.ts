import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

for (const [flags, expected] of [
  [["-a", "-A"], ".hidden\nfile\n"],
  [["-aA"], ".hidden\nfile\n"],
  [["--all", "--almost-all"], ".hidden\nfile\n"],
  [["-A", "-a"], ".\n..\n.hidden\nfile\n"],
  [["-Aa"], ".\n..\n.hidden\nfile\n"],
  [["--almost-all", "--all"], ".\n..\n.hidden\nfile\n"],
] as const) test(`ls uses the last hidden-entry selector: ${flags.join(" ")}`, async () => {
  const result = await run("ls", flags, { fs: await fixture({ file: "", ".hidden": "" }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("ls ignores option-shaped operands after --", async () => {
  const result = await run("ls", ["-a", "--", "-A"], { fs: await fixture({ "-A/file": "" }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, ".\n..\nfile\n");
});

for (const flags of [["-l", "-1"], ["-l1"], ["-1l"], ["-l", "-1", "-c"]]) {
  test(`ls retains GNU long format with ${flags.join(" ")}`, async () => {
    const result = await run("ls", [...flags, "file"], { fs: await fixture({ file: "" }) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.startsWith("-rw-"), result.stdout);
    assert.ok(result.stdout.endsWith(" file\n"), result.stdout);
  });
}

for (const operand of ["/work///", "./tree///", "tree/", "tree///"]) {
  test(`ls strips trailing separators from recursive child headers: ${operand}`, async () => {
    const fs = await fixture({ "tree/sub/file": "" });
    const root = operand.startsWith("/work") ? "/work" : operand.startsWith(".") ? "./tree" : "tree";
    const result = await run("ls", ["-R", operand], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, operand.startsWith("/work")
      ? `${operand}:\ntree\n\n${root}/tree:\nsub\n\n${root}/tree/sub:\nfile\n`
      : `${operand}:\nsub\n\n${root}/sub:\nfile\n`);
  });
}
