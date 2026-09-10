import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { files, nativeCases } from "./fixtures.js";

function quote(value: string): string { return `'${value.split("'").join("'\\''")}'`; }

for (const fixture of nativeCases) {
  const information = ["help", "help-prefix", "version"].includes(fixture.name);
  test(`${information ? "qualified information" : "native"}: ${fixture.name}`, async () => {
    const { tsortCommands } = await import("../../../src/commands/tsort/index.js");
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const [name, hex] of Object.entries(files)) await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
    await fs.writeFile("/work/input", Buffer.from(fixture.inputBase64, "base64"));
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(tsortCommands());
    try {
      const result = await shell.exec(`tsort ${fixture.args.map(quote).join(" ")} < input`);
      if (information) {
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, fixture.name === "version" ? "tsort (virtual-bash)\n" : "Usage: tsort [OPTION] [FILE]\nWrite a topological ordering of whitespace-separated node pairs.\nWith no FILE, or FILE -, read standard input.\nOptions: --help --version\n");
      } else assert.deepEqual({ stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode }, {
        stdout: fixture.stdoutBase64, stderr: fixture.stderrBase64, status: fixture.status,
      });
    } finally { await shell.dispose(); }
  });
}
