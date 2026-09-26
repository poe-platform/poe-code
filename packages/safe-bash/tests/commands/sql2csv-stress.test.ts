import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, type DatabaseProvider, type DatabaseCell } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import parserReference from "../../../../docs/csvkit/oracle-3.14.2.json" with { type: "json" };

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

function fixture(columns: readonly string[] | null, rows: readonly (readonly DatabaseCell[])[]) {
  const effects: unknown[] = [];
  const fs = new MemoryFileSystem();
  const provider: DatabaseProvider = {
    profile: "sql2csv-stress-memory", schemes: ["sqlite"],
    async connect(url, options) {
      effects.push(["connect", url, { ...options }]);
      return {
        profile: "sql2csv-stress-memory",
        async begin() { assert.fail("sql2csv must not explicitly begin"); },
        async commit() { assert.fail("sql2csv must not commit"); },
        async rollback() { effects.push("rollback"); },
        async close() { effects.push("session-close"); },
        async query(sql, values, options) {
          effects.push(["query", sql, values, { ...options }]);
          return {
            columns,
            rows: { async *[Symbol.asyncIterator]() {
              assert.notEqual(columns, null, "non-row results must never acquire an iterator");
              for (const row of rows) yield row;
            } },
            async close() { effects.push("result-close"); }
          };
        }
      };
    }
  };
  return { fs, effects, shell: new Shell({ fs }).use(csvkitCommands({ ...bindings, databases: [provider] })) };
}

for (const [flags, expected] of [
  ["", "duplicate,duplicate,\n1,2,3\n4,5,6\n"],
  ["-H", "1,2,3\n4,5,6\n"],
  ["-l", "line_number,duplicate,duplicate,\n1,1,2,3\n2,4,5,6\n"],
  ["-H -l", "line_number,1,2,3\n1,4,5,6\n"]
] as const) test(`sql2csv duplicate/unnamed labels and source writer first-row behavior ${flags}`, async () => {
  const f = fixture(["duplicate", "duplicate", ""], [[1, 2, 3], [4, 5, 6]]);
  try {
    const result = await f.shell.exec(`sql2csv ${flags} --query 'SELECT labels'`);
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], [expected, "", 0]);
    assert.deepEqual(f.effects, [["connect", "sqlite://", {}], ["query", "SELECT labels", [], { no_parameters: true, stream_results: true }], "result-close", "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
  assert.equal(f.effects.length, 5, "dispose must not repeat owned cleanup");
});

test("sql2csv query overrides a missing FILE and supplied stdin; repeated options use the final value", async () => {
  const f = fixture(["value"], [["owned"]]);
  try {
    const result = await f.shell.exec("sql2csv /missing.sql --query ' SELECT 1; SELECT 2 ' --engine-option echo True --engine-option echo False --execution-option no_parameters False --execution-option no_parameters True", { stdin: "unconsumed input" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["value\nowned\n", "", 0]);
    assert.deepEqual(f.effects, [["connect", "sqlite://", { echo: false }], ["query", "SELECT 1; SELECT 2", [], { no_parameters: true, stream_results: true }], "result-close", "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
});

test("sql2csv assembles the complete query file with universal newlines and never splits SQL delimiters", async () => {
  const f = fixture(["value"], [[1]]);
  const source = "SELECT 'a;b';\r\nSELECT 2;\rSELECT 3;\n";
  await f.fs.writeFile("/query.sql", new TextEncoder().encode(source));
  try {
    const result = await f.shell.exec("sql2csv /query.sql -e UTF-8");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["value\n1\n", "", 0]);
    assert.deepEqual(f.effects[1], ["query", "SELECT 'a;b';\nSELECT 2;\nSELECT 3;\n", [], { no_parameters: true, stream_results: true }]);
    assert.deepEqual(await f.fs.readFile("/query.sql"), new TextEncoder().encode(source));
  } finally { await f.shell.dispose(); }
});

test("sql2csv non-row results produce no headers or line numbers and roll back without commit", async () => {
  const f = fixture(null, []);
  try {
    const result = await f.shell.exec("sql2csv -l --query 'UPDATE data SET value = 1'");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(f.effects.slice(2), ["result-close", "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
});

test("sql2csv forwards AUTOCOMMIT execution isolation to its injected provider without adding commit", async () => {
  const f = fixture(null, []);
  try {
    const result = await f.shell.exec("sql2csv --query 'INSERT INTO data VALUES (2)' --execution-option isolation_level AUTOCOMMIT");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(f.effects, [["connect", "sqlite://", {}], ["query", "INSERT INTO data VALUES (2)", [], { no_parameters: true, stream_results: true, isolation_level: 'AUTOCOMMIT' }], "result-close", "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
});

test("sql2csv binary and null driver cells preserve Python driver serialization", async () => {
  const f = fixture(["blob", "null", "bool", "integer"], [[new Uint8Array([0, 39, 10, 255]), null, true, 9007199254740993n]]);
  try {
    const result = await f.shell.exec("sql2csv --query 'SELECT driver_cells'");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ['blob,null,bool,integer\n"b""\\x00\'\\n\\xff""",,True,9007199254740993\n', "", 0]);
  } finally { await f.shell.dispose(); }
});

test("sql2csv acquires its connection before a missing query-file failure and cleans it without querying", async () => {
  const f = fixture(["value"], [[1]]);
  try {
    const result = await f.shell.exec("sql2csv /missing.sql");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "FileNotFoundError: [Errno 2] No such file or directory: '/missing.sql'\n", 1]);
    assert.deepEqual(f.effects, [["connect", "sqlite://", {}], "rollback", "session-close"]);
  } finally { await f.shell.dispose(); }
});

for (const flag of ["--add-bom", "--delimiter", "--snifflimit", "--no-inference", "--blanks", "--skip-lines"]) {
  test(`sql2csv rejects omitted ordinary-CSV argument ${flag} before connecting`, async () => {
    const f = fixture(["value"], [[1]]);
    const usage = parserReference.find(item => item.command === "sql2csv" && item.argv.includes("--help"))?.stdout.split("\n\n")[0];
    assert.ok(usage, "frozen sql2csv usage must be available");
    try {
      const result = await f.shell.exec(`sql2csv ${flag}`);
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", `${usage}\nsql2csv: error: unrecognized arguments: ${flag}\n`, 2]);
      assert.deepEqual(f.effects, []);
    } finally { await f.shell.dispose(); }
  });
}
