import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { createPptxCommandEngine, createPresentation, comparePresentations } from "safe-bash-pptx-engine";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());
async function fixture(engineContext = context) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({
        context: engineContext,
        maxOutputBytes: 262144,
        maxArgumentBytes: 65536
      })
    })
  );
  return { shell, fs };
}


test("comparison data and status survive quoted shell scripts and stdin", async () => {
  const { shell, fs } = await fixture();
  const deck = (text: string) => createPresentation({ slides: [{ shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text }] }] }, context);
  const left = await deck("Harbor 雲");
  const right = await deck("Meadow 雲");
  await fs.writeFile("/work/left deck.pptx", left);
  await fs.writeFile("/work/right deck.pptx", right);
  await fs.writeFile("/work/compare.sh", Buffer.from("pptx diff 'left deck.pptx' 'right deck.pptx' --mode text --json\n"));
  try {
    const different = await shell.exec("sh compare.sh");
    assert.equal(different.exitCode, 1, different.stdout + different.stderr);
    const report = JSON.parse(different.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.data.equal, false);
    assert.equal(report.affected, 0);
    assert.deepEqual(report.data, await comparePresentations(left, right, { mode: "text" }, context));
    const equal = await shell.exec("pptx diff - 'left deck.pptx' --json", { stdin: toByteSource(left) });
    assert.equal(equal.exitCode, 0, equal.stdout + equal.stderr);
    assert.equal(JSON.parse(equal.stdout).data.equal, true);
    const missing = await shell.exec("pptx diff missing.pptx 'left deck.pptx' --json");
    assert.equal(missing.exitCode, 2);
    assert.equal(JSON.parse(missing.stdout).errors[0].code, "io-failure");
    const stdin = await shell.exec("pptx diff - - --json");
    assert.equal(stdin.exitCode, 2);
    assert.equal(JSON.parse(stdin.stdout).ok, false);
    assert.deepEqual(await fs.readFile("/work/left deck.pptx"), left);
    assert.deepEqual(await fs.readFile("/work/right deck.pptx"), right);
  } finally { await shell.dispose(); }
});
