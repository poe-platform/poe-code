import assert from "node:assert/strict";
import test from "node:test";
import { compare, shell, type NativeCase } from "./helpers.js";

const blanks = "        a        b\n1234567  X\n1234567 X\n1234567 \tX\n\t  \t\n";
export const unexpandCases: readonly NativeCase[] = [
  { args: [], input: blanks }, { args: ["-a"], input: blanks },
  { args: ["-t4"], input: blanks }, { args: ["--first-only", "-a", "-t4"], input: blanks },
  { args: ["-t", "4,8"], input: "            X\n\t\t\tX\n" },
  { args: ["-t", "4,8,+3"], input: "                 X\n1234567  X" },
  { args: ["--tabs=4,8,/3"], input: "                 X\n1234567  X" },
  { args: ["-a"], input: "ab\b       x\n\b        y\n12345678\b X\n" },
  { args: [], input: "        " }, { args: [], input: "       " }, { args: [], input: "" },
  { args: ["-t1"], input: " a b  c\n" }, { args: ["-t2"], input: " a b  c\n" },
  { args: ["-4"], input: blanks }, { args: ["-4,8"], input: blanks },
  { args: ["-a"], input: Buffer.from([255, 32, 32, 32, 32, 32, 32, 32, 0, 10]) },
  { args: ["-a"], input: "é      🙂        x\n", locale: "en_US.UTF-8" },
  { args: ["-t0"], failure: true }, { args: ["-t4,3"], failure: true },
  { args: ["-t4,4"], failure: true }, { args: ["-t4,+2,/3"], failure: true },
  { args: ["-txyz"], failure: true }, { args: ["--bad"], failure: true },
];
for (const fixture of unexpandCases) test(`unexpand native ${JSON.stringify(fixture.args)} ${JSON.stringify(fixture.input)}`, () => compare("unexpand", fixture));

test("unexpand continuous file columns and repeated stdin", async () => {
  const instance = shell();
  const result = await instance.exec("printf '1234' > /a; printf '    x' > /b; unexpand -a /a /missing /b - -", { stdin: "        y\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "1234\tx\t y\n");
  assert.match(result.stderr, /missing/);
  await instance.dispose();
});

test("unexpand and existing expand compose through actual pipes", async () => {
  const instance = shell();
  const input = "    a       b\n        c\n";
  const result = await instance.exec("unexpand -t4 | expand -t4", { stdin: input });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, input);
  await instance.dispose();
});
