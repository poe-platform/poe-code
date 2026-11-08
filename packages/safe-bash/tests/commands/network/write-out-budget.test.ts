import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";
import { writeOutFormat } from "../../../src/commands/network/output.js";

test("write-out counts UTF-8 literals, substitutions and escapes at the exact byte boundary", () => {
  const format = "😀%{value}%%\\n\\t\\q";
  const expected = "😀é%\n\t\\q";
  const size = Buffer.byteLength(expected);
  assert.equal(Buffer.from(writeOutFormat(format, { value: "é" }, size)).toString(), expected);
  assert.throws(() => writeOutFormat(format, { value: "é" }, size - 1), /Write-out exceeds host buffer limit/);
  assert.equal(writeOutFormat("", {}, 0).length, 0);
  assert.throws(() => writeOutFormat("a", {}, 0), /Write-out exceeds host buffer limit/);
  assert.equal(Buffer.from(writeOutFormat(format, { value: "é" }, Infinity)).toString(), expected);
});

for (const source of ["inline", "file", "stdin"] as const) {
  test(`curl bounds expanded ${source} write-out before publication`, async () => {
    const fs = await fixture();
    const format = "%{url_effective}".repeat(80);
    await fs.writeFile("/work/format", new TextEncoder().encode(format));
    const result = await run(["--write-out", source === "inline" ? format : source === "file" ? "@format" : "@-",
      `https://example.test/${"a".repeat(2048)}`], {
      fs, stdin: format, options: {
        authorize: () => true, limits: { maxBufferBytes: 4096, maxDownloadBytes: 1024 },
        async transport() {
          return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), async dispose() {} };
        },
      },
    });
    assert.equal(result.exitCode, 63);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString(), /Write-out exceeds host buffer limit/);
  });
}
