import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, Shell, agentCommands, yesCommands } from "../../src/index.js";

test("Shell executes all 18 new commands end-to-end over VFS", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(yesCommands());
  t.after(() => shell.dispose());

  // 1. Identity & platform shims (mentioning Sandbox and VFS-ish/GNU)
  const idOut = await shell.exec("id && whoami && uname -a && hostname && nproc");
  assert.equal(idOut.exitCode, 0, idOut.stderr);
  assert.match(idOut.stdout, /uid=1000\(sandbox\)/);
  assert.match(idOut.stdout, /\bsandbox\b/);
  assert.match(idOut.stdout, /Sandbox.*VFS-ish\/GNU/);

  // 2. sqlite3 full compatibility + binary B-tree persistence on VFS
  const sqlRes1 = await shell.exec(`
    sqlite3 /data.db "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, price INTEGER);
    INSERT INTO items (label, price) VALUES ('widget', 25), ('gadget', 50);"
  `);
  assert.equal(sqlRes1.exitCode, 0, sqlRes1.stderr);

  const sqlRes2 = await shell.exec(`
    sqlite3 -json /data.db "SELECT id, label, price, SUM(price) OVER (ORDER BY id) AS running FROM items ORDER BY id;"
  `);
  assert.equal(sqlRes2.exitCode, 0, sqlRes2.stderr);
  assert.deepEqual(JSON.parse(sqlRes2.stdout), [
    { id: 1, label: "widget", price: 25, running: 25 },
    { id: 2, label: "gadget", price: 50, running: 75 }
  ]);

  // 3. df over VFS
  const dfRes = await shell.exec("df -h -T /");
  assert.equal(dfRes.exitCode, 0, dfRes.stderr);
  assert.match(dfRes.stdout, /Filesystem\s+Type\s+Size/);
  assert.match(dfRes.stdout, /vfs/);

  // 4. Small GNU coreutils + checksum/compression + locale
  const utilsRes = await shell.exec(`
    yes "ping" | head -n 2
    shuf -i 10-10
    printf "hello" | dd bs=1 count=5 status=none
    echo ""
    numfmt --to=iec 2048
    FOO=world bash -c 'echo "hello $FOO" | envsubst'
    cal 9 1752 | head -n 1
    pathchk /valid/path
    getconf PAGESIZE
    printf "abc" | sha512sum
    printf "compress-me" | bzip2 -c | bunzip2 -c
    echo ""
    locale -a | head -n 3
    locale charmap
  `);
  assert.equal(utilsRes.exitCode, 0, utilsRes.stderr);
  assert.equal(utilsRes.stderr, "");
  const lines = utilsRes.stdout.trim().split("\n");
  assert.equal(lines[0], "ping");
  assert.equal(lines[1], "ping");
  assert.equal(lines[2], "10");
  assert.equal(lines[3], "hello");
  assert.equal(lines[4], "2.0K");
  assert.equal(lines[5], "hello world");
  assert.match(lines[6]!, /September 1752/);
  assert.equal(lines[7], "4096");
  assert.match(lines[8]!, /^ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f\s+-$/);
  assert.equal(lines[9], "compress-me");
  assert.equal(lines[10], "C");
  assert.equal(lines[13], "UTF-8");
});


test("sqlite3 64-bit bigint, REAL affinity formatting, index B-tree persistence, ncal, and Cloudflare injectable engine", async () => {
  const memfs = createMemoryFileSystem();
  await memfs.mkdir("/tmp", { recursive: true });
  const shell = new Shell({ fs: memfs }).use(agentCommands());

  const createRes = await shell.exec(`
    sqlite3 /tmp/compat.db "
      CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, score REAL NOT NULL);
      CREATE INDEX idx_events_ts ON events(ts);
      INSERT INTO events(ts, score) VALUES (1788189346524517160, 1787796874.0);
      INSERT INTO events(ts, score) VALUES (1778702000397217258, 95.5);
      DELETE FROM events WHERE id = 2;
      INSERT INTO events(ts, score) VALUES (42, 100.0);
    "
    sqlite3 /tmp/compat.db "SELECT id, ts, score FROM events ORDER BY id; SELECT name, seq FROM sqlite_sequence;"
    ncal 2 2024 | head -n 1
  `);
  assert.equal(createRes.exitCode, 0, createRes.stderr);
  const outLines = createRes.stdout.trim().split("\n");
  assert.equal(outLines[0], "1|1788189346524517160|1787796874.0");
  assert.equal(outLines[1], "3|42|100.0");
  assert.equal(outLines[2], "events|3");
  assert.match(outLines[3]!, /February 2024/);

  // Verify Cloudflare Workers injectable engine support
  const calls: string[] = [];
  const injectedShell = new Shell({ fs: createMemoryFileSystem() }).use(
    agentCommands({
      sqlite3: {
        engine: async ({ dbPath }) => ({
          async executeStatement(sql) {
            calls.push(`${dbPath}:${sql}`);
            return {
              columns: ["source", "query"],
              rows: [["cloudflare-worker-injected", sql]]
            };
          }
        })
      }
    })
  );
  const injRes = await injectedShell.exec(`sqlite3 -json /cf/d1.db "SELECT 42"`);
  assert.equal(injRes.exitCode, 0, injRes.stderr);
  assert.equal(injRes.stdout.trim(), `[{"source":"cloudflare-worker-injected","query":"SELECT 42"}]`);
  assert.deepEqual(calls, ["/cf/d1.db:SELECT 42"]);
});
