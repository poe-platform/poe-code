import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { utf8Codec, type DatabaseProvider, type DatabaseResult, type DatabaseSession } from "safe-bash-command-csvkit";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(change: (session: DatabaseSession, effects: string[]) => DatabaseSession = session => session,
  connect?: DatabaseProvider["connect"]) {
  const effects: string[] = [];
  const session: DatabaseSession = change({
    profile: "user-stress",
    async begin() { effects.push("begin"); },
    async query(sql, values) {
      effects.push(`query:${sql}:${JSON.stringify(values)}`);
      return { columns: null, rows: (async function* () {})(), close: async () => { effects.push("result-close"); } };
    },
    async commit() { effects.push("commit"); },
    async rollback() { effects.push("rollback"); },
    async close() { effects.push("close"); }
  }, effects);
  const provider: DatabaseProvider = { schemes: ["sqlite"], profile: "user-stress", connect: connect ?? (async () => { effects.push("connect"); return session; }) };
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({
    codecs: [utf8Codec], databases: [provider],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
    clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  return { effects, fs, shell, session };
}

for (const method of ["query", "executeMany"] as const) {
  test(`csvsql user cancellation drains pending ${method} before rollback and closes its late result`, async () => {
    const started = deferred(), release = deferred();
    const controller = new AbortController();
    const { effects, shell } = setup((session, log) => ({ ...session,
      [method]: async (): Promise<DatabaseResult> => {
        log.push("work-start"); started.resolve(); await release.promise; log.push("work-end");
        return { columns: null, rows: (async function* () {})(), close: async () => { log.push("late-result-close"); } };
      }
    }));
    const execution = shell.exec(method === "query"
      ? "csvsql --db sqlite:// --query pending -y 0"
      : "csvsql --db sqlite:// --insert --no-create -I -y 0", { signal: controller.signal, stdin: method === "query" ? "" : "a\nx\n" });
    const rejection = assert.rejects(execution, reason => reason === false);
    try {
      await started.promise;
      controller.abort(false);
      await new Promise<void>(resolve => { setImmediate(resolve); });
      assert.ok(!effects.includes("rollback"));
      assert.ok(!effects.includes("close"));
      release.resolve(); await rejection;
      assert.deepEqual(effects, ["connect", "begin", "work-start", "work-end", "late-result-close", "rollback", "close"]);
    } finally { release.resolve(); await rejection; await shell.dispose(); }
  });
}

test("csvsql user cancellation during connect disposes the late acquired session without beginning", async () => {
  const started = deferred(), release = deferred();
  const controller = new AbortController();
  const { effects, shell, session } = setup(undefined, async () => {
    effects.push("connect-start"); started.resolve(); await release.promise; effects.push("connect-end"); return session;
  });
  const execution = shell.exec("csvsql --db sqlite:// -y 0", { signal: controller.signal, stdin: "" });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await started.promise; controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.deepEqual(effects, ["connect-start"]);
    release.resolve(); await rejection;
    assert.deepEqual(effects, ["connect-start", "connect-end", "rollback", "close"]);
  } finally { release.resolve(); await rejection; await shell.dispose(); }
});

test("csvsql an existing directory query path fails as a file instead of executing literal SQL", async () => {
  const { effects, fs, shell } = setup();
  await fs.mkdir("/query-directory");
  try {
    const result = await shell.exec("csvsql --db sqlite:// --query /query-directory -y 0", { stdin: "" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "IsADirectoryError: [Errno 21] Is a directory: '/query-directory'\n", 1]);
    assert.deepEqual(effects, ["connect", "begin", "rollback", "close"]);
    assert.equal((await fs.stat("/query-directory")).type, "directory");
  } finally { await shell.dispose(); }
});

for (const flag of ["-n", "--names", "--no-sniff", "--out-delimiter", "--columns"]) {
  test(`csvsql omitted inherited option ${flag} is rejected before database effects`, async () => {
    const { effects, shell } = setup();
    try {
      const result = await shell.exec(`csvsql --db sqlite:// ${flag}`, { stdin: "" });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.endsWith(`csvsql: error: unrecognized arguments: ${flag}\n`));
      assert.deepEqual(effects, []);
    } finally { await shell.dispose(); }
  });
}

test("csvsql repeated engine options use last-key precedence and preserve Python literal values", async () => {
  let options: Readonly<Record<string, unknown>> | undefined;
  const { shell, session } = setup(undefined, async (_url, supplied) => { options = supplied; return session; });
  try {
    const result = await shell.exec("csvsql --db sqlite:// -y 0 --engine-option echo False --engine-option echo True --engine-option pool_size 0x10 --engine-option connect_args \"{'timeout': 0.5, 'check_same_thread': False}\"", { stdin: "" });
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual({ ...options }, { echo: true, pool_size: 16, connect_args: Object.assign(Object.create(null) as Record<string, unknown>, { timeout: 0.5, check_same_thread: false }) });
  } finally { await shell.dispose(); }
});

test("csvsql repeated prefixes and custom SQL delimiter preserve literal hook order for each table", async () => {
  const { effects, fs, shell } = setup();
  await fs.writeFile("/one.csv", new TextEncoder().encode("a\nx\n"));
  await fs.writeFile("/two.csv", new TextEncoder().encode("a\ny\n"));
  try {
    const result = await shell.exec("csvsql --db sqlite:// --insert --no-create -I -y 0 --prefix OR --prefix IGNORE --sql-delimiter '|' --before-insert 'first|second' --after-insert 'last|' --tables alpha,beta /one.csv /two.csv");
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["", "", 0]);
    assert.deepEqual(effects.filter(effect => effect.startsWith("query:")), [
      "query:first:[]", "query:second:[]", 'query:INSERT OR IGNORE INTO alpha (a) VALUES (?):["x"]', "query:last:[]", "query::[]",
      "query:first:[]", "query:second:[]", 'query:INSERT OR IGNORE INTO beta (a) VALUES (?):["y"]', "query:last:[]", "query::[]"
    ]);
    assert.equal(effects.filter(effect => effect === "commit").length, 1);
    assert.equal(effects.filter(effect => effect === "close").length, 1);
  } finally { await shell.dispose(); }
});
