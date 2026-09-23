import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

for (const flag of ["n", "N"]) {
  for (const value of ["+2", " 2 ", "\t2\t", "2\n", "\n2\n", "02", "-0", "+0"]) {
    test(`default read -${flag} accepts signed and padded count ${JSON.stringify(value)}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const zero = Number(value) === 0;
      const result = await shell.exec(`read -${flag} '${value}' first; status=$?; read -r rest; args "$status" "$first" "$rest"; pass`, { stdin: "abcd\nTAIL\n" });
      assert.equal(result.stdout, JSON.stringify(["0", zero ? "" : "ab", zero ? "abcd" : "cd"]) + "TAIL\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
  for (const value of ["", " ", "+", "-1", "2x", "2 0", "0x2", "1.5", "1e2", "9007199254740992", "\u00a02"]) {
    test(`default read -${flag} rejects invalid count ${JSON.stringify(value)} without consuming input`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`read -${flag} '${value}' first; args "$?"; pass`, { stdin: "untouched" });
      assert.equal(result.stdout, JSON.stringify([flag === "N" ? "1" : "2"]) + "untouched");
      assert.ok(result.stderr.includes("read:"));
    });
  }
}
