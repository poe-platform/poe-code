import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileCommands } from "../../../src/commands/file/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { fixtures } from "./fixtures.js";
import { nativeBaseline } from "./native-baseline.js";

for (const [option, expected] of [
  ["--mime-type", "application/vnd.sqlite3\n"],
  ["--mime", "application/vnd.sqlite3; charset=binary\n"],
] as const) {
  test(`SQLITE-MIME-001: actual Shell ${option} uses canonical SQLite MIME for file and stdin`, async () => {
    const specimen = fixtures.find(value => value.name === "sqlite-header")!;
    const baseline = nativeBaseline.find(value => value[0] === "sqlite-header")!;
    assert.equal(createHash("sha256").update(specimen.bytes).digest("hex"), baseline[1]);
    assert.equal(baseline[2], "application/vnd.sqlite3; charset=binary");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/catalog.txt", specimen.bytes);
    const shell = new Shell({ fs });
    shell.use(fileCommands());
    try {
      for (const input of ["/catalog.txt", "- < /catalog.txt"]) {
        const result = await shell.exec(`file -b ${option} ${input}`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
        assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(expected));
      }
      assert.deepEqual(await fs.readFile("/catalog.txt"), new Uint8Array(specimen.bytes));
    } finally { await shell.dispose(); }
  });
}
