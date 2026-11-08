import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

// Independently measured frozen csvkit 2.2.0, CPython 3.14.2, Unicode16,
// LC_ALL=C LANG=C TZ=UTC, UTF-8 non-TTY pipes. No canonical native oracle.
const cases = [
  {
    "name": "am without hour",
    "command": "csvsort -y0 --datetime-format '%Y-%m-%d %p'",
    "input": "d\n2024-01-01 PM\n",
    "stdout": "d\n2024-01-01T00:00:00\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "hour space",
    "command": "csvsort -y0 --datetime-format '%Y-%m-%d %H:%M'",
    "input": "d\n2024-01-01  1:02\n",
    "stdout": "d\n2024-01-01T01:02:00\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "day year missing",
    "command": "csvsort -y0 --date-format '%m-%d'",
    "input": "d\n02-29\n",
    "stdout": "d\n02-29\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "duration long s",
    "command": "csvjson -y0",
    "input": "d\n1 ſec\n",
    "stdout": "",
    "stderr": "KeyError: 'ſec'\n",
    "status": 1
  },
  {
    "name": "duration unicode case",
    "command": "csvsort -y0",
    "input": "d\n1 mİn\n2 mİn\n",
    "stdout": "d\n0:01:00\n0:02:00\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "duration 100 minutes",
    "command": "csvsort -y0",
    "input": "d\n100:00\n99:00\n",
    "stdout": "d\n100:00\n99:00\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "duration seconds overflow",
    "command": "csvsort -y0",
    "input": "d\n1:90\n1:01\n",
    "stdout": "d\n0:01:01\n0:02:30\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "date month NBSP",
    "command": "csvsort -y0",
    "input": "d\nJanuary 2 2024\nJanuary 1 2024\n",
    "stdout": "d\n2024-01-01\n2024-01-02\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "date year one",
    "command": "csvsort -y0",
    "input": "d\n0001-01-01\n0002-01-01\n",
    "stdout": "d\n2001-01-01\n2001-02-01\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "explicit fraction",
    "command": "csvjson -y0 --datetime-format '%Y-%m-%d %H:%M:%S.%f'",
    "input": "d\n2024-01-01 01:02:03.4\n",
    "stdout": "[{\"d\": \"2024-01-01T01:02:03.400000\"}]",
    "stderr": "",
    "status": 0
  },
  {
    "name": "embedded bool punctuation",
    "command": "csvjson -y0",
    "input": "d\n\"y,e,s\"\n\"n,o\"\n",
    "stdout": "[{\"d\": true}, {\"d\": false}]",
    "stderr": "",
    "status": 0
  },
  {
    "name": "zero-width bool",
    "command": "csvjson -y0",
    "input": "d\n​TRUE​\nFALSE\n",
    "stdout": "[{\"d\": \"​TRUE​\"}, {\"d\": \"FALSE\"}]",
    "stderr": "",
    "status": 0
  }
] as const;

for (const expected of cases) {
  test(`csvkit temporal user edge: ${expected.name}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(expected.input);
    await fs.writeFile("/source.csv", bytes);
    const shell = new Shell({ fs }).use(csvkitCommands({
      codecs: [utf8Codec],
      locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected numeric formatting"); } },
      clock: { now: () => 0 },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
    }));
    try {
      const result = await shell.exec(`${expected.command} source.csv`);
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: expected.stdout, stderr: expected.stderr, status: expected.status
      });
      assert.deepEqual(await fs.readFile("/source.csv"), bytes);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["source.csv"]);
    } finally { await shell.dispose(); }
  });
}

test("csvkit temporal user edge: borrowed-input long-s duration preserves hypothesis diagnostics", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
    codecs: [utf8Codec],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected numeric formatting"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  try {
    const result = await shell.exec("csvjson -y0", { stdin: "d\n1 ſec\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "KeyError: 'ſec'\n", status: 1
    });
  } finally { await shell.dispose(); }
});
