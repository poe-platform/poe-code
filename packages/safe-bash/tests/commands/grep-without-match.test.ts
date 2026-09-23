import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const command of ["grep", "egrep", "fgrep"]) {
  for (const flag of ["-L", "--files-without-match", "-Lv", "-Lo", "-LZ", "-Lq"]) {
    for (const [label, input, selected] of [
      ["matching", "x\n", true],
      ["nonmatching", "y\n", false],
      ["empty", "", false],
      ["mixed", "x\ny\n", true],
    ] as const) {
      test(`${command} ${flag} status follows selected lines: ${label}`, async () => {
        const fs = createMemoryFileSystem();
        await fs.writeFile("/input", Buffer.from(input));
        const shell = new Shell({ fs }).use(agentCommands());
        try {
          const hasSelected = flag === "-Lv" ? input.includes("y") : selected;
          const result = await shell.exec(`${command} ${flag} x input`);
          assert.equal(result.exitCode, hasSelected ? 0 : 1, result.stderr);
          assert.equal(result.stdout, hasSelected || flag === "-Lq" ? "" : "input" + (flag === "-LZ" ? "\0" : "\n"));
          assert.equal(result.stderr, "");
        } finally { await shell.dispose(); }
      });
    }
  }
  test(`${command} -L aggregates selection independently of printed filenames`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/matching", Buffer.from("x\n"));
    await fs.writeFile("/nonmatching", Buffer.from("y\n"));
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      for (const files of ["matching nonmatching", "nonmatching matching"]) {
        const result = await shell.exec(`${command} -L x ${files}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "nonmatching\n");
        assert.equal(result.stderr, "");
      }
      const failed = await shell.exec(`${command} -L x matching missing`);
      assert.equal(failed.exitCode, 2);
      assert.equal(failed.stdout, "");
      assert.ok(failed.stderr.includes("missing"));
      const quiet = await shell.exec(`${command} -Lq x missing matching`);
      assert.equal(quiet.exitCode, 0);
      assert.equal(quiet.stdout, "");
    } finally { await shell.dispose(); }
  });
}
