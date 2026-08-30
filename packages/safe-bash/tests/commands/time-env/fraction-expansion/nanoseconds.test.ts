import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { run } from "../helpers.js";

interface NativeRow {
  category: string;
  input: string;
  args: string[];
  zone: string;
  directives: string[];
  gnu: { status: number; stdoutHex: string; stderrHex: string };
}
const fixture = JSON.parse(await readFile(new URL("native-v1.json", import.meta.url), "utf8")) as { rows: NativeRow[] };
for (const row of fixture.rows.filter(row => row.category === "required-fraction-v1")) {
  test(`fraction expansion v1 pinned GNU9.7 Darwin ${row.input}`, async () => {
    const result = await run("date", row.args, {}, { env: { TZ: row.zone } });
    assert.equal(row.gnu.status, 0);
    assert.deepEqual({ status: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: Buffer.from(result.stderr).toString("hex") }, row.gnu);
  });
}
test("fraction widths preserve actual millisecond clock precision and sample once", async () => {
  let calls = 0;
  const result = await run("date", ["+%N|%3N|%6N|%17N|%-N|%_12N"], { clock: () => { calls++; return 1704164645123; } });
  assert.equal(calls, 1); assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, "123000000|123|123000|12300000000000000|123|123         \n");
});
test("unpadded virtual fractions do not infer native hardware resolution or discard explicit precision", async () => {
  for (const [input, expected] of [["@0", "0"], ["@0.0012", "0012"], ["@0.0000001", "0000001"], ["@0.123456789", "123456789"], ["@-0.000000001", "999999999"]]) {
    const result = await run("date", ["-d", input!, "+%-N|%--N|%0-N"]);
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, `${expected}|${expected}|${expected}\n`);
  }
});
test("fraction width truncation never rounds into the next second", async () => {
  for (const [input, expected] of [["@0.999999999", "0|999|999999"], ["@-0.000000001", "-1|999|999999"], ["@0.000000001", "0|000|000000"]]) {
    const result = await run("date", ["-d", input!, "+%s|%3N|%6N"]);
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, expected + "\n");
  }
});
for (const format of ["%1000000000N", "%_1000000000N", "%01000000000N", "%#^1000000000N"]) {
  test(`fraction allocation preflight ${format}`, async () => {
    let writes = 0;
    await assert.rejects(run("date", ["-d@0.123", "+" + format], { limits: { maxFormatWidth: Number.MAX_SAFE_INTEGER, maxOutputBytes: 16 } },
      { stdout: { async write() { writes++; } } }), { code: "EFBIG" });
    assert.equal(writes, 0);
  });
}
test("unpadded huge explicit width allocates only significant digits but respects width admission", async () => {
  const result = await run("date", ["-d@0.123", "+%-1000000000N"], { limits: { maxFormatWidth: Number.MAX_SAFE_INTEGER, maxOutputBytes: 4 } });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "123\n");
  await assert.rejects(run("date", ["-d@0.123", "+%-4097N"]), { code: "EFBIG" });
});
test("fraction budget includes preceding UTF8 bytes, every field and the newline", async () => {
  const args = ["-d@0.123", "+雪%3N|%6N"];
  const result = await run("date", args, { limits: { maxOutputBytes: 14 } });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "雪123|123000\n");
  let writes = 0;
  await assert.rejects(run("date", args, { limits: { maxOutputBytes: 13 } }, { stdout: { async write() { writes++; } } }), { code: "EFBIG" });
  assert.equal(writes, 0);
});
test("fraction modifiers and argument quotas still reject without partial publication", async () => {
  for (const format of ["%EN", "%ON", "%:N"]) {
    const result = await run("date", ["-d@0", "+prefix" + format]);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  }
  await assert.rejects(run("date", ["-d@0", "+%" + "9".repeat(100) + "N"]), { code: "EFBIG" });
  await assert.rejects(run("date", ["-d@0", "+%3N"], { limits: { maxArgumentBytes: 7 } }), { code: "EFBIG" });
});
