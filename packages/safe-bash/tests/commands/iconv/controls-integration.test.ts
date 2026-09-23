import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";
import { Shell } from "../../../src/shell/index.js";
import { iconvCommands } from "../../../src/commands/iconv/index.js";

for (const flag of ["-s", "--silent", "-cs", "-sc"]) {
  test(`iconv accepts ${flag} without changing converted bytes`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/source", new TextEncoder().encode("Changed café\n"));
    const result = await run([flag, "-f", "UTF-8", "-t", "UTF-16BE", "source"], new Uint8Array(), {}, { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutHex, "004300680061006e006700650064002000630061006600e9000a");
    assert.equal(result.stderrHex, "");
  });
}

test("verbose reports each input operand in order, excluding implicit stdin", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Uint8Array.of(97));
  await fs.writeFile("/second", Uint8Array.of(98));
  const result = await run(["--verbose", "-s", "first", "-", "second"], Uint8Array.of(99), {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutHex, "616362");
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "first:\nsecond:\n");
  const stdin = await run(["--verbose"], Uint8Array.of(99));
  assert.equal(stdin.stdoutHex, "63");
  assert.equal(stdin.stderrHex, "");
});

test("silent preserves fatal conversion diagnostics, failure status and prefix", async () => {
  for (const flag of ["-s", "--silent"]) {
    for (const input of [Uint8Array.of(65, 255), Uint8Array.of(65, 195), Uint8Array.of(65, 195, 169)]) {
      const result = await run([flag, "-f", "UTF-8", "-t", "ASCII"], input);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdoutHex, "41");
      const normal = await run(["-f", "UTF-8", "-t", "ASCII"], input);
      assert.equal(result.stderrHex, normal.stderrHex);
    }
  }
});

test("Shell executes silent and verbose controls with output-file conversion", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/source", new TextEncoder().encode("Changed café\n"));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(iconvCommands());
  try {
    const result = await shell.exec("iconv --silent --verbose -f UTF-8 -t UTF-16BE -o result source");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "source:\n");
    assert.equal(Buffer.from(await fs.readFile("/result")).toString("hex"), "004300680061006e006700650064002000630061006600e9000a");
  } finally { await shell.dispose(); }
});

test("silent preserves file errors and controls reject values", async () => {
  const missing = await run(["--silent", "missing"]);
  assert.equal(missing.exitCode, 1);
  assert.match(Buffer.from(missing.stderrHex, "hex").toString(), /cannot open input file/);
  for (const flag of ["--silent=yes", "--verbose=yes"]) {
    assert.equal((await run([flag])).exitCode, 64);
  }
});
