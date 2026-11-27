import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem, agentCommands, Shell } from "../../../src/index.js";
import { run } from "./helpers.js";

test("date accepts multiple relative items, attached units and abbreviations", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("date -u -d '2024-01-05 + 3 days 2 hours' +%FT%T; date -u -d '2024-01-05 +1 day +1 day' +%F; date -u -d '2024-01-05 1 day ago 2 hours ago' +%FT%T; date -u -d '2024-01-05 -3days' +%F; date -u -d '2024-01-05 1 sec' +%T; date -u -d '2024-01-05 +1 Day' +%F; date -u -d '-1day' >/dev/null; echo $?; date -u -d '10 min ago' >/dev/null; echo $?");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "2024-01-08T02:00:00\n2024-01-07\n2024-01-03T22:00:00\n2024-01-02\n00:00:01\n2024-01-06\n0\n0\n");
  } finally { await shell.dispose(); }
});

for (const [input, expected] of [
  ["2024-01-05 + 3 days 2 hours", "2024-01-08T02:00:00"],
  ["2024-01-05 +1 day +1 day", "2024-01-07T00:00:00"],
  ["2024-01-05 1 day ago 2 hours ago", "2024-01-03T22:00:00"],
  ["2024-01-05 -3days", "2024-01-02T00:00:00"],
  ["2024-01-05 1 sec", "2024-01-05T00:00:01"],
  ["2024-01-05 +1 Day", "2024-01-06T00:00:00"],
  ["-1day", "2024-01-04T12:34:56"],
  ["10 min ago", "2024-01-05T12:24:56"],
] as const) {
  test(`async date relative items: ${input}`, async () => {
    const result = await run("date", ["-u", "-d", input, "+%FT%T"], { clock: () => Date.parse("2024-01-05T12:34:56Z") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${expected}\n`);
  });
}
