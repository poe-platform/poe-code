import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { utf8Codec, databaseDialects, type DatabaseDialectDescriptor, type DatabaseProvider } from "safe-bash-command-csvkit";

function fixture(databases: readonly DatabaseProvider[] = [], sqlDialects: readonly DatabaseDialectDescriptor[] = []) {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({
    codecs: [utf8Codec], databases, sqlDialects,
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  return { fs, shell };
}

// Independently captured csvkit 2.2.0 / agate-sql 0.7.3 / SQLAlchemy 2.0.54.
// This profile's Boolean types do not create CHECK constraints.
const quotingCases = [
  { dialect: "", open: '"', close: '"', text: "VARCHAR", boolean: "BOOLEAN" },
  { dialect: "mssql", open: "[", close: "]", text: "VARCHAR(max)", boolean: "BIT" },
  { dialect: "mysql", open: "`", close: "`", text: "VARCHAR", boolean: "BOOL" },
  { dialect: "oracle", open: '"', close: '"', text: "VARCHAR", boolean: "BOOLEAN" },
  { dialect: "postgresql", open: '"', close: '"', text: "VARCHAR", boolean: "BOOLEAN" },
  { dialect: "sqlite", open: '"', close: '"', text: "VARCHAR", boolean: "BOOLEAN" }
] as const;

for (const profile of quotingCases) {
  test(`csvsql schema independent ${profile.dialect || "generic"} exact quoted names, schema and UNIQUE order`, async () => {
    const { shell } = fixture();
    const q = (name: string) => profile.open + name + profile.close;
    const text = (length: number) => profile.text + (profile.dialect === "mysql" ? `(${length})` : "");
    try {
      const result = await shell.exec(`csvsql -y 0 ${profile.dialect ? `-i ${profile.dialect}` : ""} --tables select --db-schema 123 --unique-constraint 'select,é'`, {
        stdin: "select,é,123,flag\nxx,漢,z,true\ny,ß,z,false\n"
      });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [
        `CREATE TABLE ${q("123")}.${q("select")} (\n\t${q("select")} ${text(2)} NOT NULL, \n\t${q("é")} ${text(1)} NOT NULL, \n\t${q("123")} ${text(1)} NOT NULL, \n\tflag ${profile.boolean} NOT NULL, \n\tUNIQUE (${q("select")}, ${q("é")})\n);\n`, "", 0
      ]);
    } finally { await shell.dispose(); }
  });
}

const temporalCases = [
  { dialect: "", number: "DECIMAL", date: "date", datetime: "TIMESTAMP", interval: "DATETIME" },
  { dialect: "mssql", number: "DECIMAL(38, 2)", date: "date", datetime: "DATETIME NULL", interval: "DATETIME" },
  { dialect: "mysql", number: "DECIMAL(38, 2)", date: "date", datetime: "TIMESTAMP NULL", interval: "DATETIME" },
  { dialect: "oracle", number: "DECIMAL(38, 2)", date: '"date"', datetime: "TIMESTAMP", interval: "INTERVAL DAY TO SECOND" },
  { dialect: "postgresql", number: "DECIMAL", date: "date", datetime: "TIMESTAMP WITHOUT TIME ZONE", interval: "INTERVAL" },
  { dialect: "sqlite", number: "FLOAT", date: "date", datetime: "TIMESTAMP", interval: "DATETIME" }
] as const;

for (const profile of temporalCases) {
  test(`csvsql schema independent ${profile.dialect || "generic"} precision, timestamp nullability and interval representation`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`csvsql -y 0 ${profile.dialect ? `-i ${profile.dialect}` : ""}`, {
        stdin: "n,date,datetime,duration\n1.20,2020-01-01,2020-01-01T01:02:03,1:02:03\n100.01,2020-02-01,2020-02-01T01:02:03,2:03:04\n"
      });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [
        `CREATE TABLE stdin (\n\tn ${profile.number} NOT NULL, \n\t${profile.date} DATE NOT NULL, \n\tdatetime ${profile.datetime}, \n\tduration ${profile.interval} NOT NULL\n);\n`, "", 0
      ]);
    } finally { await shell.dispose(); }
  });
}

test("csvsql schema independent nullable text and duplicate unique columns preserve exact declaration", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("csvsql -i sqlite -y 0 --unique-constraint flag,flag", { stdin: "flag,optional\ntrue,\nfalse,x\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["CREATE TABLE stdin (\n\tflag BOOLEAN NOT NULL, \n\toptional VARCHAR, \n\tUNIQUE (flag)\n);\n", "", 0]);
  } finally { await shell.dispose(); }
});

