import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

const setup = `
create table a(dep text,leftpos integer);
insert into a values ('@poe-code/safe-fs',1),('safe-bash-contracts',2),('safe-bash-query-engine',3),('safe-bash-byte-engine',4),('safe-bash-io-engine',5);
create table b(dep text,rightpos integer);
insert into b values ('safe-bash-contracts',1),('safe-bash-regex-engine',2),('@poe-code/safe-fs',3);`;

for (const source of ["(a join b using(dep)) as j", "((a join b using(dep))) j", "(select * from a join b using(dep)) j"]) {
  test(`grouped FROM source: ${source}`, () => {
    assert.equal(evalSyncSqlite3(undefined, ["-header", ":memory:", setup,
      `select j.dep,j.leftpos,j.rightpos from ${source} order by j.dep`]),
    "dep|leftpos|rightpos\n@poe-code/safe-fs|1|3\nsafe-bash-contracts|2|1\n");
  });
}

test("LEFT JOIN preserves grouped right sources and pads unmatched rows", () => {
  assert.equal(evalSyncSqlite3(undefined, ["-header", "-nullvalue", "NULL", ":memory:", setup,
    "select a.dep,j.dep from a left join (b join a as x using(dep)) as j using(dep) order by a.dep"]),
  "dep|dep\n@poe-code/safe-fs|@poe-code/safe-fs\nsafe-bash-byte-engine|NULL\nsafe-bash-contracts|safe-bash-contracts\nsafe-bash-io-engine|NULL\nsafe-bash-query-engine|NULL\n");
});

test("parenthesized tables preserve qualifiers and star expansion", () => {
  assert.equal(evalSyncSqlite3(undefined, [":memory:", setup,
    "select a.* from ((a)) order by dep"]),
  "@poe-code/safe-fs|1\nsafe-bash-byte-engine|4\nsafe-bash-contracts|2\nsafe-bash-io-engine|5\nsafe-bash-query-engine|3\n");
  assert.equal(evalSyncSqlite3(undefined, [":memory:", setup,
    "select * from (a join b using(dep)) order by a.dep"]),
  "@poe-code/safe-fs|1|3\nsafe-bash-contracts|2|1\n");
});

test("grouping preserves join precedence and inner qualifiers through null padding", () => {
  assert.equal(evalSyncSqlite3(undefined, ["-nullvalue", "NULL", ":memory:", setup,
    "select a.dep,b.rightpos,x.leftpos from a left join (b join a x using(dep)) on a.dep=b.dep order by a.dep"]),
  "@poe-code/safe-fs|3|1\nsafe-bash-byte-engine|NULL|NULL\nsafe-bash-contracts|1|2\nsafe-bash-io-engine|NULL|NULL\nsafe-bash-query-engine|NULL|NULL\n");
});

for (const join of ["right", "full"]) {
  test(`${join.toUpperCase()} JOIN pads every source in a grouped left operand`, () => {
    const expected = "NULL|NULL|safe-bash-regex-engine\n@poe-code/safe-fs|3|@poe-code/safe-fs\nsafe-bash-contracts|1|safe-bash-contracts\n";
    assert.equal(evalSyncSqlite3(undefined, ["-nullvalue", "NULL", ":memory:", setup,
      `select a.dep,b.rightpos,c.dep from (a join b using(dep)) ${join} join b c on a.dep=c.dep order by a.dep`]), expected);
  });
}

test("grouped aliases preserve inner qualifiers without duplicating unqualified stars", () => {
  for (const target of ["*", "a.dep,b.rightpos,a.leftpos"]) {
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup,
      `select ${target} from (b join a using(dep)) j order by j.dep`]),
    "@poe-code/safe-fs|3|1\nsafe-bash-contracts|1|2\n");
  }
});

test("async execution resolves grouped tables with empty and populated results", async () => {
  const db = new SqliteDatabase();
  db.exec(setup);
  for (const suffix of ["", " where 0"]) {
    const query = `select j.dep,j.leftpos,j.rightpos from (a join b using(dep)) j${suffix} order by j.dep`;
    assert.deepEqual((await db.executeStatementAsync(query, new AbortController().signal))!.rows,
      suffix ? [] : [["@poe-code/safe-fs", 1, 3], ["safe-bash-contracts", 2, 1]]);
  }
});
