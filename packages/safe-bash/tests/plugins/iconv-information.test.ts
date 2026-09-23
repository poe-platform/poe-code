import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { iconvCommands } from "../../src/commands/iconv/index.js";

for (const flags of [["--list", "-l"], ["--help", "-?"], ["--version", "-V"], ["--usage"]]) {
  test(`iconv information succeeds without conversion: ${flags.join(", ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/output", new TextEncoder().encode("preserved"));
    const shell = new Shell({ fs, env: { LC_ALL: "unsupported" } }).use(iconvCommands());
    try {
      let previous: string | undefined;
      for (const flag of flags) {
        const result = await shell.exec(`iconv -o output ${flag} missing`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.ok(result.stdout.length > 0);
        if (previous) assert.equal(result.stdout, previous);
        previous = result.stdout;
        if (flag.includes("version") || flag === "-V") {
          assert.ok(result.stdout.includes("safe-bash"));
          assert.ok(!result.stdout.includes("GLIBC"));
        }
        if (flag.includes("list") || flag === "-l") {
          const names = result.stdout.trim().split("\n").map(name => name.slice(0, -2));
          assert.ok(names.includes("UTF-16BE"));
          assert.ok(!names.includes("SHIFT_JIS"));
          for (const name of names) {
            const conversion = await shell.exec(`iconv -f ${name} -t UTF-8`, { stdin: Uint8Array.of(65, 0) });
            assert.ok(!conversion.stderr.includes("unsupported encoding"), name);
          }
        }
      }
      assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "preserved");
      const operand = await shell.exec("iconv -f ASCII -t UTF-8 -- --list");
      assert.equal(operand.exitCode, 1);
      assert.ok(operand.stderr.includes("--list"));
    } finally { await shell.dispose(); }
  });
}
