import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "poe-code/csvkit";
import reference from "../../../../docs/csvkit/csvlook-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { utilsPath: reference.warningUtilsPath }
};

for (const index of [16, 48, 50, 53, 57, 177, 178, 179, 180, 183, 190, 191]) {
  const capture = reference.cases[index]!;
  test(`csvlook user edge: reused byte fragments preserve frozen case ${index}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    let finalized = 0;
    const stdin = { async *[Symbol.asyncIterator]() {
      const fragment = new Uint8Array(1);
      try {
        for (const byte of new TextEncoder().encode(capture.stdin)) {
          fragment[0] = byte;
          yield fragment;
          fragment[0] = 0xff;
        }
      } finally { finalized++; }
    } };
    try {
      const result = await shell.exec("csvlook " + capture.argv.map(argument => "'" + argument.replaceAll("'", "'\\''") + "'").join(" "), { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: capture.stdout, stderr: capture.stderr, status: capture.status });
      assert.equal(finalized, 1);
    } finally { await shell.dispose(); }
  });
}

for (const index of [50, 57, 177, 178, 179, 180, 183, 190]) {
  const capture = reference.cases[index]!;
  test(`csvlook user edge: named input and separate redirects preserve frozen case ${index}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const source = new TextEncoder().encode(capture.stdin);
    await fs.writeFile("/work/space ' source.csv", source);
    const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
    try {
      const argv = [...capture.argv, "space ' source.csv"];
      const command = "csvlook " + argv.map(argument => "'" + argument.replaceAll("'", "'\\''") + "'").join(" ");
      const result = await shell.exec(command + " > table.md 2> errors.txt", {
        stdin: { async *[Symbol.asyncIterator]() { assert.fail("named input must not consume stdin"); yield new Uint8Array(); } }
      });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: "", stderr: "", status: capture.status });
      // CSVKit's named-file opener strips NUL and uses universal newlines;
      // the piped-stdin reference retains these controls. Independently checked
      // with the frozen csvkit 2.2.0 executable against a temporary named file.
      const stdout = index === 180 ? "| a   |\n| --- |\n| ↵\t\u001b |\n" : capture.stdout;
      assert.deepEqual(await fs.readFile("/work/table.md"), new TextEncoder().encode(stdout));
      assert.deepEqual(await fs.readFile("/work/errors.txt"), new TextEncoder().encode(capture.stderr));
      assert.deepEqual(await fs.readFile("/work/space ' source.csv"), source);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["errors.txt", "space ' source.csv", "table.md"]);
    } finally { await shell.dispose(); }
  });
}

test("csvlook user edge: overlapping precision configurations remain invocation-local", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const limited = reference.cases[28]!;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writes: Uint8Array[] = [];
  try {
    const execution = shell.exec("csvlook -y0 --max-precision 0", {
      stdin: limited.stdin,
      stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); if (writes.length === 1) { entered(); await pending; } } }
    });
    await started;
    for (const index of [16, 31, 29, 16]) {
      const capture = reference.cases[index]!;
      const result = await shell.exec("csvlook " + capture.argv.join(" "), { stdin: capture.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: capture.stdout, stderr: capture.stderr, status: capture.status });
    }
    release();
    const result = await execution;
    assert.equal(result.exitCode, limited.status);
    assert.equal(result.stderr, limited.stderr);
    assert.equal(new TextDecoder().decode(Uint8Array.from(writes.flatMap(bytes => Array.from(bytes)))), limited.stdout);
  } finally { release(); await shell.dispose(); }
});

for (const capture of [
  { value: "1e309", stdout: "|      n |\n| ------ |\n| 1E+309 |\n", stderr: "", status: 0 },
  { value: "-1e309", stdout: "|       n |\n| ------- |\n| -1E+309 |\n", stderr: "", status: 0 },
  { value: "9999999999999999999999999999.5", stdout: "", stderr: "InvalidOperation: [<class 'decimal.InvalidOperation'>]\n", status: 1 },
  { value: "123456789012345678901234567890", stdout: "", stderr: "InvalidOperation: [<class 'decimal.InvalidOperation'>]\n", status: 1 }
]) {
  test(`csvlook user edge: native Decimal boundary ${capture.value}`, async () => {
    const fs = new MemoryFileSystem();
    const input = `n\n${capture.value}\n`;
    await fs.writeFile("/source.csv", new TextEncoder().encode(input));
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      for (const command of ["csvlook -y0", "csvlook -y0 /source.csv"]) {
        const result = await shell.exec(command, { stdin: input });
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
          { stdout: capture.stdout, stderr: capture.stderr, status: capture.status });
        assert.deepEqual(await fs.readFile("/source.csv"), new TextEncoder().encode(input));
      }
    } finally { await shell.dispose(); }
  });
}
