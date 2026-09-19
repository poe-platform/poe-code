import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "@poe-code/csvkit";

// Independently observed with the frozen CPython 3.14.2 / csvkit 2.2.0 /
// Agate 1.14.2 reference, locale C and timezone UTC. No native oracle runs here.
const cases = [
  { name: "blank cached positional row contributes no grouping cell or line number", command: "csvstack -H -g X -l", stdin: "\nx,y\n", stdout: "line_number,group\n1,X,x,y\n" },
  { name: "quoted empty cached positional cell is a real ungrouped numbered row", command: "csvstack -H -g X -l", stdin: '""\nx\n', stdout: "line_number,group,a\n1,\n2,X,x\n" },
  { name: "empty input still writes grouping header", command: "csvstack -H -g X", stdin: "", stdout: "group\n" },
  { name: "empty explicit group stays empty instead of becoming stdin basename", command: "csvstack -g ''", stdin: "a\nx\n", stdout: "group,a\n,x\n" },
  { name: "empty grouping name falls back to group", command: "csvstack -g X -n ''", stdin: "a\nx\n", stdout: "group,a\nX,x\n" },
  { name: "blank dictionary header is not inferred from later data", command: "csvstack -g X", stdin: "\nx\n", stdout: "group\n", stderr: "ValueError: dict contains fields not in fieldnames: None\n", status: 1 },
  { name: "repeated empty stdin fails only after emitting empty union header", command: "csvstack - -", stdin: "", stdout: "\n", stderr: "ValueError: I/O operation on closed file.\n", status: 1 },
  { name: "unterminated stdin header reaches EOF and permits second preflight reconfigure", command: "csvstack - -", stdin: "a", stdout: "a\n", stderr: "ValueError: I/O operation on closed file.\n", status: 1 },
  { name: "terminated empty stdin header still forbids second preflight reconfigure", command: "csvstack - -", stdin: "\n", stdout: "", stderr: "UnsupportedOperation: It is not possible to set the encoding or newline of stream after the first read\n", status: 1 },
  { name: "blank positional stdin is not replayed at repeated reference", command: "csvstack -H -g A,B - -", stdin: "\nx\n", stdout: "group\nA,x\n", stderr: "ValueError: I/O operation on closed file.\n", status: 1 },
  { name: "negative physical skip count is a no-op", command: "csvstack -K -1", stdin: "a\nx\n", stdout: "a\nx\n" },
  { name: "skipinitialspace applies to header and cells without inferring types", command: "csvstack -S", stdin: " a, b\n 01, true\n", stdout: "a,b\n01,true\n" },
  { name: "tabs overrides a conflicting explicit delimiter", command: "csvstack -t -d ';'", stdin: "a\tb\nx\ty\n", stdout: "a,b\nx,y\n" }
];

for (const item of cases) test(`csvstack user edge: ${item.name}`, async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({
    codecs: [utf8Codec],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected type inference"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  let returned = 0;
  try {
    const result = await shell.exec(item.command, { stdin: {
      async *[Symbol.asyncIterator]() {
        try { yield new TextEncoder().encode(item.stdin); }
        finally { returned++; }
      }
    } });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: item.stdout, stderr: item.stderr ?? "", status: item.status ?? 0
    });
    assert.equal(returned, 1);
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});
