import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import init from "@sqlite.org/sqlite-wasm";
import { SqliteDatabase } from "./engine.js";
import { readSqliteDatabaseBytes, writeSqliteDatabaseBytes } from "./btree.js";

const wasmBinary = await readFile(createRequire(import.meta.url).resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"));
const sqlite = await init({ wasmBinary } as Parameters<typeof init>[0]);

for (const presorted of [true, false]) {
  test(`BINARY index bytes preserve UTF-8 ordering (presorted=${presorted})`, () => {
    const safe = new SqliteDatabase();
    safe.exec("CREATE TABLE t(x TEXT); CREATE INDEX ix ON t(x); INSERT INTO t VALUES(char(0xE000)),(char(0x1F600));");
    let bytes = safe.serializeToBytes();
    if (!presorted) {
      const image = readSqliteDatabaseBytes(bytes)!;
      image.indexRows = new Map([["ix", [["😀", 2], ["\uE000", 1]]]]);
      bytes = writeSqliteDatabaseBytes(image);
    }
    const native = new sqlite.oo1.DB();
    try {
      const pointer = sqlite.wasm.allocFromTypedArray(bytes);
      assert.equal(sqlite.capi.sqlite3_deserialize(native, "main", pointer, bytes.length, bytes.length,
        sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE), 0);
      assert.deepEqual(native.selectArrays("PRAGMA integrity_check"), [["ok"]]);
      assert.deepEqual(native.selectArrays("SELECT hex(x) FROM t INDEXED BY ix ORDER BY x"), [["EE8080"], ["F09F9880"]]);
      assert.deepEqual(native.selectArrays("SELECT hex(x) FROM t INDEXED BY ix WHERE x < char(0x1F600) ORDER BY x"), [["EE8080"]]);
    } finally { native.close(); }
  });
}

for (const schema of [
  "CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT UNIQUE, n INTEGER)",
  "CREATE TABLE t(id TEXT PRIMARY KEY, v TEXT UNIQUE, n INTEGER)",
  "CREATE TABLE t(id INTEGER, v TEXT, n INTEGER, UNIQUE(v, id))",
  "CREATE TABLE t(id INTEGER, v TEXT COLLATE NOCASE, n INTEGER, UNIQUE(v DESC, id ASC))",
  "CREATE TABLE t(id TEXT, v TEXT, n INTEGER, UNIQUE(v), PRIMARY KEY(id), UNIQUE(v))",
  "CREATE TABLE t(id TEXT, v TEXT, n INTEGER, PRIMARY KEY(id, v))",
  "CREATE TABLE t(id TEXT, v TEXT, n INTEGER, PRIMARY KEY(id, v)) WITHOUT ROWID",
  "CREATE TABLE t(id TEXT, v TEXT, n INTEGER, PRIMARY KEY(id, v), UNIQUE(v)) WITHOUT ROWID",
]) {
  for (const source of ["safe", "SQLite"]) {
    test(`${source} database preserves implicit indexes: ${schema}`, () => {
      const sql = `${schema}; INSERT INTO t VALUES (1,'z',10),(2,'A',20),(3,'b',30);`;
      const safe = new SqliteDatabase();
      const native = new sqlite.oo1.DB();
      try {
        if (source === "safe") safe.exec(sql);
        else {
          native.exec(sql);
          safe.loadFromBytes(sqlite.capi.sqlite3_js_db_export(native));
        }
        for (const mutation of ["", "UPDATE t SET n=11 WHERE id=1", "UPDATE t SET v='c' WHERE id=2; DELETE FROM t WHERE id=3; INSERT INTO t VALUES(4,'d',40)"]) {
          if (mutation) safe.exec(mutation);
          safe.exec("BEGIN; UPDATE t SET n=99; ROLLBACK");
          const bytes = safe.serializeToBytes();
          const pointer = sqlite.wasm.allocFromTypedArray(bytes);
          assert.equal(sqlite.capi.sqlite3_deserialize(native, "main", pointer, bytes.length, bytes.length,
            sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE), 0);
          assert.deepEqual(native.selectArrays("PRAGMA integrity_check"), [["ok"]]);
          const indexes = native.selectArrays("SELECT name FROM sqlite_schema WHERE type='index'");
          assert.equal(indexes.length > 0, !schema.endsWith("WITHOUT ROWID") || schema.includes("UNIQUE"));
          for (const [name] of indexes) {
            assert.deepEqual(native.selectArrays(`SELECT id,v,n FROM t INDEXED BY "${name}" ORDER BY id`),
              native.selectArrays("SELECT id,v,n FROM t NOT INDEXED ORDER BY id"));
          }
          assert.deepEqual(native.selectArrays("SELECT n FROM t WHERE v='z'"), [[mutation ? 11 : 10]]);
          safe.loadFromBytes(bytes);
        }
      } finally { native.close(); }
    });
  }
}
