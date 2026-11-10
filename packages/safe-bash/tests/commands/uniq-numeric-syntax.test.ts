import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { fixture, run } from "./helpers.js";

const commands = textCommands();
const stdin = "A x\nB x\nC y";

for (const [short, long, skipped] of [
  ["f", "skip-fields", "A x\nC y\n"],
  ["s", "skip-chars", "A x\nC y\n"],
  ["w", "check-chars", "A x\nB x\nC y\n"],
] as const) {
  for (const count of [" 1", "\t1", "\n1", "\v1", "\f1", "\r1", " \t+01", "0", "-0", " \t-000"]) {
    for (const args of [[`-${short}`, count], [`-${short}${count}`], [`--${long}=${count}`], [`--${long}`, count]]) {
      test(`uniq accepts GNU numeric syntax: ${JSON.stringify(args)}`, async () => {
        const result = await run("uniq", args, { commands, stdin, env: { LC_ALL: "C" } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, Number(count) === 0 ? short === "w" ? "A x\n" : `${stdin}\n` : skipped);
      });
    }
  }

  for (const count of ["1 ", "1\t", "-1", " -01", "", " \t", "+", "-", "+ 1", "- 0", "1.0", "1e0", "\u00a01"]) {
    test(`uniq rejects invalid ${short} count before opening output: ${JSON.stringify(count)}`, async () => {
      const fs = await fixture({ in: stdin, out: "KEEP", "-": "DASH", "+1": "named\n" });
      const result = await run("uniq", [`-${short}`, count, "in", "out"], { commands, fs, env: { LC_ALL: "C" } });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `uniq: invalid number '${count}'\n`);
      for (const [name, contents] of Object.entries({ in: stdin, out: "KEEP", "-": "DASH", "+1": "named\n" })) {
        assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString(), contents);
      }
    });
  }
}

test("uniq -f -0 preserves adjacent duplicate elimination", async () => {
  const result = await run("uniq", ["-f", "-0"], { commands, stdin: "A\nA\nB", env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "A\nB\n");
});
