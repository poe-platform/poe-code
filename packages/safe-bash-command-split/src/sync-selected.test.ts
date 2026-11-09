import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { evalSyncSplit, splitCommands } from "./index.js";

for (const [mode, selected] of [["1/1", "ABC\nD"], ["l/1/2", "ABC\n"], ["r/1/2", "ABC\n"]]) {
  for (const prefix of ["\uFEFF", ""]) {
    test(`sync split -n${mode} preserves selected bytes with ${prefix ? "BOM" : "no BOM"}`, () => {
      const input = new TextEncoder().encode(`${prefix}ABC\nD`);
      const expected = new TextEncoder().encode(`${prefix}${selected}`);
      for (const source of ["-", "input"]) {
        const output = evalSyncSplit(input, [`-n${mode}`, source], () => input);
        assert.notEqual(output, undefined);
        assert.deepEqual(new TextEncoder().encode(output), expected);
      }
    });
  }
}

test("sync split falls back for binary and invalid UTF-8 selected chunks", () => {
  for (const input of [new Uint8Array([0]), new Uint8Array([0xff]), new Uint8Array([0xef, 0xbb])]) {
    assert.equal(evalSyncSplit(input, ["-n1/1"]), undefined);
  }
});

test("shell capture preserves the BOM bytes in selected split chunks", async () => {
  const shellSource = "../../safe-bash/src/core.js";
  const { Shell, standardCommands } = await import(shellSource);
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/" }).use(standardCommands()).use(splitCommands());
  try {
    for (const prefix of ["\uFEFF", ""]) {
      await fs.writeFile("/input", new TextEncoder().encode(`${prefix}ABC\nD`));
      for (const [mode, selected] of [["1/1", "ABC\nD"], ["l/1/2", "ABC\n"], ["r/1/2", "ABC\n"]] as const) {
        const command = `split -n${mode} /input`;
        const direct = await shell.exec(command);
        assert.equal(direct.exitCode, 0, direct.stderr);
        assert.deepEqual(direct.stdoutBytes, new TextEncoder().encode(`${prefix}${selected}`));
        const captured = await shell.exec(`v=$(${command}); printf '%s' "$v"`);
        assert.equal(captured.exitCode, 0, captured.stderr);
        assert.deepEqual(captured.stdoutBytes, new TextEncoder().encode(`${prefix}${selected.trimEnd()}`));
      }
    }
  } finally {
    await shell.dispose();
  }
});