test("csvsql schema independent mysql threshold counts Unicode code points and falls back to TEXT", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("csvsql -i mysql -I -y 0", { stdin: `edge,large\n${"漢".repeat(21844)},${"😀".repeat(21845)}\n` });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["CREATE TABLE stdin (\n\tedge VARCHAR(21844) NOT NULL, \n\tlarge TEXT NOT NULL\n);\n", "", 0]);
  } finally { await shell.dispose(); }
});

test("csvsql schema independent missing UNIQUE column reports exact error without stdout", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("csvsql -y 0 --unique-constraint missing", { stdin: "a\nx\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "ConstraintColumnNotFoundError: Can't create UniqueConstraint on table 'stdin': no column named 'missing' is present.\n", 1]);
  } finally { await shell.dispose(); }
});

test("csvsql schema independent mysql constraints off keeps the original VARCHAR compilation error", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("csvsql -i mysql -y 0 --no-constraints", { stdin: "text,number,boolean\nx,1.20,true\ny,100.01,false\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "CompileError: (in table 'stdin', column 'text'): VARCHAR requires a length on dialect mysql\n", 1]);
  } finally { await shell.dispose(); }
});

test("csvsql schema length flags affect injected database creation while schema-only ignores them", async () => {
  const effects: string[] = [];
  const databases: DatabaseProvider[] = [{ schemes: ["mysql"], profile: "independent-schema-capture", async connect() {
    effects.push("connect");
    return {
      profile: "independent-schema-capture", dialect: "mysql",
      async begin() { effects.push("begin"); },
      async query(sql) { effects.push(sql); return { columns: null, rows: (async function* () {})(), async close() { effects.push("result-close"); } }; },
      async commit() { effects.push("commit"); }, async rollback() { effects.push("rollback"); }, async close() { effects.push("close"); }
    };
  } }];
  const { shell } = fixture(databases);
  try {
    const schema = await shell.exec("csvsql -i mysql -y 0 --min-col-len 10 --col-len-multiplier 3", { stdin: "a\nxx\ny\n" });
    assert.deepEqual([schema.stdout, schema.stderr, schema.exitCode], ["CREATE TABLE stdin (\n\ta VARCHAR(2) NOT NULL\n);\n", "", 0]);
    assert.deepEqual(effects, []);
    const inserted = await shell.exec("csvsql --db mysql:// -y 0 --min-col-len 10 --col-len-multiplier 3", { stdin: "a\nxx\ny\n" });
    assert.deepEqual([inserted.stdout, inserted.stderr, inserted.exitCode], ["", "", 0]);
    assert.deepEqual(effects, ["connect", "begin", "\nCREATE TABLE stdin (\n\ta VARCHAR(10) NOT NULL\n)\n\n", "result-close", "commit", "close"]);
  } finally { await shell.dispose(); }
});

for (const huge of ["1e309", "1e400", "-1e400"]) {
  test(`csvsql schema independent MaxPrecision skips Decimal values converting to binary infinity: ${huge}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec("csvsql -i mysql -y 0", { stdin: `n\n${huge}\n2.34\n` });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["CREATE TABLE stdin (\n\tn DECIMAL(38, 2) NOT NULL\n);\n", "", 0]);
    } finally { await shell.dispose(); }
  });
}

for (const [value, scale] of [["1e308", -281], ["1e-400", 27]] as const) {
  test(`csvsql schema independent MaxPrecision keeps binary64-finite Decimal: ${value}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec("csvsql -i mysql -y 0", { stdin: `n\n${value}\n2.34\n` });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [`CREATE TABLE stdin (\n\tn DECIMAL(38, ${scale}) NOT NULL\n);\n`, "", 0]);
    } finally { await shell.dispose(); }
  });
}

