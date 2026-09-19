import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, createCsvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "@poe-code/csvkit";
import parserReference from "../../../../docs/csvkit/oracle-3.14.2.json" with { type: "json" };
import ioReference from "../../../../docs/csvkit/io-reference.json" with { type: "json" };
import scalarReference from "../../../../docs/csvkit/sql-scalar-options-reference.json" with { type: "json" };
import scalarStressReference from "../../../../docs/csvkit/sql-scalar-stress-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("actual Shell forwards host row, column and nesting admission to the shared engine", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxRows: 1, maxColumns: 1, maxFieldCharacters: 2, maxNestingDepth: 1 } }));
  try {
    const columns = await shell.exec("csvcut", { stdin: "a,too-long\n" });
    assert.deepEqual({ stdout: columns.stdout, stderr: columns.stderr, status: columns.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: column budget exceeded\n", status: 78
    });
    const rows = await shell.exec("csvcut", { stdin: "a\ntoo-long\n" });
    assert.deepEqual({ stdout: rows.stdout, stderr: rows.stderr, status: rows.exitCode }, {
      stdout: "a\n", stderr: "csvkit: unsupported or unqualified: row budget exceeded\n", status: 78
    });
    const nesting = await shell.exec("in2csv -f json", { stdin: '[{"a":{"b":}}]' });
    assert.deepEqual({ stdout: nesting.stdout, stderr: nesting.stderr, status: nesting.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: JSON nesting budget exceeded\n", status: 78
    });
  } finally { await shell.dispose(); }
});

for (const item of [...scalarReference.cases, ...scalarStressReference.cases].filter(item => item.kind !== 'SyntaxError' && item.kind !== 'list' && item.raw !== '"a" "b"' && !item.raw.includes('\\N{'))) {
  test(`actual Shell forwards frozen SQL scalar ${item.raw} to injected database`, async () => {
    const effects: unknown[] = [];
    const expected = item.kind === 'int' ? BigInt(item.value as string) : item.negativeZero ? -0 : item.value;
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, databases: [{
      schemes: ['bound'], profile: 'test-only',
      connect: async (url, settings) => {
        effects.push(['connect', url]);
        if (item.kind === 'int') {
          assert.ok(typeof settings.option === 'number' || typeof settings.option === 'bigint');
          assert.equal(BigInt(settings.option), expected);
        } else assert.equal(settings.option, expected);
        return {
          profile: 'test-only', begin: async () => { assert.fail('unexpected begin'); }, commit: async () => { assert.fail('unexpected commit'); },
          rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); },
          query: async (sql, values, settings) => {
            effects.push(['query', sql, values, { ...settings }]);
            return { columns: ['value'], rows: (async function* () { yield ['owned']; })(), close: async () => { effects.push('result-close'); } };
          }
        };
      }
    }] }));
    try {
      const argument = "'" + item.raw.split("'").join("'\\''") + "'";
      const result = await shell.exec(`sql2csv --db bound://owned --query 'select value' --engine-option option ${argument}`);
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: 'value\nowned\n', stderr: '', status: 0 });
      assert.deepEqual(effects, [['connect', 'bound://owned'], ['query', 'select value', [], { no_parameters: true, stream_results: true }], 'result-close', 'rollback', 'close']);
    } finally { await shell.dispose(); }
    assert.equal(effects.length, 5);
  });
}

