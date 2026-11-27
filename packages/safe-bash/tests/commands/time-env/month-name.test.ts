import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("Shell date accepts month-name dates and its default UTC output", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("date -u -d 'Jan 5 2024' +%F; date -u -d '5 Jan 2024' +%F; date -u -d '5-Jan-2024' +%F; date -u -d 'January 5, 2024 3pm' +%FT%T; date -u -d 'Fri Jan  5 10:20:30 UTC 2024' +%s");
    assert.equal(result.stdout, "2024-01-05\n2024-01-05\n2024-01-05\n2024-01-05T15:00:00\n1704450030\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const roundTrip = await shell.exec('stamp=$(date -u -d @1704450030); date -u -d "$stamp" +%s');
    assert.equal(roundTrip.stdout, "1704450030\n");
    assert.equal(roundTrip.stderr, "");
    assert.equal(roundTrip.exitCode, 0);
  } finally { await shell.dispose(); }
});