for (const supplied of [false, true]) {
  test(`csvsql actual shell optional compiler profile ${supplied ? "supplied" : "absent"} retains exact effects`, async () => {
    const effects: string[] = [];
    const custom = { ...databaseDialects.find(dialect => dialect.default)!, name: "optional", default: false, textType: "CUSTOM_TEXT" };
    const databases: DatabaseProvider[] = [{ schemes: ["optional"], profile: "synthetic-optional-port", async connect() {
      effects.push("connect");
      return {
        profile: "synthetic-optional-port", dialect: "optional",
        async begin() { effects.push("begin"); },
        async query(sql) { effects.push(sql); return { columns: null, rows: (async function* () {})(), async close() { effects.push("result-close"); } }; },
        async commit() { effects.push("commit"); }, async rollback() { effects.push("rollback"); }, async close() { effects.push("close"); }
      };
    } }];
    const { shell } = fixture(databases, supplied ? [custom] : []);
    try {
      const result = await shell.exec("csvsql --db optional:// -y 0", { stdin: "text\nhello\n" });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], supplied ? ["", "", 0]
        : ["", "csvkit: unsupported or unqualified: database DDL dialect metadata\n", 78]);
      assert.deepEqual(effects, supplied
        ? ["connect", "begin", "\nCREATE TABLE stdin (\n\ttext CUSTOM_TEXT NOT NULL\n)\n\n", "result-close", "commit", "close"]
        : ["connect", "begin", "rollback", "close"]);
    } finally { await shell.dispose(); }
  });
}

test("csvsql actual shell injected optional compiler cannot extend frozen schema-only dialect choices", async () => {
  const custom = { ...databaseDialects.find(dialect => dialect.default)!, name: "optional", default: false, textType: "CUSTOM_TEXT" };
  const { shell } = fixture([], [custom]);
  try {
    const result = await shell.exec("csvsql -i optional -y 0", { stdin: "text\nhello\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", `usage: csvsql [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]
              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]
              [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]
              [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]
              [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]
              [--zero] [-V] [-i {mssql,mysql,oracle,postgresql,sqlite}]
              [--db CONNECTION_STRING]
              [--engine-option ENGINE_OPTION ENGINE_OPTION] [--query QUERIES]
              [--insert] [--prefix PREFIX] [--before-insert BEFORE_INSERT]
              [--after-insert AFTER_INSERT] [--sql-delimiter SQL_DELIMITER]
              [--tables TABLE_NAMES] [--no-constraints]
              [--unique-constraint UNIQUE_CONSTRAINT] [--no-create]
              [--create-if-not-exists] [--overwrite] [--db-schema DB_SCHEMA]
              [-y SNIFF_LIMIT] [-I] [--chunk-size CHUNK_SIZE]
              [--min-col-len MIN_COL_LEN]
              [--col-len-multiplier COL_LEN_MULTIPLIER]
              [FILE ...]
csvsql: error: argument -i/--dialect: invalid choice: 'optional' (choose from mssql, mysql, oracle, postgresql, sqlite)
`, 2]);
  } finally { await shell.dispose(); }
});

const multipartSchemas = [
  ["db.owner", "db.owner"],
  ["db.owner.part", "[db.owner].part"],
  ["[a.b].[c.d]", "[a.b].[c.d]"],
  ["[]", ""],
  ["a.[b.c]", "a.[b.c]"],
  ["[a]]b].[c]", "ab.c"],
  ["a\nb.c", "[a\nb].c"],
  ["a.\nb", "a.[\nb]"],
  ["[a\nb].[c.d]", "[a\nb].[c.d]"],
  ["a.b.", "a.b"],
  ["a...b", "[a..].b"]
] as const;

for (const [schema, qualifiedSchema] of multipartSchemas) {
  test(`csvsql actual shell frozen mssql multipart schema qualification ${JSON.stringify(schema)}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`csvsql -i mssql -y 0 --tables owned --db-schema '${schema}'`, { stdin: "value\nx\n" });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [`CREATE TABLE ${qualifiedSchema}.owned (\n\tvalue VARCHAR(max) NOT NULL\n);\n`, "", 0]);
    } finally { await shell.dispose(); }
  });
}

test("csvsql actual shell frozen mssql empty multipart owner fails with exact IndexError", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("csvsql -i mssql -y 0 --tables owned --db-schema a..", { stdin: "value\nx\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "IndexError: string index out of range\n", 1]);
  } finally { await shell.dispose(); }
});

for (const dialect of ["", "mysql", "oracle", "postgresql", "sqlite"]) {
  test(`csvsql actual shell frozen ${dialect || "generic"} dotted schema remains one quoted identifier`, async () => {
    const { shell } = fixture();
    const quote = dialect === "mysql" ? "`" : '"';
    try {
      const result = await shell.exec(`csvsql ${dialect ? `-i ${dialect}` : ""} -y 0 --tables owned --db-schema db.owner`, { stdin: "value\nx\n" });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [`CREATE TABLE ${quote}db.owner${quote}.owned (\n\tvalue VARCHAR${dialect === "mysql" ? "(1)" : ""} NOT NULL\n);\n`, "", 0]);
    } finally { await shell.dispose(); }
  });
}
