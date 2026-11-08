import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

const native = JSON.parse(readFileSync(new URL("./date-native.json", import.meta.url), "utf8")) as {
  cases: { filter: string; stdin: string; expected: { exitCode: number; stdout: string; stderr: string } }[];
};
for (const row of native.cases) {
  test(`jq native ${row.filter}: ${row.stdin.trim()}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(`jq -c '${row.filter}'`, { stdin: row.stdin });
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, row.expected);
    } finally { await shell.dispose(); }
  });
}
