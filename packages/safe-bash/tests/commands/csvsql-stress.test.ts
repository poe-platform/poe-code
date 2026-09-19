import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { utf8Codec, CsvkitDiagnostic, type DatabaseProvider, type DatabaseResult, type DatabaseSession } from "@poe-code/csvkit";

function fixture(answer: (sql: string) => DatabaseResult = () => ({ columns: null, rows: (async function* () {})(), close: async () => {} }), methods: Partial<Pick<DatabaseSession, "begin" | "commit" | "hasTable" | "dialect">> = {}) {
  const effects: string[] = [];
  const provider: DatabaseProvider = {
    schemes: ["sqlite"], profile: "csvsql-injected-stress",
    async connect(url) {
      effects.push(`connect:${url}`);
      return {
        profile: "csvsql-injected-stress",
        async begin() { effects.push("begin"); },
        async query(sql) { effects.push(`query:${sql}`); return answer(sql); },
        async commit() { effects.push("commit"); },
        async rollback() { effects.push("rollback"); },
        async close() { effects.push("close"); },
        ...methods
      };
    }
  };
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({
    codecs: [utf8Codec], databases: [provider],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  return { effects, fs, shell };
}

test("csvsql actual shell connects and begins before consuming CSV; no-create still inserts", async () => {
  const { effects, shell } = fixture();
  try {
    const stdin = { async *[Symbol.asyncIterator]() { effects.push("read"); yield new TextEncoder().encode("value\nx\n"); } };
    const result = await shell.exec("csvsql --db sqlite:///:memory: --insert --no-create -y 0 -I", { stdin });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(effects.slice(0, 3), ["connect:sqlite:///:memory:", "begin", "read"]);
    assert.ok(effects.some(effect => effect.startsWith("query:INSERT INTO stdin")));
    assert.ok(!effects.some(effect => effect.startsWith("query:\nCREATE")));
    assert.ok(effects.indexOf("commit") > effects.findIndex(effect => effect.startsWith("query:INSERT")));
    assert.equal(effects.filter(effect => effect === "close").length, 1);
  } finally { await shell.dispose(); }
});

for (const method of ["begin", "commit", "hasTable"] as const) {
  test(`csvsql cancellation drains admitted ${method} before session rollback/disposal`, async () => {
    const controller = new AbortController();
    let started!: () => void;
    const admitted = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { effects, shell } = fixture(undefined, {
      [method]: async () => {
        effects.push(`${method}-start`);
        started();
        await pending;
        effects.push(`${method}-settled`);
        return false;
      }
    });
    const command = method === "hasTable"
      ? "csvsql -y 0 -I --db sqlite:///:memory: --insert --create-if-not-exists"
      : "csvsql -y 0 --db sqlite:///:memory:";
    const execution = shell.exec(command, { signal: controller.signal, stdin: method === "hasTable" ? "a\nx\n" : "" });
    const rejection = assert.rejects(execution, reason => reason === false);
    try {
      await Promise.race([admitted, execution.then(() => { assert.fail("driver method was not admitted"); })]);
      controller.abort(false);
      await new Promise<void>(resolve => { setImmediate(resolve); });
      await new Promise<void>(resolve => { setImmediate(resolve); });
      assert.ok(!effects.includes("close"), "session must stay open while admitted driver method is pending");
      assert.ok(!effects.includes("rollback"), "rollback must not race an admitted driver method");
      release();
      await rejection;
      assert.ok(effects.indexOf(`${method}-settled`) < effects.indexOf("close"));
      assert.equal(effects.filter(effect => effect === "close").length, 1);
      assert.equal(effects.filter(effect => effect === "rollback").length, method === "commit" ? 0 : 1);
    } finally {
      release();
      await rejection;
      await shell.dispose();
    }
  });
}

test("csvsql query splitting stays naive, preserves order, skips only blank query segments", async () => {
  const { effects, shell } = fixture();
  try {
    const result = await shell.exec("csvsql -y 0 --db sqlite:///:memory: --query \"select 'a;b'; ;update t\" --query 'last'", { stdin: "" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(effects.filter(effect => effect.startsWith("query:")), ["query:select 'a", "query:b'", "query:update t", "query:last"]);
    assert.ok(effects.includes("commit"));
  } finally { await shell.dispose(); }
});

test("csvsql only writes final executed query result with BOM and writer line numbers", async () => {
  const { effects, shell } = fixture(sql => ({
    columns: ["value"], rows: (async function* () { yield [sql]; })(),
    close: async () => { effects.push(`result-close:${sql}`); }
  }));
  try {
    const result = await shell.exec("csvsql -y 0 --db sqlite:///:memory: --query 'first;second;' --add-bom -l", { stdin: "" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["\ufeffline_number,value\n1,second\n", "", 0]);
    assert.equal(effects.filter(effect => effect === "result-close:first").length, 1);
    assert.equal(effects.filter(effect => effect === "result-close:second").length, 1);
    assert.ok(effects.includes("commit"));
  } finally { await shell.dispose(); }
});

test("csvsql a final non-row-returning query suppresses earlier result output", async () => {
  const { shell } = fixture(sql => ({ columns: sql === "first" ? ["value"] : null, rows: (async function* () { yield ["unused"]; })(), close: async () => {} }));
  try {
    const result = await shell.exec("csvsql -y 0 --db sqlite:///:memory: --query 'first;update'", { stdin: "" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
  } finally { await shell.dispose(); }
});

test("csvsql hook empty segments execute and rollback replaces commit after a hook failure", async () => {
  const { effects, shell } = fixture(sql => {
    if (sql === "fail") throw new CsvkitDiagnostic("OperationalError: injected hook failure");
    return { columns: null, rows: (async function* () {})(), close: async () => {} };
  });
  try {
    const result = await shell.exec("csvsql --db sqlite:///:memory: --insert --no-create --before-insert 'before;' --after-insert 'fail' -y 0 -I", { stdin: "value\nx\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("injected hook failure"));
    assert.deepEqual(effects.filter(effect => effect.startsWith("query:")).slice(0, 2), ["query:before", "query:"]);
    assert.ok(!effects.includes("commit"));
    assert.equal(effects.filter(effect => effect === "rollback").length, 1);
    assert.equal(effects.filter(effect => effect === "close").length, 1);
  } finally { await shell.dispose(); }
});

test("csvsql existing query paths take precedence over literal SQL and input files stay unchanged", async () => {
  const { effects, fs, shell } = fixture();
  await fs.writeFile("/queries.sql", new TextEncoder().encode("from-file;next-file;"));
  try {
    const result = await shell.exec("csvsql -y 0 --db sqlite:///:memory: --query /queries.sql --query literal", { stdin: "" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(effects.filter(effect => effect.startsWith("query:")), ["query:from-file", "query:next-file", "query:literal"]);
    assert.equal(new TextDecoder().decode(await fs.readFile("/queries.sql")), "from-file;next-file;");
  } finally { await shell.dispose(); }
});

test("csvsql hooks execute once per nonempty loaded table and only remove outer filename extension", async () => {
  const { effects, fs, shell } = fixture();
  await fs.writeFile("/first.part.csv", new TextEncoder().encode("value\nx\n"));
  await fs.writeFile("/empty.csv", new TextEncoder().encode("value\n"));
  await fs.writeFile("/second.csv", new TextEncoder().encode("value\ny\n"));
  try {
    const result = await shell.exec("csvsql --db sqlite:///:memory: --insert --no-create --before-insert before --after-insert after -y 0 -I /first.part.csv /empty.csv /second.csv");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    const queries = effects.filter(effect => effect.startsWith("query:"));
    assert.equal(queries.filter(effect => effect === "query:before").length, 2);
    assert.equal(queries.filter(effect => effect === "query:after").length, 2);
    assert.ok(queries[1]?.startsWith('query:INSERT INTO "first.part"'));
    assert.ok(queries[4]?.startsWith("query:INSERT INTO second"));
    for (const [path, text] of [["/first.part.csv", "value\nx\n"], ["/empty.csv", "value\n"], ["/second.csv", "value\ny\n"]]) {
      assert.equal(new TextDecoder().decode(await fs.readFile(path!)), text);
    }
  } finally { await shell.dispose(); }
});

test("csvsql cancellation returns a cooperative pending result iterator before closing its session", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<readonly string[]>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let returned = 0;
  const { effects, shell } = fixture(() => ({
    columns: ["value"],
    rows: { [Symbol.asyncIterator]: () => ({
      next: () => { started(); return pending; },
      return: async () => { returned++; effects.push("iterator-return"); release(); return { done: true, value: undefined }; }
    }) },
    close: async () => { effects.push("result-close"); }
  }));
  const execution = shell.exec("csvsql -y 0 --db sqlite:///:memory: --query pending", { signal: controller.signal, stdin: "" });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await Promise.race([admitted, execution.then(() => { assert.fail("execution ended before result iterator admission"); })]);
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1);
    await rejection;
    assert.ok(!effects.includes("commit"));
    assert.ok(effects.indexOf("iterator-return") < effects.indexOf("result-close"));
    assert.ok(effects.indexOf("result-close") < effects.indexOf("close"));
    assert.equal(effects.filter(effect => effect === "rollback").length, 1);
    assert.equal(effects.filter(effect => effect === "close").length, 1);
  } finally {
    release();
    await rejection;
    await shell.dispose();
  }
});

test("csvsql query without db chooses injected memory SQLite and enables CSV insertion", async () => {
  const { effects, shell } = fixture();
  try {
    const result = await shell.exec("csvsql -y 0 -I --query final --no-create", { stdin: "value\nx\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.equal(effects[0], "connect:sqlite:///:memory:");
    const queries = effects.filter(effect => effect.startsWith("query:"));
    assert.ok(queries[0]?.startsWith("query:INSERT INTO stdin"));
    assert.equal(queries[1], "query:final");
    assert.ok(effects.includes("commit"));
  } finally { await shell.dispose(); }
});

test("csvsql CSV parse failure rolls back before disposal without executing SQL", async () => {
  const { effects, shell } = fixture();
  try {
    const result = await shell.exec("csvsql --db sqlite:///:memory: --insert --no-create -I -y 0 -z 2", { stdin: "a\nxxx\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "FieldSizeLimitError: CSV contains a field longer than the maximum length of 2 characters on line 2. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n", 1]);
    assert.deepEqual(effects, ["connect:sqlite:///:memory:", "begin", "rollback", "close"]);
  } finally { await shell.dispose(); }
});

for (const existsAfterDrop of [false, true]) {
  test(`csvsql overwrite and create-if-not-exists reflect again after drop (${existsAfterDrop})`, async () => {
    let probes = 0;
    const { effects, shell } = fixture(undefined, {
      async hasTable() {
        effects.push("has-table");
        return probes++ === 0 ? true : existsAfterDrop;
      }
    });
    try {
      const result = await shell.exec("csvsql -I -y 0 --db sqlite:///:memory: --insert --overwrite --create-if-not-exists", { stdin: "a\nx\n" });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
      assert.equal(probes, 2);
      const drop = effects.indexOf("query:DROP TABLE stdin");
      assert.ok(drop > effects.indexOf("has-table"));
      assert.ok(effects.lastIndexOf("has-table") > drop);
      assert.equal(effects.filter(effect => effect.startsWith("query:\nCREATE TABLE")).length, existsAfterDrop ? 0 : 1);
      assert.ok(effects.some(effect => effect.startsWith("query:INSERT INTO stdin")));
    } finally { await shell.dispose(); }
  });
}

test("csvsql no-create skips MySQL DDL length compilation before explicit missing insert driver blocker", async () => {
  const { effects, shell } = fixture(undefined, { dialect: "mysql" });
  try {
    const result = await shell.exec("csvsql -I -y 0 --db sqlite:///:memory: --insert --no-create --no-constraints", { stdin: "a\nx\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "csvkit: unsupported or unqualified: database insert driver profile mysql\n", 78]);
    assert.deepEqual(effects, ["connect:sqlite:///:memory:", "begin", "rollback", "close"]);
  } finally { await shell.dispose(); }
});

test("csvsql missing unique columns fail before reflection even when an existing table skips CREATE", async () => {
  const { effects, shell } = fixture(undefined, {
    async hasTable() { effects.push("has-table"); return true; }
  });
  try {
    const result = await shell.exec("csvsql -I -y 0 --db sqlite:///:memory: --insert --create-if-not-exists --unique-constraint missing", { stdin: "a\nx\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "ConstraintColumnNotFoundError: Can't create UniqueConstraint on table 'stdin': no column named 'missing' is present.\n", 1]);
    assert.deepEqual(effects, ["connect:sqlite:///:memory:", "begin", "rollback", "close"]);
  } finally { await shell.dispose(); }
});

test("csvsql zero insert batches skip empty table identifier compilation and preserve after hooks", async () => {
  const { effects, shell } = fixture();
  try {
    const result = await shell.exec("csvsql --db sqlite:// --insert --no-create --tables ',' --chunk-size -1 -I -y 0 --after-insert after", { stdin: "a\nx\ny\n" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(effects, ["connect:sqlite://", "begin", "query:after", "commit", "close"]);
  } finally { await shell.dispose(); }
});
