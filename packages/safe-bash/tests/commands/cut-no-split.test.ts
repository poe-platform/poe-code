import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, run } from "./helpers.js";

const cases = [
  { name: "standalone byte option", args: ["-n", "-b", "1"], input: "abc\n", output: "610a" },
  { name: "grouped byte option still splits UTF-8", args: ["-nb1"], input: "éZ\n", output: "c30a" },
  { name: "repeated option after byte list", args: ["-b", "2", "-nn"], input: "éZ\n", output: "a90a" },
  { name: "character mode", args: ["-n", "-c", "1"], input: "éZ\n", output: "c3a90a" },
  { name: "field mode", args: ["-n", "-d", ":", "-f", "2"], input: "a:b\n", output: "620a" },
];

for (const specimen of cases) for (const source of ["stdin", "file"] as const) {
  test(`cut ignores -n: ${specimen.name} from ${source}`, async () => {
    const fs = await fixture(source === "file" ? { input: specimen.input } : {});
    const result = await run("cut", [...specimen.args, ...(source === "file" ? ["input"] : [])], {
      fs,
      ...(source === "file" ? {} : { stdin: specimen.input }),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdoutBytes.toString("hex"), specimen.output);
  });
}
