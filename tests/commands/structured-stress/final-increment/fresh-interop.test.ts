import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withFixture, writableAdapters } from "../../../integration/adapter-tools/fixtures.js";
import type { BytesResult } from "../independent-increment/harness.js";

interface Fixture { id: string; argv: string[]; inputHex: string; expected: BytesResult }
const evidence = JSON.parse(readFileSync(new URL("./fresh-native.json", import.meta.url), "utf8")) as { cases: Fixture[] };
const fixtures = evidence.cases.filter(fixture => ["integers-ordered", "precision-roundtrip", "scaled-computed", "line-raw-output"].includes(fixture.id));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
for (const backend of writableAdapters) {
  test(`fresh numeric/split pipelines: ${backend}`, { timeout: 20000 }, async () => {
    await withFixture(backend, async ({ exec, fs, dispatched }) => {
      for (const fixture of fixtures) {
        await fs.writeFile("/work/final-input.txt", Buffer.from(fixture.inputHex, "hex"));
        const command = ["jq", ...fixture.argv.map(quote)].join(" ");
        for (const script of [
          `${command} final-input.txt`,
          `set -o pipefail; cat final-input.txt | ${command} > final-output.json && cat final-output.json`,
        ]) {
          const actual = await exec(script);
          assert.deepEqual({ status: actual.exitCode, stdoutHex: Buffer.from(actual.stdout).toString("hex"),
            stderrHex: Buffer.from(actual.stderr).toString("hex") }, fixture.expected, `${backend}:${fixture.id}`);
        }
        assert.equal(Buffer.from(await fs.readFile("/work/final-output.json")).toString("hex"), fixture.expected.stdoutHex);
      }
      assert.ok(dispatched.includes("jq"));
      assert.ok(dispatched.includes("cat"));
    });
  });
}