test("all fourteen shell executables preserve frozen help/version/error channels and statuses", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const reference of parserReference) {
      const result = await shell.exec(`${reference.command} ${reference.argv.join(" ")}`);
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: reference.stdout, stderr: reference.stderr, status: reference.status
      }, `${reference.command} ${reference.argv.join(" ")}`);
    }
  } finally { await shell.dispose(); }
});
test("csvkit native I/O differentials use the actual shell engine and preserve input files", async () => {
  for (const item of ioReference.cases) {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const [name, text] of Object.entries(item.files)) await fs.writeFile(`/work/${name}`, new TextEncoder().encode(text));
    const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
    try {
      const result = await shell.exec([item.command, ...item.argv].join(" "), { stdin: item.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      }, `${item.command} ${item.argv.join(" ")}`);
      for (const [name, text] of Object.entries(item.files)) assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${name}`)), text);
    } finally { await shell.dispose(); }
  }
});
test("csvkit preserves all fourteen executable names and collision preflight", async () => {
  const expected = ["csvclean", "csvcut", "csvformat", "csvgrep", "csvjoin", "csvjson", "csvlook", "csvpy", "csvsort", "csvsql", "csvstack", "csvstat", "in2csv", "sql2csv"];
  assert.deepEqual(createCsvkitCommands(options).map(command => command.name), expected);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try {
    shell.commands.register({ name: "csvstat", execute: async () => ({ exitCode: 12 }) });
    assert.throws(() => csvkitCommands(options).setup(shell), /already registered/);
    assert.equal(shell.commands.has("csvcut"), false);
    shell.use(csvkitCommands({ ...options, replace: true }));
    for (const name of expected) assert.equal((await shell.exec(`${name} --version`)).stdout, `${name} 2.2.0\n`);
  } finally { await shell.dispose(); }
});
test("csvkit executes SDK operations through shell pipes, cwd and redirection", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/a b.csv", new TextEncoder().encode("a,b\nx,y\nz,w\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c b 'a b.csv' | csvgrep -c 1 -m y | csvformat -T > result.csv");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/result.csv")), "b\ny\n");
    const count = await shell.exec("csvcut 'a b.csv' | csvstat --count");
    assert.equal(count.stdout, "2\n");
  } finally { await shell.dispose(); }
});
test("help and blocked operations do not acquire stdin", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const stdin = { async *[Symbol.asyncIterator]() { assert.fail("unexpected stdin acquisition"); yield new Uint8Array(); } };
    assert.equal((await shell.exec("csvcut --help", { stdin })).exitCode, 0);
    const blocked = await shell.exec("csvsql --db sqlite:///:memory:", { stdin });
    assert.equal(blocked.exitCode, 78);
    assert.equal(blocked.stdout, "");
    assert.equal(blocked.stderr, "csvkit: unsupported or unqualified: database capability sqlite\n");
  } finally { await shell.dispose(); }
});

test("csvkit uses injected named byte streams and retains stdout before a late read error", async () => {
  const fs = new MemoryFileSystem();
  let returned = 0;
  Object.assign(fs, {
    async readFile() { assert.fail("streaming input must not use bulk readFile"); },
    async *readStream(path: string, settings: { signal: AbortSignal }) {
      assert.equal(path, "/work/input.csv");
      settings.signal.throwIfAborted();
      try {
        yield new TextEncoder().encode("a\nx\n");
        throw Object.assign(new Error("late denied read"), { code: "EACCES" });
      } finally { returned++; }
    }
  });
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut input.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "a\nx\n", stderr: "PermissionError: [Errno 13] Permission denied: 'input.csv'\n", status: 1
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

test("csvkit actual shell frozen I/O cases tolerate empty chunks and every byte boundary", async () => {
  const fragmented = (text: string) => ({ async *[Symbol.asyncIterator]() {
    yield new Uint8Array();
    for (const byte of new TextEncoder().encode(text)) {
      yield Uint8Array.of(byte);
      yield new Uint8Array();
    }
  } });
  for (const item of ioReference.cases) {
    const fs = new MemoryFileSystem();
    const files = new Map(Object.entries(item.files).map(([name, text]) => [`/work/${name}`, text]));
    const before = [...files];
    Object.assign(fs, {
      async readFile() { assert.fail("stream-capable filesystem must not bulk-read"); },
      readStream(path: string, settings: { signal: AbortSignal }) {
        settings.signal.throwIfAborted();
        assert.ok(files.has(path), `unexpected virtual path ${path}`);
        return fragmented(files.get(path)!);
      }
    });
    const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
    try {
      const result = await shell.exec([item.command, ...item.argv].join(" "), { stdin: fragmented(item.stdin) });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      }, `${item.command} ${item.argv.join(" ")}`);
      assert.deepEqual([...files], before);
    } finally { await shell.dispose(); }
  }
});

test("csvkit actual shell keeps an admitted CSV parser diagnostic when named producer cleanup fails", async () => {
  const fs = new MemoryFileSystem();
  let returned = 0;
  Object.assign(fs, {
    async readFile() { assert.fail("stream-capable filesystem must not bulk-read"); },
    readStream(path: string) {
      assert.equal(path, "/work/input.csv");
      let yielded = false;
      return { [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (yielded) return { done: true, value: undefined };
          yielded = true;
          return { done: false, value: new TextEncoder().encode("a\nxxx\n") };
        },
        return: async () => { returned++; throw new Error("producer cleanup failed"); }
      }) };
    }
  });
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -z 2 input.csv");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "a\n");
    assert.equal(result.stderr, "FieldSizeLimitError: CSV contains a field longer than the maximum length of 2 characters on line 2. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n");
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});
