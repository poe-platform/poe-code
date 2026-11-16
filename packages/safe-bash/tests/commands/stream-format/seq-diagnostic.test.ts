import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { quote, shell } from "./helpers.js";

interface Observation { exitCode: number; stdoutHex: string; stderr: string }
const captured: { cases: { args: string[]; native: Observation }[] } = JSON.parse(await readFile(new URL("./evidence/seq-diagnostic-initial.json", import.meta.url), "utf8"));
for (const fixture of captured.cases) {
  const format = fixture.args[1]!;
  test(`seq diagnostic static regression: ${JSON.stringify(format)}`, async () => {
    const instance = shell();
    try {
      const actual = await instance.exec(["seq", ...fixture.args.map(quote)].join(" "));
      assert.equal(actual.exitCode, fixture.native.exitCode);
      assert.equal(Buffer.from(actual.stdoutBytes).toString("hex"), fixture.native.stdoutHex);
      assert.equal(actual.stderr, fixture.native.stderr);
    } finally { await instance.dispose(); }
  });
}
