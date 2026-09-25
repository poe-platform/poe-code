import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { run } from "../helpers.js";

interface NativeRow {
  category: string;
  input: string;
  zone: string;
  args: string[];
  gnu: { status: number; stdoutHex: string; stderrHex: string };
}
const fixture = JSON.parse(await readFile(new URL("native-v1.json", import.meta.url), "utf8")) as { rows: NativeRow[] };
for (const row of fixture.rows.filter(row => row.category === "required-ISO-year-v1")) {
  test(`ISO year v1 pinned GNU9.7 Darwin ${row.input} ${row.zone}`, async () => {
    const result = await run("date", row.args, {}, { env: { TZ: row.zone } });
    assert.equal(row.gnu.status, 0);
    assert.deepEqual({ status: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: Buffer.from(result.stderr).toString("hex") }, row.gnu);
  });
}
test("ISO year digit presentation does not change signed year, week or calendar year", async () => {
  for (const [input, expected] of [
    ["0000-01-01T12:00:00Z", "0000|-001|01|1|52|6"],
    ["0000-01-02T12:00:00Z", "0000|-001|01|1|52|7"],
    ["0000-01-03T12:00:00Z", "0000|0000|00|0|01|1"],
    ["2000-01-01T12:00:00Z", "2000|1999|99|99|52|6"],
    ["2021-01-01T12:00:00Z", "2021|2020|20|20|53|5"],
  ]) {
    const result = await run("date", ["-d", input!, "+%Y|%G|%g|%-g|%V|%u"]);
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, expected + "\n");
  }
});
test("negative-year epochs match the preserved native calendar and ISO year witnesses", async () => {
  for (const row of fixture.rows.filter(row => row.category === "native-negative-year-outside-product-domain")) {
    const result = await run("date", row.args, {}, { env: { TZ: row.zone } });
    assert.equal(row.gnu.status, 0);
    assert.deepEqual({ status: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: Buffer.from(result.stderr).toString("hex") }, row.gnu);
  }
});

test("negative calendar years use absolute two-digit years in date presentations", async () => {
  for (const [input, expected] of [
    ["@-62167219201", "01|1| 1|12/31/01|12/31/01\n"],
    ["@-62198755200", "01|1| 1|01/01/01|01/01/01\n"],
    ["@-63113904000", "30|30|30|01/01/30|01/01/30\n"],
  ] as const) {
    const result = await run("date", ["-d", input, "+%y|%-y|%_y|%D|%x"], {}, { env: { TZ: "UTC" } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});
