import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import reference from "../../../../docs/csvkit/workbook-stress-reference.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  columnWarnings: { utilsPath: "/Users/kjopek/.cache/uv/archive-v0/s-e6Z1tsuHBqlXiv/lib/python3.14/site-packages/agate/utils.py" },
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 }, terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const item of reference.cases) test(`workbook reader differential ${item.name} ${item.argv.join(" ")}`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = Uint8Array.from(Buffer.from(reference.binary[item.name as keyof typeof reference.binary], "base64"));
  const path = `/book.${item.argv[1]}`;
  await fs.writeFile(path, bytes);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(`in2csv ${item.argv.join(" ")} ${path}`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
    assert.deepEqual(await fs.readFile(path), bytes);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [path.slice(1)]);
  } finally { await shell.dispose(); }
});
