import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { nativeCases } from "./native-cases.js";

for (const fixture of nativeCases) {
  test(`native saved UTF-8 script ${fixture.locale}: ${fixture.name}`, async () => {
    const fs = new MemoryFileSystem();
    const source = Buffer.from(fixture.script);
    assert.equal(new TextDecoder("utf8", { fatal: true }).decode(source), fixture.script);
    await fs.writeFile("/review.sh", source);
    await fs.writeFile("/sentinel", Uint8Array.of(0, 128, 255));
    const shell = new Shell({ fs, env: { LC_ALL: fixture.locale, TZ: "UTC" } });
    shell.commands.register(printfCommand);
    try {
      const result = await shell.exec("sh /review.sh");
      assert.equal(result.exitCode, fixture.status, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
      assert.equal(Buffer.from(result.stderrBytes).toString("hex"), fixture.stderrHex);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["review.sh", "sentinel"]);
      assert.deepEqual(Buffer.from(await fs.readFile("/review.sh")), source);
      assert.deepEqual(await fs.readFile("/sentinel"), Uint8Array.of(0, 128, 255));
    } finally { await shell.dispose(); }
  });
}
