import assert from "node:assert/strict";
import test from "node:test";
import { execute, fixture } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

for (const flags of [["-p"], ["--paths"], ["-pp"], ["-jp"], ["-pj"]]) {
  test(`zip paths compatibility flag ${flags} preserves native junk-path precedence`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-q", ...flags, "out.zip", "folder/data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), [flags[0]!.includes("j") ? "data" : "folder/data"]);
  });
}

test("zip paths defaults from ZIPOPT do not override explicit junk paths", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qj", "out.zip", "folder/data"], {}, { env: { ZIPOPT: "--paths" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await execute("unzip", fs, ["-p", "out.zip", "data"])).exitCode, 0);
});
for (const flag of ["-p-", "--paths-", "--paths=value"]) {
  test(`zip rejects invalid paths option form ${flag} before publication`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-q", flag, "out.zip", "folder/data"]);
    assert.equal(result.exitCode, 16, result.stderr);
    assert.equal((await fs.readdir("/work")).some(entry => entry.name === "out.zip"), false);
  });
}
