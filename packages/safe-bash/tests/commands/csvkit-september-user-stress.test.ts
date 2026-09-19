import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvkit user dialect roundtrips preserve literal escape characters, quotes, multiline and UTF-8 cells", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(bindings));
  const inputs = [
    'name,value\n"A, B","say ""hi"""\n',
    'name,value\n"A\nB",~literal~\n',
    'name,value\nA\tB,😀é\n',
    'name,value\nA\u001fB,\u001e\n',
    'name,value\nA\0B,\n',
    'name,value\nA;B,q\'r\n'
  ];
  try {
    for (const input of inputs) {
      for (const command of [
        "csvformat -T | csvcut -t",
        "csvformat -D ';' -Q \"'\" -B -P '~' | csvcut -d ';' -q \"'\" -b -p '~'",
        "csvformat -U 3 -P '~' | csvcut -u 3 -p '~'"
      ]) {
        const result = await shell.exec(command, { stdin: input });
        assert.deepEqual({ status: result.exitCode, stdout: result.stdoutBytes, stderr: result.stderr }, {
          status: 0, stdout: new TextEncoder().encode(input), stderr: ""
        }, `${command}: ${JSON.stringify(input)}`);
      }
    }
  } finally { await shell.dispose(); }
});

test("csvclean quoted filename label and redirected diagnostics preserve owned VFS inputs without legacy side files", async () => {
  const fs = new MemoryFileSystem();
  const filename = '/one, "two".csv';
  const input = new TextEncoder().encode('name,amount\n"A\nB"\nC,02\n');
  await fs.writeFile(filename, input);
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("file='/one, \"two\".csv'; csvclean --length-mismatch --label - \"$file\" 2>/errors.csv | csvgrep -c name -m C");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "name,amount\nC,02\n", stderr: ""
    });
    assert.deepEqual(await fs.readFile(filename), input);
    assert.equal(new TextDecoder().decode(await fs.readFile('/errors.csv')),
      'label,line_number,msg,name,amount\n"/one, ""two"".csv",2,"Expected 2 columns, found 1 columns","A\nB"\n');
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['errors.csv', 'one, "two".csv']);
  } finally { await shell.dispose(); }
});
