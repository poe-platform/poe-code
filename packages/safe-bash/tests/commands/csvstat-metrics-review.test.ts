import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import original from "../../../../docs/csvkit/csvstat-user-reference.json" with { type: "json" };
import reference from "../../../../docs/csvkit/csvstat-reference.json" with { type: "json" };
import review from "../../../../docs/csvkit/csvstat-metrics-review-reference.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

async function observe(stdin: string, argv: readonly string[]) {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({
    codecs: [utf8Codec],
    locale: { profile: "C", timezone: "UTC", formatNumber(value, locale, format, grouping) {
      assert.equal(locale, "C");
      const result = (reference.formats as Record<string, string>)[JSON.stringify([format, value, grouping])];
      assert.notEqual(result, undefined, `unmeasured formatting ${format} ${value} ${grouping}`);
      return result!;
    } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  try {
    const command = ["csvstat", ...argv].map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" ");
    const result = await shell.exec(command, { stdin });
    assert.deepEqual(await fs.readdir("/"), [], "metrics must not create filesystem effects");
    return { stdout: result.stdout, stderr: result.stderr, status: result.exitCode };
  } finally { await shell.dispose(); }
}

for (const [index, item] of [...reference.cases, ...original.cases].entries()) {
  test(`csvstat independent sensitive original regression ${index}`, async () => {
    assert.deepEqual(await observe(item.stdin, item.argv), {
      stdout: item.stdout, stderr: item.stderr, status: item.status
    });
  });
}

for (const [index, item] of review.cases.entries()) {
  test(`csvstat independent freshly measured percentile/zero regression ${index}`, async () => {
    assert.deepEqual(await observe(item.stdin, item.argv), {
      stdout: item.stdout, stderr: item.stderr, status: item.status
    });
  });
}
