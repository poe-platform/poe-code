import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { fixture, run } from "./helpers.js";

const commands = textCommands();
const stdin = "A x\nB x\nC y";

for (const [short, long, output] of [
  ["f", "skip-fields", "A x\nC y\n"],
  ["s", "skip-chars", "A x\nC y\n"],
  ["w", "check-chars", "A x\nB x\nC y\n"],
] as const) {
  for (const args of [
    [`-${short}`, "bad", `-${short}1`],
    [`-${short}bad`, `-${short}`, "1"],
    [`--${long}=bad`, `--${long}=1`],
    [`--${long}`, "bad", `-${short}1`],
    [`-i${short}bad`, `--${long}=1`],
    [`-${short}1`, `-${short}bad`],
  ]) {
    test(`uniq rejects every count before opening output: ${args.join(" ")}`, async () => {
      const fs = await fixture({ in: stdin, out: "KEEP" });
      const result = await run("uniq", [...args, "in", "out"], { commands, fs, stdin, env: { LC_ALL: "C" } });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "uniq: invalid number 'bad'\n");
      assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), "KEEP");
      assert.equal(Buffer.from(await fs.readFile("/work/in")).toString(), stdin);
    });
  }

  for (const args of [[`-${short}0`, `-${short}1`], [`--${long}=0`, `--${long}`, "1"]]) {
    test(`uniq keeps the last valid count: ${args.join(" ")}`, async () => {
      const fs = await fixture({ in: stdin, out: "KEEP" });
      const result = await run("uniq", [...args, "in", "out"], { commands, fs, stdin, env: { LC_ALL: "C" } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), output);
    });
  }
}
