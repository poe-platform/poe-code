import assert from "node:assert/strict";
import test from "node:test";
import "../../../src/shell/sync-extra-evaluators.js";
import { standardCommands } from "../../../src/commands/index.js";
import { tsortCommands } from "../../../src/commands/tsort/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { files, nativeCases } from "./fixtures.js";

function quote(value: string): string { return `'${value.split("'").join("'\\''")}'`; }

for (const [name, input, stdout, status] of [
  ["independent roots", "z end\na end\n", "a\nz\nend\n", 0],
  ["roots before successors", "a b\nz z\n", "a\nz\nb\n", 0],
  ["reverse successors", "a b\na c\na d\n", "a\nd\nc\nb\n", 0],
  ["UTF-8 roots", "😀 end\n\uE000 end\n", "\uE000\n😀\nend\n", 0],
  ["unique order", "b c\na b\n", "a\nb\nc\n", 0],
  ["cycle fallback", "a b\nb a\n", "a\nb\n", 1],
] as const) {
  for (const command of ["tsort input", "tsort < input", "cat input | tsort", "tsort input | cat"]) {
    test(`tsort capture preserves native ordering and status: ${name}, ${command}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", new TextEncoder().encode(input));
      const shell = new Shell({ fs, cwd: "/", env: { LC_ALL: "C" } })
        .use(standardCommands()).use(tsortCommands());
      try {
        const direct = await shell.exec(`set -o pipefail; ${command}`);
        assert.equal(direct.stdout, stdout);
        assert.equal(direct.exitCode, status);
        for (const header of ["", "for i in 1 2; do", "for ((i=0;i<2;i++)); do"]) {
          const captured = await shell.exec(`set -o pipefail; ${header}
value=$(${command}); status=$?; printf '%s\\n' "$value"
${header ? "done" : ""}
exit "$status"`);
          const repetitions = header ? 2 : 1;
          assert.equal(captured.stdout, stdout.repeat(repetitions), header);
          assert.equal(captured.stderr, direct.stderr.repeat(repetitions), header);
          assert.equal(captured.exitCode, direct.exitCode, header);
        }
      } finally { await shell.dispose(); }
    });
  }
}

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
