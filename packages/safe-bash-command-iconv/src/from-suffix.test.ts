import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

for (const fixture of [
  { from: "latin1//IGNORE", to: "utf-8", input: Buffer.from("café\n", "latin1"), output: "café\n" },
  { from: "utf-8//TRANSLIT", to: "ascii", input: Buffer.from("x\n"), output: "x\n" },
]) {
  for (const args of [["-f", fixture.from], [`--from-code=${fixture.from}`]]) {
    test(`iconv accepts source suffix in ${args.join(" ")}`, async () => {
      assert.deepEqual(await run([...args, "-t", fixture.to], fixture.input), {
        exitCode: 0, stdoutHex: Buffer.from(fixture.output).toString("hex"), stderrHex: "",
      });
    });
  }
}

for (const suffix of ["IGNORE", "TRANSLIT", "ignore//translit"]) {
  test(`iconv source //${suffix} does not change conversion error handling`, async () => {
    for (const input of [Uint8Array.of(0xff, 0x61), Buffer.from("éa")]) {
      const args = ["-f", "utf-8", "-t", "ascii"];
      const expected = await run(args, input);
      assert.equal(expected.exitCode, 1);
      assert.deepEqual(await run(["-f", `utf-8//${suffix}`, "-t", "ascii"], input), expected);
    }
  });
}
