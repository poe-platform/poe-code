import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "safe-bash-command-csvkit";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

async function check(command: string, stdin: string, stdout: string, stderr = "", status = 0, settings = options): Promise<void> {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr, status });
  } finally { await shell.dispose(); }
}

test("csvsort stress: reverse preserves duplicate tuple order and moves Agate nulls first", async () => {
  const input = "key,rank,label\n2,10,first\n,5,null-first\n2,10,second\n2,2,third\n,5,null-second\n10,1,last\n";
  await check("csvsort -y 0 -c key,rank -r", input,
    "key,rank,label\n,5,null-first\n,5,null-second\n10,1,last\n2,10,first\n2,10,second\n2,2,third\n");
});

test("csvsort stress: all-column tuples compare later fields and selected duplicate keys remain stable", async () => {
  const input = "a,b,label\n10,2,z\n2,10,c\n2,2,b\n2,2,a\n";
  await check("csvsort -y 0", input, "a,b,label\n2,2,a\n2,2,b\n2,10,c\n10,2,z\n");
  await check("csvsort -y 0 -c 1,1,2", input, "a,b,label\n2,2,b\n2,2,a\n2,10,c\n10,2,z\n");
});

test("csvsort stress: 512 original numeric rows cannot pass lexicographic sorting", async () => {
  const numbers = Array.from({ length: 512 }, (_, index) => index * 17 - 3000);
  const input = "number,label\n" + [...numbers].reverse().map(value => `${value},row${value}\n`).join("");
  const expected = "number,label\n" + numbers.map(value => `${value},row${value}\n`).join("");
  await check("csvsort -y 0 -c number", input, expected);
});

test("csvsort stress: Decimal keys retain precision beyond JavaScript Number", async () => {
  await check("csvsort -y 0 -c amount", "amount,label\n9007199254740993.01,a\n9007199254740993,b\n9007199254740992.99,c\n",
    "amount,label\n9007199254740992.99,c\n9007199254740993,b\n9007199254740993.01,a\n");
});

test("csvsort stress: Python uppercase expansion produces stable ties and codepoint ordering", async () => {
  await check("csvsort -y 0 -I -i -c word", "word,label\nß,first\nss,second\nﬃ,ligature\nffi,ascii\nı,dotless\ni,plain\nK,kelvin\nk,letter\n",
    "word,label\nﬃ,ligature\nffi,ascii\nı,dotless\ni,plain\nk,letter\nß,first\nss,second\nK,kelvin\n");
});

test("csvsort stress: frozen Unicode16 uppercase does not adopt Unicode17 case pairs", async () => {
  await check("csvsort -y 0 -I -i -c word", "word,label\n꟏,new-lowercase\n꟎,capital\n",
    "word,label\n꟎,capital\n꟏,new-lowercase\n");
});

test("csvsort stress: injected warning provenance preserves renamed headers and warning order", async () => {
  await check("csvsort -y 0 -c a_2", "a,a,\n9,10,z\n8,2,y\n", "a,a_2,c\n8,2,y\n9,10,z\n",
    '/reference/agate/utils.py:288: DuplicateColumnWarning: Column name "a" already exists in Table. Column will be renamed to "a_2".\n  warn_duplicate_column(new_value, final_value)\n/reference/agate/utils.py:272: UnnamedColumnWarning: Column 2 has no name. Using "c".\n  warn_unnamed_column(i, new_value)\n',
    0, { ...options, columnWarnings: { utilsPath: "/reference/agate/utils.py" } });
});

test("csvsort stress: missing warning provenance stays an explicit blocker; suppression is injected", async () => {
  const input = "a,a\n9,10\n8,2\n";
  await check("csvsort -y 0", input, "", "csvkit: unsupported or unqualified: Agate duplicate/unnamed column warning provenance\n", 78);
  await check("csvsort -y 0", input, "a,a_2\n8,2\n9,10\n", "", 0,
    { ...options, columnWarnings: { suppressWarnings: true } });
});

test("csvsort stress: no inference sorts text while zero-based selection chooses the actual second column", async () => {
  const input = "name,value\nx,2\ny,10\nz,1\n";
  await check("csvsort -y 0 -I --zero -c 1", input, "name,value\nz,1\ny,10\nx,2\n");
  await check("csvsort -y 0 --zero -c 1", input, "name,value\nz,1\nx,2\ny,10\n");
});

test("csvsort stress: -n exits before validating columns or inferring malformed rows", async () => {
  await check("csvsort -n --zero -c absent -y 0", "a,b\n1,2,3\n", "  0: a\n  1: b\n");
  await check("csvsort -n -H", "a,b\n", "", "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n", 1);
});

test("csvsort stress: Boolean date and duration tuple sorting normalizes every output column", async () => {
  await check("csvsort -y 0 -r -c flag,date,duration",
    "flag,date,duration,label\nno,2024-02-29,2h,a\nyes,2023-12-31,30m,b\nyes,2024-02-29,30m,c\nyes,2024-02-29,2h,d\n",
    "flag,date,duration,label\nTrue,2024-02-29,2:00:00,d\nTrue,2024-02-29,0:30:00,c\nTrue,2023-12-31,0:30:00,b\nFalse,2024-02-29,2:00:00,a\n");
});

test("csvsort stress: no-header row includes first record and tabs override the delimiter", async () => {
  await check("csvsort -H -t -d ';' -y 0 --zero -c 0 -l --add-bom", "10\tx\n2\ty\n",
    "\ufeffline_number,a,b\n1,2,y\n2,10,x\n");
});

test("csvsort stress: mutable producer buffers are owned across full materialization", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let closed = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    const bytes = new Uint8Array(64);
    try {
      for (const fragment of ["key,label\n", "10,first\n", "2,second\n", "2,third\n"]) {
        const encoded = new TextEncoder().encode(fragment);
        bytes.set(encoded);
        yield bytes.subarray(0, encoded.length);
        bytes.fill(120);
      }
    } finally { closed++; }
  } };
  try {
    const result = await shell.exec("csvsort -y 0 -c key", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "key,label\n2,second\n2,third\n10,first\n", stderr: "", status: 0
    });
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvsort stress: named virtual input and redirected output preserve source bytes", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const input = "key,label\n10,x\n2,y\n2,z\n";
  await fs.writeFile("/work/source.csv", new TextEncoder().encode(input));
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsort -y 0 -c key source.csv > sorted.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "", stderr: "", status: 0 });
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/source.csv")), input);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/sorted.csv")), "key,label\n2,y\n2,z\n10,x\n");
  } finally { await shell.dispose(); }
});
