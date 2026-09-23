import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createCsvkitCommands, csvkitCommands } from "../../src/commands/csvkit/index.js";
import reference from "../../../../docs/csvkit/csvformat-reference.json" with { type: "json" };

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const [index, capture] of reference.cases.entries()) {
  const expected = { status: capture.status, stdout: capture.stdout, stderr: capture.stderr };
  test(`request stress: csvformat direct argv frozen case ${index} owns recycled Buffer bytes`, async () => {
    const command = createCsvkitCommands({ ...bindings,
      ...(capture.stderr.includes("DuplicateColumnWarning") ? {
        columnWarnings: { utilsPath: capture.stderr.slice(0, capture.stderr.indexOf(":288:")) }
      } : {})
    }).find(command => command.name === "csvformat")!;
    const cleanups: (() => void | Promise<void>)[] = [];
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    let finalized = 0;
    const storage = Buffer.alloc(3, 120);
    const stdin = { async *[Symbol.asyncIterator]() {
      try {
        for (const byte of new TextEncoder().encode(capture.stdin)) {
          storage[1] = byte;
          yield storage.subarray(1, 2);
          storage.fill(120);
          yield new Uint8Array();
        }
      } finally { storage.fill(0xff); finalized++; }
    } };
    try {
      const result = await command.execute({ command: "csvformat", args: capture.argv,
        cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
        stdin, stdinIsDefault: false,
        stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
        stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
        registerCleanup: cleanup => { cleanups.push(cleanup); }
      });
      assert.deepEqual({ status: result.exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") },
      expected);
      assert.deepEqual(Buffer.concat(stdout), Buffer.from(expected.stdout));
      assert.deepEqual(Buffer.concat(stderr), Buffer.from(expected.stderr));
      assert.equal(finalized, 1);
    } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
    assert.equal(finalized, 1, "registered cleanup must not finalize borrowed input twice");
  });
}

test("request stress: csvformat frozen case 9 preserves native numeric float serialization through Shell", async () => {
  const capture = reference.cases[9]!;
  assert.equal(capture.command, "csvformat");
  assert.deepEqual(capture.argv, ["-u", "2"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("csvformat -u 2", { stdin: capture.stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: capture.status, stdout: capture.stdout, stderr: capture.stderr
    });
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(capture.stdout));
    assert.deepEqual(result.stderrBytes, new TextEncoder().encode(capture.stderr));
  } finally { await shell.dispose(); }
});

test("request stress: string-only typed quoting modes execute from immutable VFS scripts", async () => {
  for (const mode of [2, 4, 5]) {
    const fs = new MemoryFileSystem();
    const input = new TextEncoder().encode('"name","amount"\n"界é","001"\n');
    const script = new TextEncoder().encode(`csvformat -u ${mode} /data.csv > /formatted.csv 2> /errors.txt\n`);
    await fs.writeFile("/data.csv", input);
    await fs.writeFile("/check.sh", script);
    const shell = new Shell({ fs }).use(csvkitCommands(bindings));
    try {
      const result = await shell.exec("sh /check.sh");
      assert.deepEqual({ stdout: result.stdoutBytes, stderr: result.stderrBytes, status: result.exitCode }, {
        stdout: new Uint8Array(), stderr: new Uint8Array(), status: 0
      });
      assert.deepEqual(await fs.readFile("/formatted.csv"), new TextEncoder().encode("name,amount\n界é,001\n"));
      assert.deepEqual(await fs.readFile("/errors.txt"), new Uint8Array());
      assert.deepEqual(await fs.readFile("/data.csv"), input);
      assert.deepEqual(await fs.readFile("/check.sh"), script);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["check.sh", "data.csv", "errors.txt", "formatted.csv"]);
    } finally { await shell.dispose(); }
  }
});

test("request stress: quoted expansion and piped raw data keep BOM, NUL and multibyte bytes", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("column='na me'; csvcut --add-bom -c \"$column\",amount | csvgrep -c \"$column\" -m 'A' | csvsort -I -y 0 -c amount | csvformat -T", {
      stdin: "\ufeffna me,amount,extra\nA😀\0,02,z\nB,01,x\nAé,01,y\n"
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "na me\tamount\nAé\t01\nA😀\0\t02\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});
