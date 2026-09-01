import assert from "node:assert/strict";
import test from "node:test";
import { shell, type NativeCase } from "./helpers.js";

const pages = "head\n\\:\\:\\:\nH\n\n\\:\\:\nA\n\nB\n\\:\nF\n\\:\\:\nC\n";
export const nlCases: readonly NativeCase[] = [
  { args: [], input: "a\n\nb\nlast" }, { args: ["-ba"], input: "\na\n\n" },
  { args: ["-bt"], input: " \n\t\n\n" }, { args: ["-bn"], input: "a\n\nb" },
  { args: [], input: pages }, { args: ["-ha", "-fa"], input: pages }, { args: ["-p", "-ha", "-fa"], input: pages },
  { args: ["-ba", "-l2"], input: "\n\n\nX\n\n\n" },
  { args: ["-ba", "-l2", "-ha"], input: "\n\\:\\:\\:\n\n" },
  { args: ["-v-2", "-i2", "-nrz", "-w4", "-s|"], input: "a\nb\nc\n" },
  { args: ["-nln", "-w2", "-s" , ""], input: "a\n\nb" },
  { args: ["-i0"], input: "a\nb" }, { args: ["-i-1", "-v2"], input: "a\nb\nc\nd" },
  { args: ["-d", ""], input: pages }, { args: ["-d", "@"], input: "a\n@:@:\nb" },
  { args: ["-d", "XYZ", "-ha"], input: "a\nXYZXYZXYZ\nb" },
  { args: ["--body-numbering=a", "--number-width=3", "--number-format=rz", "--number-separator=:"], input: "x\n\n" },
  { args: ["-bp^[[:digit:]]"], input: "12\nabc\n3\n" },
  { args: ["-bp^\\(ab\\)\\1$"], input: "abab\nab\n" }, { args: ["-bp"], input: "\nx" },
  { args: ["-ba"], input: Buffer.from([255, 0, 97, 10]) },
  { args: ["-ba", "-l0"], input: "\n\n\nX\n" }, { args: ["-w0"], failure: true },
  { args: ["-bq"], failure: true }, { args: ["-nxx"], failure: true },
  { args: ["-bp["], failure: true }, { args: ["--bad"], failure: true },
  { args: ["-l-1"], failure: true },
];

test("nl bounded matcher consumes the invocation's shared step budget", async () => {
  const instance = shell({ limits: { maxSteps: 1000 } });
  const result = await instance.exec("nl -bp'a*a*a*a*b'", { stdin: "a".repeat(200) + "\n" });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /step limit/);
  await instance.dispose();
});

test("nl continues over missing files and preserves numbering", async () => {
  const instance = shell();
  const result = await instance.exec("printf 'a\\n' > /a; printf 'b' > /b; nl /a /missing /b");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "     1\ta\n     2\tb\n");
  assert.match(result.stderr, /missing/);
  await instance.dispose();
});
