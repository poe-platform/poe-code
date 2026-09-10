import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { handoffCases, handoffFiles } from "./handoff-cases.js";

const supportedCases = [
  ...handoffCases.filter(fixture => fixture.name !== "brace-replay-declare-assignment"),
  { name: "export-brace-assignment", script: "raw=$'\\200'; export value={left,right}\"$raw\"; printf '%s\\000' \"$value\"\n", status: 0, stdoutHex: "72696768748000", stderrHex: "" },
  { name: "plain-brace-assignment", script: "raw=$'\\200'; value={left,right}\"$raw\"; printf '%s\\000' \"$value\"\n", status: 0, stdoutHex: "7b6c6566742c72696768747d8000", stderrHex: "" },
];

for (const fixture of supportedCases) {
  test(`native raw handoff after yield: ${fixture.name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const [name, source] of Object.entries(handoffFiles)) {
      await fs.writeFile(`/work/${name}`, Buffer.from(source), { mode: 0o755 });
    }
    await fs.writeFile("/work/review.sh", Buffer.from(fixture.script));
    await fs.writeFile("/work/sentinel", Uint8Array.of(128, 255, 0));
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" } }).use(agentCommands());
    let yields = 0;
    shell.use(async (_context, next) => { yields++; await setImmediate(); return next(); });
    try {
      const result = await shell.exec("sh review.sh");
      assert.ok(yields > 0);
      assert.equal(result.exitCode, fixture.status, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
      assert.equal(Buffer.from(result.stderrBytes).toString("hex"), fixture.stderrHex);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["child.sh", "env-child.sh", "review.sh", "sentinel"]);
      assert.deepEqual(await fs.readFile("/work/sentinel"), Uint8Array.of(128, 255, 0));
      for (const [name, source] of Object.entries(handoffFiles)) {
        assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString(), source);
      }
    } finally { await shell.dispose(); }
  });
}

test("plain declare assignment is explicitly outside the supported declaration profile", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("raw=X; declare value={left,right}\"$raw\"; printf '%s' \"$value\"");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutBytes.length, 0);
    assert.ok(result.stderr.includes("declare: only -A NAME is supported"));
  } finally { await shell.dispose(); }
});
