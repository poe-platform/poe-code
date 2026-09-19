import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected output locale formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Development oracle: frozen CPython 3.14.2/csvkit 2.2.0, LC_ALL=C, LANG=C,
// TZ=UTC, UTF-8 non-TTY pipes. Canonical execution remains wholly in memory.
for (const [name, command, input, stdout] of [
  ["Boolean recognizes Python-only edge whitespace and preserves null ordering", "csvsort -y0",
    "b\n\u0085YES\u001c\n\u00a0NO\u2003\nNA\n", 'b\nFalse\nTrue\n""\n'],
  ["Boolean strips grouping commas before matching truth values", "csvsort -y0",
    'b\n"t,r,u,e"\n"f,a,l,s,e"\n', "b\nFalse\nTrue\n"],
  ["Text preserves original non-null whitespace and zero-width characters", "csvsort -y0 -I",
    'b\n"  keep  "\n"\u0085NULL\u001c"\n"\u200bNULL\u200b"\n', 'b\n  keep  \n\u200bNULL\u200b\n""\n'],
  ["Unicode null matching applies lowercase expansion rather than locale casing", "csvsort -y0 -I --null-value İ --",
    "b\nİ\ni\u0307\nI\n", 'b\nI\n""\n""\n'],
  ["frozen Unicode16 null matching does not adopt Unicode17 case pairs", "csvsort -y0 -I --null-value ꟎ --",
    "v\n꟎\n꟏\n", 'v\n꟏\n""\n'],
  ["blanks preserves empty strings, null spellings and whitespace", "csvsort -y0 -I --blanks",
    'b\n""\nNA\n"  "\nNULL\n', 'b\n""\n  \nNA\nNULL\n'],
  ["numeric date-like text remains Number without an explicit format", "csvsort -y0",
    "d\n20240229\n20231231\n", "d\n20231231\n20240229\n"],
  ["invalid leap date demotes the whole column to Text", "csvsort -y0",
    "d\n2023-02-29\n2024-02-29\n", "d\n2023-02-29\n2024-02-29\n"],
  ["implicit Date validates leap day and sorts before null", "csvsort -y0",
    "d\n2024-02-29\n2023-12-31\nNA\n", 'd\n2023-12-31\n2024-02-29\n""\n'],
  ["TimeDelta expressions sort by duration and emit Python timedelta text", "csvsort -y0",
    "d\n2h\n30m\n1:01:02\nNA\n", 'd\n0:30:00\n1:01:02\n2:00:00\n""\n'],
  ["negative TimeDelta uses normalized days and keeps microseconds", "csvsort -y0",
    "d\n-1s\n0.000001s\n1d\n", 'd\n"-1 day, 23:59:59"\n0:00:00.000001\n"1 day, 0:00:00"\n'],
  ["explicit Date format takes precedence over Number inference", "csvsort -y0 --date-format %Y%m%d",
    "d\n20240229\n20231231\n", "d\n2023-12-31\n2024-02-29\n"],
  ["explicit input locale en_US does not alter frozen strptime LC_TIME", "csvsort -y0 --locale en_US --date-format %Y%m%d",
    "d\n20240229\n", "d\n2024-02-29\n"],
  ["TimeDelta fractional seconds preserve reference binary rounding", "csvsort -y0",
    "d\n1.0000005s\n1.0000015s\n", "d\n0:00:01.000001\n0:00:01.000001\n"],
  ["TimeDelta two-field colon expressions mean minutes and seconds", "csvsort -y0",
    "d\n12:30\n1:02\n", "d\n0:01:02\n0:12:30\n"],
  ["aware DateTime sorting compares instants and retains offsets", "csvsort -y0",
    "d\n2024-01-01T00:00:00+02:00\n2023-12-31T23:00:00Z\n", "d\n2024-01-01T00:00:00+02:00\n2023-12-31T23:00:00+00:00\n"],
  ["DateTime CSV output keeps six fractional digits", "csvsort -y0",
    "d\n2024-01-01T01:02:03.000004Z\n", "d\n2024-01-01T01:02:03.000004+00:00\n"],
  ["explicit DateTime format normalizes numeric offsets", "csvsort -y0 --datetime-format '%Y-%m-%d %H:%M:%S%z'",
    "d\n2024-01-01 01:02:03+0000\n", "d\n2024-01-01T01:02:03+00:00\n"],
  ["csvformat number-only inference preserves original datetime spelling", "csvformat -U2",
    "d\n2024-01-01T01:02:03.000004Z\n", '"d"\n"2024-01-01T01:02:03.000004Z"\n'],
  ["csvjson converts typed Boolean Date TimeDelta Text and null values", "csvjson -y0",
    "b,d,t,s\nyes,2024-02-29,2h, hello \nno,2023-12-31,30m,NA\n",
    '[{"b": true, "d": "2024-02-29", "t": "2:00:00", "s": " hello "}, {"b": false, "d": "2023-12-31", "t": "0:30:00", "s": null}]'],
  ["csvjson converts mixed naive aware DateTime without comparing", "csvjson -y0",
    "d\n2024-01-01T01:02:03.000004Z\n2024-01-01T01:02:03\n",
    '[{"d": "2024-01-01T01:02:03.000004+00:00"}, {"d": "2024-01-01T01:02:03"}]'],
  ["csvjson no-inference preserves spellings while casting nulls", "csvjson -y0 -I",
    "v\nTRUE\n2024-02-29\n2h\nNA\n",
    '[{"v": "TRUE"}, {"v": "2024-02-29"}, {"v": "2h"}, {"v": null}]']
] as const) {
  test(`csvkit temporal stress: ${name}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(input);
    await fs.writeFile("/source.csv", bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`${command} source.csv`);
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout, stderr: "", status: 0
      });
      assert.deepEqual(await fs.readFile("/source.csv"), bytes);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["source.csv"]);
    } finally { await shell.dispose(); }
  });
}

test("csvkit temporal stress: mixing naive and aware DateTime refuses sorting before output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsort -y0", {
      stdin: "d\n2024-01-01T01:02:03\n2024-01-01T01:02:03Z\n"
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "TypeError: can't compare offset-naive and offset-aware datetimes\n", status: 1
    });
  } finally { await shell.dispose(); }
});

for (const [name, input, stdout] of [
  ["typed temporal and nullable columns",
    "b,d,dt,t,s,n\nyes,2024-02-29,2024-01-01T01:02:03Z,2h,hello,2\nno,2023-12-31,2024-01-01T01:02:03,30m,NA,3\n",
    "CREATE TABLE stdin (\n\tb BOOLEAN NOT NULL, \n\td DATE NOT NULL, \n\tdt TIMESTAMP, \n\tt DATETIME NOT NULL, \n\ts VARCHAR, \n\tn DECIMAL NOT NULL\n);\n"],
  ["default Number and Text columns", "a,b\n2,hello\n1,world\n",
    "CREATE TABLE stdin (\n\ta DECIMAL NOT NULL, \n\tb VARCHAR NOT NULL\n);\n"]
] as const) {
  test(`csvkit temporal stress: default SQL schema for ${name}`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      const result = await shell.exec("csvsql -y0", { stdin: input });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout, stderr: "", status: 0
      });
      assert.deepEqual(await fs.readdir("/"), []);
    } finally { await shell.dispose(); }
  });
}
