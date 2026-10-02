import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { optionalCommands, qrencodeCommands } from "../../src/lazy-optional.js";

test("QR pipelines, virtual script files and binary redirection", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs })
    .use(standardCommands())
    .use(optionalCommands({ commands: ["qrencode"] }));
  try {
    const result = await shell.exec(
      "printf 'HELLO WORLD' | qrencode -t SVG -o /qr.svg; cat /qr.svg"
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("<svg"));
    await fs.writeFile(
      "/generate.sh",
      new TextEncoder().encode("printf 'HELLO' | qrencode -t PNG32 -o - > /qr.png\n")
    );
    const script = await shell.exec("sh /generate.sh");
    assert.equal(script.exitCode, 0, script.stderr);
    assert.deepEqual(
      [...(await fs.readFile("/qr.png")).slice(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
    shell.use(qrencodeCommands());
    await assert.rejects(shell.exec("true"), /already registered/);
  } finally {
    await shell.dispose();
  }
});
