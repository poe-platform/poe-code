import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { csvgrepCommands } from "../../src/commands/csvgrep/index.js";

test("independent csvgrep pipeline status and negative authority controls", async (t) => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(csvgrepCommands());
  t.after(() => shell.dispose());
  const bytes = new TextEncoder().encode("x\na\n");
  await fs.writeFile("/input", bytes);
  await fs.writeFile("/sentinel", new TextEncoder().encode("unchanged"));
  for (const pipefail of [false, true]) {
    for (const [flags, status, output, error] of [
      ["-cx -mz", 0, "x\n", ""],
      ["-cx -r'('", 1, "", "error: missing ), unterminated subpattern at position 0\n"],
      // Candidate diagnostic profile; native argparse bytes are unqualified.
      ["-cx --unknown", 2, "", "error: Unsupported option --unknown\n"]
    ] as const) {
      const result = await shell.exec(`${pipefail ? "set -o pipefail; " : "set +o pipefail; "}csvgrep ${flags} /input | cat`);
      assert.equal(result.exitCode, pipefail ? status : 0);
      assert.equal(result.stdout, output);
      assert.equal(result.stderr, error);
    }
  }
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("network forbidden"); });
  const missing = await shell.exec("csvgrep -cx -f /etc/csvgrep-control /input");
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "");
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await fs.readFile("/input"), bytes);
  assert.deepEqual(await fs.readFile("/sentinel"), new TextEncoder().encode("unchanged"));
});
