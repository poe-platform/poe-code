import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, CommandRegistry, commandRuntimeIdentity, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, createSqlite3Commands, evalSyncSqlite3, settings, type Sqlite3CommandsOptions } from "./index.js";

for (const fn of ["printf", "format"]) {
  for (const [args, expected] of [
    ["'%08d|%+08d', -12, 12", "-0000012|+0000012"],
    ["'%+08d|%+08d|%+08d', -12, 0, NULL", "-0000012|+0000000|+0000000"],
    ["'%8d|%+8d|%-+8d|%0+8d', -12, 12, 12, 12", "     -12|     +12|+12     |+0000012"],
    ["'%+d|%02d', 12, -123", "+12|-123"],
  ]) {
    test(`sqlite3 ${fn} places integer signs before zero padding: ${args}`, async () => {
      assert.deepEqual(
        await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${fn}(${args});`]),
        { code: 0, stdout: `${expected}\n`, stderr: "" }
      );
    });
  }
}

for (const fn of ["printf", "format"]) {
  test(`sqlite3 ${fn} escapes identifier quotes with %w`, async () => {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:",
        `SELECT ${fn}('%w|%w|%w|%w|%w', 'a"b', 'plain', '', NULL, '""');
         SELECT ${fn}('%w');
         SELECT ${fn}('%w:%d|%8w|%-8w', 'a"b', 42, 'a"b', 'a"b');`]),
      { code: 0, stderr: "", stdout: 'a""b|plain||(NULL)|""""\n(NULL)\na""b:42|    a""b|a""b    \n' }
    );
  });
}

for (const fn of ["printf", "format"]) {
  for (const [args, expected] of [
    ["'%e|%E|%g|%G',1234.5,0.000012345,1234.5,0.000012345", "1.234500e+03|1.234500E-05|1234.5|1.2345E-05"],
    ["'%.2e|%.3g|%.0g|%.3g|%.3g',1234.5,1234.5,12.3,0.00009999,999.9", "1.23e+03|1.23e+03|1e+01|0.0001|1e+03"],
    ["'%e|%g|%g|%g',0,0,-1234.5,NULL", "0.000000e+00|0|-1234.5|0"],
    ["'%g|%g|%.2E|%d',100000,1000000,-0.000012345,42", "100000|1e+06|-1.23E-05|42"],
    ["'%.20g|%.20e|%.25g',1.2345678901234567,1.2345678901234567,1e21", "1.234567890123457|1.23456789012345700000e+00|1000000000000000000000"],
  ]) {
    test(`sqlite3 ${fn} floating formats match native output: ${args}`, async () => {
      assert.deepEqual(
        await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${fn}(${args});`]),
        { code: 0, stdout: `${expected}\n`, stderr: "" }
      );
    });
  }
}

for (const fn of ["printf", "format"]) {
  for (const spec of ["x", "X"]) {
    test(`sqlite3 ${fn} formats %${spec} as unsigned 64-bit hexadecimal`, async () => {
      const values = ["-1", "-255", "0", "255", "4294967296",
        "9223372036854775807", "-9223372036854775808"];
      const expected = "ffffffffffffffff|ffffffffffffff01|0|ff|100000000|7fffffffffffffff|8000000000000000\n";
      assert.deepEqual(
        await runSqlite3(createMemoryFileSystem(), [":memory:",
          `SELECT ${values.map(value => `${fn}('%${spec}', ${value})`).join(", ")};`]),
        { code: 0, stderr: "", stdout: spec === "X" ? expected.toUpperCase() : expected }
      );
    });
  }
  test(`sqlite3 ${fn} formats pointers as unsigned 64-bit uppercase hexadecimal`, async () => {
    // Expected output verified with native SQLite.
    const values = ["255", "0", "-1", "-255", "4294967296",
      "9223372036854775807", "-9223372036854775808", "NULL", "'255'", "255.9"];
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:",
        `SELECT ${values.map(value => `${fn}('%p', ${value})`).join(", ")};
         SELECT ${fn}('%08p|%-4p|%p:%d', 255, 255, 255, 42);`]),
      { code: 0, stderr: "", stdout:
        "FF|0|FFFFFFFFFFFFFFFF|FFFFFFFFFFFFFF01|100000000|7FFFFFFFFFFFFFFF|8000000000000000|0|FF|FF\n000000FF|FF  |FF:42\n" }
    );
  });
}

for (const fn of ["json_each", "json_tree"]) {
  test(`sqlite3 ${fn} quotes special object keys in generated paths`, async () => {
    const keys = [
      ["alpha9", "alpha9"], ["Z", "Z"], ["a_b", '"a_b"'],
      ["0abc", '"0abc"'], ["", '""'], ["a.b", '"a.b"'],
      ["x y", '"x y"'], ['a"b', '"a\\"b"'], ["a\\b", '"a\\\\b"'],
      ["é", '"é"'], ["a[b]", '"a[b]"'], ["a\nb", '"a\\nb"']
    ];
    for (const [key, segment] of keys) {
      const doc = JSON.stringify({ [key!]: { "x y": [1] } });
      const fullkey = `$.${segment}`;
      assert.deepEqual(
        await runSqlite3(createMemoryFileSystem(), [":memory:",
          `SELECT fullkey, path FROM ${fn}('${doc}');`]),
        { code: 0, stderr: "", stdout: fn === "json_each"
          ? `${fullkey}|$\n`
          : `$|$\n${fullkey}|$\n${fullkey}."x y"|${fullkey}\n${fullkey}."x y"[0]|${fullkey}."x y"\n` }
      );
    }
  });

  test(`sqlite3 ${fn} returns no rows for SQL NULL`, async () => {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:",
        `SELECT count(*) FROM ${fn}(NULL); SELECT count(*) FROM ${fn}(NULL, '$'); SELECT count(*) FROM ${fn}('null');`]),
      { code: 0, stdout: "0\n0\n1\n", stderr: "" }
    );
  });

  test(`sqlite3 ${fn} rejects malformed non-NULL JSON`, async () => {
    for (const input of ["", "malformed"]) {
      const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
        `SELECT count(*) FROM ${fn}('${input}');`]);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /malformed JSON/);
    }
  });
}

test("sqlite3 factories cannot cross runtime registries", async () => {
  const foreign = await import(new URL("../../safe-bash-contracts/src/command.ts?sqlite3-foreign-runtime", import.meta.url).href) as typeof import("safe-bash-contracts");
  assert.notEqual(foreign.commandRuntimeIdentity, commandRuntimeIdentity);
  for (const command of [createSqlite3Command(), ...createSqlite3Commands()]) {
    assert.equal(new CommandRegistry([command]).has("sqlite3"), true);
    assert.throws(() => new foreign.CommandRegistry([command]), /matching shell runtime/);
  }
});

async function runSqlite3(
  fs: FileSystem,
  args: string[],
  stdinText = "",
  options: Sqlite3CommandsOptions = {},
  signal = new AbortController().signal
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdin = createBytePipe();
  if (stdinText) {
    await writeText(stdin.writable, stdinText);
  }
  await stdin.close();

  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  const cmd = createSqlite3Command(options);
  let res;
  try { res = await cmd.execute({
    command: "sqlite3",
    args: createCommandArguments(args).args,
    stdin: stdin.readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    fs,
    cwd: "/",
    env: {},
    signal
  }); } finally { await stdout.close(); await stderr.close(); }
  const [outBytes, errBytes] = await Promise.all([output, errors]);
  return {
    code: res.exitCode,
    stdout: Buffer.from(outBytes).toString("utf8"),
    stderr: Buffer.from(errBytes).toString("utf8")
  };
}

for (const [args, hex] of [
  ["-1", "EFBFBD"],
  ["1114112", "EFBFBD"],
  ["0", "00"],
  ["65", "41"],
  ["1114111", "F48FBFBF"],
  ["65,-1,66,1114112,67", "41EFBFBD42EFBFBD43"],
]) {
  test(`sqlite3 CHAR matches native output for ${args}`, async () => {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT hex(char(${args}));`]),
      { code: 0, stdout: `${hex}\n`, stderr: "" }
    );
  });
}

for (const [sql, stdout] of [
  ["SELECT char(0xE000) < char(0x1F600), hex(char(0xE000)), hex(char(0x1F600));", "1|EE8080|F09F9880\n"],
  ["WITH t(x) AS (VALUES(char(0xE000)),(char(0x1F600))) SELECT hex(x) FROM t ORDER BY x;", "EE8080\nF09F9880\n"],
  ["CREATE TABLE t(x TEXT); CREATE INDEX ix ON t(x); INSERT INTO t VALUES(char(0xE000)),(char(0x1F600)); SELECT hex(x) FROM t WHERE x < char(0x1F600) ORDER BY x;", "EE8080\n"],
  ["SELECT 'a' < 'z', 'a' < 'aa', 'a' = 'a', char(0x1F600) > char(0xE000), char(0) < char(1);", "1|1|1|1|1\n"],
]) {
  test(`sqlite3 BINARY text uses UTF-8 byte order: ${sql}`, async () => {
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql!]),
      { code: 0, stdout, stderr: "" });
  });
}

for (const name of ["json_set", "json_insert", "json_replace"]) {
  test(`sqlite3 ${name} preserves scalars along unreachable paths`, async () => {
    for (const scalar of ["5", '"text"', "true", "false", "null"]) {
      for (const [doc, path] of [
        [scalar, "$.b"],
        [scalar, "$.b.c"],
        [scalar, "$[0]"],
        [`{"a":${scalar}}`, "$.a.b"],
        [`{"a":${scalar}}`, "$.a.b.c"],
        [`[${scalar}]`, "$[0].b"],
        [`{"a":[${scalar}]}`, "$.a[0].b"],
      ]) {
        const sql = `SELECT ${name}('${doc}', '${path}', 1);`;
        assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql]),
          { code: 0, stdout: `${doc}\n`, stderr: "" }, sql);
      }
    }
  });
}

test("sqlite3 JSON1 preserves valid mutations around unreachable scalar paths", async () => {
  for (const [expression, expected] of [
    [`json_set('{"a":5}', '$.a.b', 1, '$.c', 2)`, '{"a":5,"c":2}'],
    [`json_set('{"a":5}', '$.c', 2, '$.a.b', 1)`, '{"a":5,"c":2}'],
    [`json_replace('{"a":5}', '$.a.b', 1, '$.a', 2)`, '{"a":2}'],
    [`json_set('5', '$', 2)`, '2'],
    [`json_replace('null', '$', 2)`, '2'],
    [`json_set('{}', '$.a.b', 1)`, '{"a":{"b":1}}'],
    [`json_insert('{}', '$.a.b', 1)`, '{"a":{"b":1}}'],
    [`json_replace('{}', '$.a.b', 1)`, '{}'],
  ]) {
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${expression};`]),
      { code: 0, stdout: `${expected}\n`, stderr: "" }, expression);
  }
});

for (const name of ["json_set", "json_insert", "json_replace"]) {
  test(`sqlite3 ${name} ignores out-of-range array writes without creating holes`, async () => {
    for (const [doc, path] of [
      ["[1,2]", "$[4]"],
      ['{"a":[]}', "$.a[1]"],
      ["[1,2]", "$[4].x"],
      ["{}", "$.a[1]"],
      ["[]", "$[0][1]"],
    ]) {
      const sql = `SELECT ${name}('${doc}', '${path}', 5);`;
      assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql]),
        { code: 0, stdout: `${doc}\n`, stderr: "" }, sql);
    }
    for (const [path, expected] of [
      ["$[0]", name === "json_insert" ? "[1,2]" : "[5,2]"],
      ["$[2]", name === "json_replace" ? "[1,2]" : "[1,2,5]"],
      ["$[#]", name === "json_replace" ? "[1,2]" : "[1,2,5]"],
    ]) {
      const sql = `SELECT ${name}('[1,2]', '$[4]', 9, '${path}', 5);`;
      assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql]),
        { code: 0, stdout: `${expected}\n`, stderr: "" }, sql);
    }
  });
}

test("sqlite3 JSON1 rejects incomplete object arguments", async () => {
  for (const args of ["'a'", "'a', 1, 'b'"]) {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT json_object(${args});`]),
      { code: 1, stdout: "", stderr: "Error: stepping, json_object() requires an even number of arguments\n" }
    );
  }
});

for (const [name, updated] of [
  ["json_set", '{"a":1,"b":2}'],
  ["json_insert", '{"a":0,"b":2}'],
  ["json_replace", '{"a":1}'],
]) {
  test(`sqlite3 ${name} rejects incomplete path/value pairs`, async () => {
    for (const args of ["'{}', '$.a'", "'{}', '$.a', 1, '$.b'", "NULL, '$.a'"]) {
      assert.deepEqual(
        await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${name}(${args});`]),
        { code: 1, stdout: "", stderr: `Error: stepping, ${name}() needs an odd number of arguments\n` },
        args
      );
    }
  });

  test(`sqlite3 ${name} preserves complete and empty argument lists`, async () => {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:",
        `SELECT ${name}(), ${name}('{}'), ${name}('{"a":0}', '$.a', 1, '$.b', 2);`
      ]),
      { code: 0, stdout: `|{}|${updated}\n`, stderr: "" }
    );
  });
}

for (const label of ["NULL", "1", "1.5", "9007199254740993", "x'61'", "TRUE"]) {
  test(`sqlite3 json_object rejects non-text label ${label}`, async () => {
    for (const args of [`${label}, 2`, `'valid', 1, ${label}, 2`]) {
      assert.deepEqual(
        await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT json_object(${args});`]),
        { code: 1, stdout: "", stderr: "Error: stepping, json_object() labels must be TEXT\n" }
      );
    }
  });
}

test("sqlite3 json_object accepts text labels including JSON-tagged text", async () => {
  assert.deepEqual(
    await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT json_object('', NULL, CAST(1 AS TEXT), 2, json('[]'), 3); SELECT json_object(label, 4) FROM (SELECT 'key' AS label);"]),
    { code: 0, stdout: '{"":null,"1":2,"[]":3}\n{"key":4}\n', stderr: "" }
  );
});

test("sqlite3 json_object preserves complete and empty argument lists", async () => {
  assert.deepEqual(
    await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT json_object(), json_object('a', 1, 'b', 2);"]),
    { code: 0, stdout: '{}|{"a":1,"b":2}\n', stderr: "" }
  );
});

test("sqlite3 JSON1 reports malformed input through the public command", async () => {
  for (const expression of [
    "json_extract('not json', '$')",
    "json_type('not json')",
    "json_array_length('not json')",
    "json_set('not json', '$.a', 1)",
    "json_insert('not json', '$.a', 1)",
    "json_replace('not json', '$.a', 1)",
    "json_remove('not json', '$.a')",
    "json_extract('not json', NULL)",
    "json_type('not json', NULL)",
    "json_array_length('not json', NULL)",
    "json_set('not json', NULL, 1)",
    "json_insert('not json', NULL, 1)",
    "json_replace('not json', NULL, 1)",
    "json_remove('not json', NULL)",
    "json_patch('not json', '{}')",
    "json_patch('{}', 'not json')",
  ]) {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${expression};`]),
      { code: 1, stdout: "", stderr: "Error: stepping, malformed JSON\n" },
      expression
    );
  }
});

test("sqlite3 JSON1 preserves validation and SQL NULL behavior", async () => {
  assert.deepEqual(
    await runSqlite3(createMemoryFileSystem(), [":memory:",
      "SELECT json_valid('not json'), json_valid('{}'), json_extract(NULL, '$'), json_type(NULL), json_array_length(NULL), json_set(NULL, '$.a', 1), json_insert(NULL, '$.a', 1), json_replace(NULL, '$.a', 1), json_remove(NULL, '$.a'), json_patch(NULL, '{}'), json_patch('{}', NULL);"
    ]),
    { code: 0, stdout: "0|1|||||||||\n", stderr: "" }
  );
});

test("sqlite3 JSON1 honors NULL paths through the public command", async () => {
  const cases = [
    ["json_extract('{}', NULL)", "NULL"],
    ["json_extract('{}')", "NULL"],
    ["json_type('{}', NULL)", "NULL"],
    ["json_array_length('[1,2]', NULL)", "NULL"],
    ["json_extract('[1,2]', NULL, '$[0]', NULL)", "[null,1,null]"],
    ["json_extract('[1,2]', '$[0]', NULL)", "[1,null]"],
    ["json_remove('[1,2]', NULL)", "NULL"],
    ["json_remove('[1,2]', '$[0]', NULL)", "NULL"],
    ["json_remove('[1,2]', NULL, '$[0]')", "NULL"],
    ["json_type('{}')", "object"],
    ["json_array_length('[1,2]')", "2"],
    ["json_extract('[1,2]', '$')", "[1,2]"],
  ];
  for (const name of ["json_set", "json_insert", "json_replace"]) {
    cases.push(
      [`${name}('{}', NULL, 1)`, "{}"],
      [`${name}('[1,2]', NULL, 9, '$[0]', 3, NULL, 8)`, name === "json_insert" ? "[1,2]" : "[3,2]"],
      [`${name}('{}', NULL, 9, '$.a', 3, NULL, 8)`, name === "json_replace" ? "{}" : '{"a":3}'],
    );
  }
  for (const [expression, expected] of cases) {
    assert.deepEqual(
      await runSqlite3(createMemoryFileSystem(), ["-nullvalue", "NULL", ":memory:", `SELECT ${expression};`]),
      { code: 0, stdout: `${expected}\n`, stderr: "" },
      expression
    );
  }
});

for (const mode of ["set", "insert", "replace", "remove"]) {
  test(`sqlite3 json_${mode} validates reachable JSON paths before mutation`, async () => {
    const cases: [string, string, string | null][] = [
      ["{}", "$[x]", "{}"],
      ["{}", "$.", null],
      ["{}", "$.a[xyz]", mode === "set" || mode === "insert" ? null : "{}"],
      ['{"a":[]}', "$.a[xyz]", null],
      ['{"a":{}}', "$.a[xyz]", '{"a":{}}'],
      ['{"a":1}', "$.a[xyz]", '{"a":1}'],
      ["[]", "$[x]", null],
      ["[]", "$[", null],
      ["[]", "$[]", null],
      ["[]", "$[-1]", null],
      ["[]", "$[1.0]", null],
      ["[]", "$[ 0]", null],
      ["[]", "$[#-]", null],
      ["{}", "$..a", null],
      ["{}", '$."unterminated', null],
      ["{}", "$a", null],
      ["{}", "a", null],
      ["{}", " $", null],
      ["{}", "$.a.", mode === "set" || mode === "insert" ? null : "{}"],
      ['{"a":0}', "$.a.", null],
      ['{"a":0}', "$.a[0]", '{"a":0}'],
      ["{}", "$.a[1]", "{}"],
    ];
    for (const [doc, path, expected] of cases) {
      const sql = `SELECT json_${mode}('${doc}', '${path}'${mode === "remove" ? "" : ", 1"});`;
      const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
      assert.deepEqual(result, expected === null
        ? { code: 1, stdout: "", stderr: `Error: bad JSON path: '${path}'\n` }
        : { code: 0, stdout: `${expected}\n`, stderr: "" }, sql);
    }
  });
}

test("sqlite3 JSON1 treats quoted object names as single path components", async () => {
  const cases = [
    [`json_extract('{"a.b":42}', '$."a.b"')`, "42"],
    [`json_extract('{"x y":9}', '$."x y"')`, "9"],
    [`json_extract('{"":7}', '$.""')`, "7"],
    [`json_extract('{"a":{"b":3}}', '$.a.b')`, "3"],
    [`json_extract('{"a[b]":{"c.d":[4]}}', '$."a[b]"."c.d"[0]')`, "4"],
    [`json_set('{"a.b":1}', '$."a.b"', 2)`, '{"a.b":2}'],
    [`json_remove('{"a.b":1,"x":2}', '$."a.b"')`, '{"x":2}'],
    [`json_insert('{}', '$.""', 7)`, '{"":7}'],
    [`json_insert('{"a.b":1}', '$."a.b"', 2)`, '{"a.b":1}'],
    [`json_replace('{"x y":1}', '$."x y"', 2)`, '{"x y":2}'],
    [`json_set('{}', '$."a.b".""', 2)`, '{"a.b":{"":2}}'],
    [`json_remove('{"a.b":[{"":7}]}', '$."a.b"[0].""')`, '{"a.b":[{}]}'],
    [`json_type('{"a.b":[]}', '$."a.b"')`, "array"],
    [`json_array_length('{"a.b":[1,2]}', '$."a.b"')`, "2"],
    [`'{"a.b":42}' ->> '$."a.b"'`, "42"],
  ];
  for (const [expression, expected] of cases) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${expression};`]);
    assert.deepEqual(result, { code: 0, stdout: `${expected}\n`, stderr: "" }, expression);
  }
});

test("sqlite3 JSON1 resolves array indexes counted from the end", async () => {
  const cases = [
    ["json_extract('[10,20,30]', '$[#-1]')", "30"],
    ["json_extract('{\"a\":[10,20,30]}', '$.a[#-2]')", "20"],
    ["json_extract('[[10,20],[30,40]]', '$[#-1][#-2]')", "30"],
    ["json_remove('[10,20,30]', '$[#-1]')", "[10,20]"],
    ["json_set('[10,20,30]', '$[#-1]', 99)", "[10,20,99]"],
    ["json_replace('[10,20,30]', '$[#-2]', 99)", "[10,99,30]"],
    ["json_insert('[10,20,30]', '$[#-1]', 99)", "[10,20,30]"],
    ["json_set('[[10,20],[30,40]]', '$[#-1][#-2]', 99)", "[[10,20],[99,40]]"],
    ["json_remove('[[10,20],[30,40]]', '$[#-1][#-2]')", "[[10,20],[40]]"],
    ["json_insert('[10,20,30]', '$[#]', 40)", "[10,20,30,40]"],
    ["json_set('[10,20,30]', '$[#-0]', 40)", "[10,20,30,40]"],
    ["json_set('{}', '$.a[#-1]', 99)", "{}"],
    ["json_set('{}', '$.a[#-1].x', 99)", "{}"],
    ["json_extract('[10,20,30]', '$[#-0]')", ""],
    ["json_remove('[10,20,30]', '$[#-0]')", "[10,20,30]"],
    ["json_replace('[10,20,30]', '$[#-0]', 99)", "[10,20,30]"],
    ["json_type('[[10,20]]', '$[#-1]')", "array"],
    ["json_array_length('[[10,20]]', '$[#-1]')", "2"],
    ["'[10,20,30]' ->> '$[#-1]'", "30"],
  ];
  for (const doc of ["[]", "[10,20,30]"]) {
    for (const path of ["$[#-4]", "$[#-4].x"]) {
      cases.push(
        [`json_extract('${doc}', '${path}')`, ""],
        [`json_remove('${doc}', '${path}')`, doc],
        ...["set", "insert", "replace"].map(mode => [
          `json_${mode}('${doc}', '${path}', 99)`, doc
        ])
      );
    }
  }
  for (const [expression, expected] of cases) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT ${expression};`]);
    assert.deepEqual(result, { code: 0, stdout: `${expected}\n`, stderr: "" }, expression);
  }
});

for (const conflict of ["", "OR ABORT", "OR FAIL"]) {
  test(`sqlite3 persists statement conflict behavior for INSERT ${conflict}`, async () => {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/db", `CREATE TABLE t(x INT UNIQUE);
      INSERT INTO t VALUES(1); INSERT ${conflict} INTO t VALUES(2),(1),(3);`]);
    assert.equal(result.code, 19);
    assert.ok(result.stderr.includes("UNIQUE constraint failed: t.x"));
    const reopened = await runSqlite3(fs, ["/db", "SELECT x FROM t ORDER BY x;"]);
    assert.deepEqual(reopened, { code: 0, stdout: conflict === "OR FAIL" ? "1\n2\n" : "1\n", stderr: "" });
  });
}

for (const [constraint, value, diagnostic] of [
  ["UNIQUE", "1", "UNIQUE constraint failed: t.x"],
  ["NOT NULL", "NULL", "NOT NULL constraint failed: t.x"],
  ["CHECK(x > 0)", "0", "CHECK constraint failed: x > 0"]
]) {
  test(`sqlite3 persists earlier OR FAIL rows for ${constraint} with foreign keys enabled`, async () => {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/fail.db", `PRAGMA foreign_keys=ON;
      CREATE TABLE t(x INT ${constraint}); INSERT INTO t VALUES(1);
      INSERT OR FAIL INTO t VALUES(2),(${value}),(3);`]);
    assert.equal(result.code, 19);
    assert.ok(result.stderr.includes(diagnostic!));
    const reopened = await runSqlite3(fs, ["/fail.db", "SELECT x FROM t ORDER BY x"]);
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(reopened.stdout, "1\n2\n");
  });
}

for (const values of ["(2,1),(3,9)", "(2,9),(1,1)"]) {
  test(`sqlite3 OR FAIL keeps foreign key violations atomic for ${values}`, async () => {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/fail.db", `PRAGMA foreign_keys=ON;
      CREATE TABLE p(x INT PRIMARY KEY); INSERT INTO p VALUES(1);
      CREATE TABLE t(x INT UNIQUE, pid REFERENCES p(x)); INSERT INTO t VALUES(1,1);
      INSERT OR FAIL INTO t VALUES${values};`]);
    assert.equal(result.code, 19);
    assert.ok(result.stderr.includes("FOREIGN KEY constraint failed"));
    const reopened = await runSqlite3(fs, ["/fail.db", "SELECT x FROM t ORDER BY x"]);
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(reopened.stdout, "1\n");
  });
}

test("sqlite3 persists the rolled-back state after INSERT OR ROLLBACK fails", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/rollback.db"], `CREATE TABLE t(x INT UNIQUE);
INSERT INTO t VALUES(1);
BEGIN;
INSERT INTO t VALUES(2);
INSERT OR ROLLBACK INTO t VALUES(1);
SELECT x FROM t ORDER BY x;
`);
  assert.equal(result.code, 19);
  assert.ok(result.stderr.includes("UNIQUE constraint failed: t.x"));
  const reopened = await runSqlite3(fs, ["/rollback.db", "SELECT x FROM t ORDER BY x"]);
  assert.equal(reopened.code, 0, reopened.stderr);
  assert.equal(reopened.stdout, "1\n");
});

for (const [ordering, values] of [
  ["ASC NULLS LAST", [1, 2, null, null]],
  ["DESC NULLS FIRST", [null, null, 2, 1]],
  ["ASC NULLS FIRST", [null, null, 1, 2]],
  ["DESC NULLS LAST", [2, 1, null, null]],
  ["ASC", [null, null, 1, 2]],
  ["DESC", [2, 1, null, null]]
] as const) {
  for (const outerOrder of ["", " ORDER BY rn"]) {
    test(`sqlite3 window ORDER BY x ${ordering}${outerOrder}`, async () => {
      const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", `
        WITH t(x) AS (VALUES(1),(NULL),(2),(NULL))
        SELECT x, ROW_NUMBER() OVER (ORDER BY x ${ordering}) AS rn,
               RANK() OVER (ORDER BY x ${ordering}) AS rnk
        FROM t${outerOrder};
      `]);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), values.map((x, i) => ({
        x, rn: i + 1, rnk: values.findIndex((value) => value === x) + 1
      })));
    });
  }
}

test("sqlite3 IS boolean literals tests truthiness, including negation and NULL", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `
    SELECT 2 IS TRUE, 0.5 IS TRUE, '1' IS TRUE, '0' IS FALSE;
    WITH t(v) AS (VALUES (2),(0.5),(-2),(0),('1'),('0'),('abc'),('1x'),(NULL),(x'31'),(x'30'))
    SELECT v IS TRUE, v IS FALSE, v IS NOT TRUE, v IS NOT FALSE FROM t;
    SELECT 2 IS 1, 0 IS 0, 2 IS +TRUE, 2 IS (TRUE),
           2 IS TRUE COLLATE NOCASE, TRUE IS 2, 2 = TRUE;
  `]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "1|1|1|1\n" + [
    "1|0|0|1", "1|0|0|1", "1|0|0|1", "0|1|1|0",
    "1|0|0|1", "0|1|1|0", "0|1|1|0", "1|0|0|1",
    "0|0|1|1", "1|0|0|1", "0|1|1|0",
    "0|1|0|1|1|0|0", ""
  ].join("\n"));
});

for (const op of ["IS DISTINCT FROM", "IS NOT DISTINCT FROM"]) {
  test(`sqlite3 ${op} compares null and non-null operands`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", `
      SELECT NULL ${op} NULL AS both_null, NULL ${op} 1 AS left_null,
             1 ${op} NULL AS right_null, 1 ${op} 1 AS equal,
             1 ${op} 2 AS unequal, 'a' ${op} 'a' AS text_equal;
    `]);
    const distinct = op === "IS DISTINCT FROM";
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{
      both_null: distinct ? 0 : 1, left_null: distinct ? 1 : 0,
      right_null: distinct ? 1 : 0, equal: distinct ? 0 : 1,
      unequal: distinct ? 1 : 0, text_equal: distinct ? 0 : 1
    }]);
  });

  test(`sqlite3 ${op} preserves table clauses and UPDATE assignments`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `
      CREATE TABLE t(x INTEGER, d INTEGER);
      INSERT INTO t VALUES (NULL, 0), (1, 0), (2, 0);
      UPDATE t SET d = x ${op} NULL WHERE x ${op} 1;
      SELECT x ${op} NULL AS comparison, d FROM t
      WHERE x ${op} 1 ORDER BY x ${op} NULL, x;
    `]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, op === "IS DISTINCT FROM" ? "0|0\n1|1\n" : "0|0\n");
  });
}

for (const op of ["=", "==", "!=", "<>"]) {
  test(`sqlite3 ${op} compares literals without affinity and retains column affinity`, async () => {
    const equal = op === "=" || op === "==";
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `
      SELECT 1 ${op} '1', '1' ${op} 1, 1.0 ${op} '1', 1 ${op} 1.0,
             '1' ${op} '1', NULL ${op} 1, (1 + 0) ${op} '1';
      CREATE TABLE t(n INTEGER, r REAL, s TEXT, b BLOB);
      INSERT INTO t VALUES (1, 1, '1', 1);
      SELECT n ${op} '1', '1' ${op} n, r ${op} '1', s ${op} 1,
             b ${op} '1', +n ${op} '1', n COLLATE BINARY ${op} '1'
      FROM t AS item;
      SELECT item.n ${op} '1' FROM t AS item;
    `]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, equal ? "0|0|0|1|1||0\n1|1|1|1|0|0|1\n1\n" : "1|1|1|0|0||1\n0|0|0|0|1|1|0\n0\n");
  });
}

test("sqlite3 comparison affinity survives filters, writes, casts and joined aliases", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `
    CREATE TABLE t(n INTEGER, s TEXT);
    INSERT INTO t VALUES (1, '01');
    SELECT n, s = 1, n = s, CAST(1 AS TEXT) = 1, CAST('1' AS INTEGER) = '1'
      FROM t WHERE n = '1';
    SELECT a.n = '1', b.s = 1 FROM t a JOIN t b ON a.n = b.n;
    UPDATE t SET n = 2 WHERE n = '1';
    SELECT n FROM t;
    DELETE FROM t WHERE n = '2';
    SELECT count(*) FROM t;
  `]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "1|0|1|1|1\n1|0\n2\n0\n");
});

test("sqlite3 persists genuine SQLite format 3 binary B-tree database files across invocations", async () => {
  const fs = createMemoryFileSystem();
  const res1 = await runSqlite3(fs, [
    "/app.db",
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score INTEGER DEFAULT 10); INSERT INTO users (name, score) VALUES ('Alice', 95), ('Bob', 82);"
  ]);
  assert.equal(res1.code, 0, res1.stderr);

  const dbBytes = await fs.readFile("/app.db");
  const magic = new TextDecoder().decode(dbBytes.subarray(0, 16));
  assert.equal(magic, "SQLite format 3\0");
  assert.equal(dbBytes.byteLength % 4096, 0);

  const res2 = await runSqlite3(fs, ["-json", "/app.db", "SELECT id, name, score FROM users ORDER BY id;"]);
  assert.equal(res2.code, 0, res2.stderr);
  assert.deepEqual(JSON.parse(res2.stdout), [
    { id: 1, name: "Alice", score: 95 },
    { id: 2, name: "Bob", score: 82 }
  ]);
});

test("sqlite3 supports recursive CTEs, window functions, JSON functions, json_each, UPSERT, RETURNING, and triggers", async () => {
  const fs = createMemoryFileSystem();

  // Recursive CTE + Window functions
  const cteRes = await runSqlite3(fs, [
    ":memory:",
    `WITH RECURSIVE seq(n) AS (
       SELECT 1
       UNION ALL
       SELECT n + 1 FROM seq WHERE n < 5
     )
     SELECT n, SUM(n) OVER (ORDER BY n) AS running_sum, LAG(n, 1, 0) OVER (ORDER BY n) AS prev_n FROM seq;`
  ]);
  assert.equal(cteRes.code, 0, cteRes.stderr);
  assert.equal(cteRes.stdout, "1|1|0\n2|3|1\n3|6|2\n4|10|3\n5|15|4\n");

  // JSON functions & json_each
  const jsonRes = await runSqlite3(fs, [
    ":memory:",
    `SELECT key, value, json_extract('{"a":[10,20,30]}', '$.a[1]') AS second
     FROM json_each('{"x":100,"y":200}')
     ORDER BY key;`
  ]);
  assert.equal(jsonRes.code, 0, jsonRes.stderr);
  assert.equal(jsonRes.stdout, "x|100|20\ny|200|20\n");

  // UPSERT + RETURNING + Triggers
  const upsertRes = await runSqlite3(fs, [
    ":memory:",
    `CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER);
     CREATE TABLE audit (msg TEXT);
     CREATE TRIGGER tr_kv AFTER INSERT ON kv BEGIN INSERT INTO audit VALUES ('inserted:' || NEW.k); END;
     INSERT INTO kv VALUES ('a', 1), ('b', 2);
     INSERT INTO kv VALUES ('a', 10) ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v RETURNING k, v;
     SELECT msg FROM audit ORDER BY rowid;`
  ]);
  assert.equal(upsertRes.code, 0, upsertRes.stderr);
  assert.equal(upsertRes.stdout, "a|11\ninserted:a\ninserted:b\n");
});

test("sqlite3 supports dot-commands (.mode, .headers, .tables, .schema, .dump, .import) and CSV/line/column formatting", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/items.csv", new TextEncoder().encode("code,qty\nA1,5\nB2,12\n"));

  const script = [
    ".mode csv",
    ".import /items.csv items",
    ".headers on",
    ".mode list",
    ".separator |",
    "SELECT code, CAST(qty AS INTEGER) * 2 AS doubled FROM items ORDER BY code;",
    ".tables"
  ].join("\n");

  const res = await runSqlite3(fs, ["/store.db"], script);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, "code|doubled\nA1|10\nB2|24\nitems\n");

  const dumpRes = await runSqlite3(fs, ["/store.db", ".dump"]);
  assert.equal(dumpRes.code, 0, dumpRes.stderr);
  assert.match(dumpRes.stdout, /CREATE TABLE "items"/);
  assert.match(dumpRes.stdout, /INSERT INTO items VALUES\('A1','5'\);/);
});

test("sqlite3 supports INSERT INTO ... WITH RECURSIVE and CREATE TABLE ... AS WITH", async () => {
  const fs = createMemoryFileSystem();
  const res = await runSqlite3(fs, [
    ":memory:",
    `CREATE TABLE nums (n INTEGER, label TEXT);
     INSERT INTO nums WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM seq WHERE x < 5) SELECT x, 'n-' || x FROM seq;
     CREATE TABLE summary AS WITH totals(cnt, s) AS (SELECT COUNT(*), SUM(n) FROM nums) SELECT cnt, s FROM totals;
     SELECT * FROM nums ORDER BY n;
     SELECT * FROM summary;`
  ]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, "1|n-1\n2|n-2\n3|n-3\n4|n-4\n5|n-5\n5|15\n");
});

for (const [value, digits, expected] of [
  [123.456, -1, "123.0"],
  [123.456, -2, "123.0"],
  [-123.456, -1, "-123.0"],
  [-123.5, -1, "-124.0"],
  [123.456, 0, "123.0"],
  [123.456, 1, "123.5"],
] as const) {
  test(`sqlite3 ROUND(${value}, ${digits}) matches native value and REAL type`, async () => {
    const sql = `SELECT round(${value}, ${digits}), typeof(round(${value}, ${digits}));`;
    const stdout = `${expected}|real\n`;
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql]),
      { code: 0, stdout, stderr: "" });
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), stdout);
  });
}

test("sqlite3 matches native /usr/bin/sqlite3 for COALESCE/IFNULL/IIF projections, ROUND/TOTAL REAL formatting, QUOTE(blob) uppercase, and -html output", async () => {
  const fs = createMemoryFileSystem();
  const sql = [
    "SELECT COALESCE(NULL, NULL, 'fallback'), IFNULL(NULL, 99), IIF(1 > 0, 'yes', 'no'), IIF(0, 'yes', 'no'), IIF(NULL, 'yes', 'no');",
    "SELECT QUOTE(NULL), QUOTE(42), QUOTE(3.14), QUOTE('it''s'), QUOTE(X'deadbeef');",
    "SELECT ROUND(3.14159, 2), ROUND(3.5), ROUND(-3.5), typeof(ROUND(3.5));",
    "CREATE TABLE empty_t(x INT); SELECT TOTAL(x), typeof(TOTAL(x)) FROM empty_t;",
  ].join(" ");
  const r1 = await runSqlite3(fs, [":memory:", sql]);
  assert.equal(r1.code, 0, r1.stderr);
  assert.equal(
    r1.stdout,
    [
      "fallback|99|yes|no|no",
      "NULL|42|3.14|'it''s'|X'DEADBEEF'",
      "3.14|4.0|-4.0|real",
      "0.0|real",
      "",
    ].join("\n")
  );

  const rHtml = await runSqlite3(fs, ["-html", "-header", ":memory:", "SELECT 1 AS id, 'alice' AS name;"]);
  assert.equal(rHtml.code, 0, rHtml.stderr);
  assert.equal(rHtml.stdout, "<TR><TH>id</TH>\n<TH>name</TH>\n</TR>\n<TR><TD>1</TD>\n<TD>alice</TD>\n</TR>\n");

  const rModeSwitch = await runSqlite3(fs, [":memory:", ".mode csv", "SELECT 1, 2;", ".mode list", "SELECT 3, 4;"]);
  assert.equal(rModeSwitch.code, 0, rModeSwitch.stderr);
  assert.equal(rModeSwitch.stdout, "1,2\r\n3|4\n");

  const rColNoHeader = await runSqlite3(fs, ["-column", ":memory:", "SELECT 3779 AS number, 'open' AS state, 1 AS version;"]);
  assert.equal(rColNoHeader.code, 0, rColNoHeader.stderr);
  assert.equal(rColNoHeader.stdout, "3779    open   1      \n");

  const rColHeader = await runSqlite3(fs, ["-column", "-header", ":memory:", "SELECT 3779 AS number, 'open' AS state, 1 AS version;"]);
  assert.equal(rColHeader.code, 0, rColHeader.stderr);
  assert.equal(rColHeader.stdout, "number  state  version\n------  -----  -------\n3779    open   1      \n");

  const rTablesGrid = await runSqlite3(fs, [
    ":memory:",
    "CREATE TABLE agents(x); CREATE TABLE comments(x); CREATE TABLE issue_status_updates(x); CREATE TABLE issues(x); CREATE TABLE projects(x);",
    ".tables"
  ]);
  assert.equal(rTablesGrid.code, 0, rTablesGrid.stderr);
  assert.equal(
    rTablesGrid.stdout,
    "agents                issue_status_updates  projects            \ncomments              issues              \n"
  );
});

test("sqlite3 supports Cloudflare Durable Object SqlStorage (ctx.storage.sql) and D1Database (env.DB) engine injection with VFS binary B-tree bridge", async () => {
  const { SqliteDatabase } = await import("./engine.js");
  const fs = createMemoryFileSystem();

  // First create a binary SQLite file in VFS using the default engine
  const seedRes = await runSqlite3(fs, [
    "/hey-boss.db",
    "CREATE TABLE issues(number INT PRIMARY KEY, state TEXT, title TEXT); CREATE INDEX idx_issues_state ON issues(state); INSERT INTO issues VALUES (3781, 'closed', 'B-tree reserved space'), (3783, 'open', 'Cloudflare SqlStorage injection');"
  ]);
  assert.equal(seedRes.code, 0, seedRes.stderr);

  // Simulate Cloudflare Durable Object ctx.storage.sql (only exposes exec(sql, ...bindings) -> SqlStorageCursor)
  const backingDoDb = new SqliteDatabase();
  const cloudflareDoSqlStorage = {
    exec(query: string) {
      const sets = backingDoDb.exec(query);
      const last = sets[sets.length - 1];
      const columnNames = last?.columns ?? [];
      const rawRows = last?.rows ?? [];
      return {
        columnNames,
        *raw() {
          for (const r of rawRows) {
            yield r;
          }
        },
        toArray() {
          return rawRows.map((r) => Object.fromEntries(columnNames.map((c, idx) => [c, r[idx]])));
        }
      };
    }
  };

  const cmdDo = createSqlite3Command({ engine: () => cloudflareDoSqlStorage });
  const pipeOut = createBytePipe();
  const pipeErr = createBytePipe();
  const resDo = await cmdDo.execute({
    command: "sqlite3",
    args: createCommandArguments([
      "/hey-boss.db",
      "UPDATE issues SET state = 'closed' WHERE number = 3783;",
      "SELECT number, state, title FROM issues ORDER BY number;",
      ".indexes",
      ".dump"
    ]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: pipeOut.writable,
    stderr: pipeErr.writable,
    signal: new AbortController().signal
  });
  await pipeOut.close();
  await pipeErr.close();
  const outDo = Buffer.from(await collectBytes(pipeOut.readable, { maxBytes: 1_000_000 })).toString("utf8");
  assert.equal(resDo.exitCode, 0);
  assert.match(outDo, /3781\|closed\|B-tree reserved space\n3783\|closed\|Cloudflare SqlStorage injection/);
  assert.match(outDo, /idx_issues_state/);
  assert.match(outDo, /INSERT INTO issues VALUES\(3783,'closed','Cloudflare SqlStorage injection'\);/);

  // Verify the updated database was persisted back to VFS as a valid SQLite format 3 binary file
  const verifySaved = await runSqlite3(fs, ["/hey-boss.db", "SELECT number, state FROM issues ORDER BY number;"]);
  assert.equal(verifySaved.code, 0, verifySaved.stderr);
  assert.equal(verifySaved.stdout, "3781|closed\n3783|closed\n");

  // Simulate Cloudflare D1 (env.DB with prepare(sql).bind(...).raw({ columnNames: true }) / run())
  const backingD1Db = new SqliteDatabase();
  const cloudflareD1 = {
    prepare(query: string) {
      let bound: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bound = values;
          return this;
        },
        async raw(opts?: { columnNames?: boolean }) {
          const sets = backingD1Db.exec(query, bound as any);
          const last = sets[sets.length - 1];
          if (!last || last.columns.length === 0) return [];
          return opts?.columnNames ? [last.columns, ...last.rows] : last.rows;
        },
        async run() {
          backingD1Db.exec(query, bound as any);
          return { success: true };
        }
      };
    }
  };
  const cmdD1 = createSqlite3Command({ engine: cloudflareD1 });
  const d1Out = createBytePipe();
  const d1Err = createBytePipe();
  const resD1 = await cmdD1.execute({
    command: "sqlite3",
    args: createCommandArguments(["/hey-boss.db", "SELECT COUNT(*), MIN(number), MAX(number) FROM issues;"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: d1Out.writable,
    stderr: d1Err.writable,
    signal: new AbortController().signal
  });
  await d1Out.close();
  await d1Err.close();
  const outD1Text = Buffer.from(await collectBytes(d1Out.readable, { maxBytes: 1_000_000 })).toString("utf8");
  assert.equal(resD1.exitCode, 0);
  assert.equal(outD1Text, "2|3781|3783\n");
});


test("sqlite3 rejects missing columns and supports double-quoted string fallback", async () => {
  for (const sql of ["SELECT no_such_col;", "CREATE TABLE t(a INT); SELECT no_such_col FROM t;", "SELECT CASE WHEN 0 THEN no_such_col END;", "CREATE TABLE t(a INT); INSERT INTO t VALUES (NULL); SELECT other.a FROM t;", "SELECT [missing];", "SELECT `missing`;", "CREATE TABLE t(a INT); INSERT INTO t VALUES (1); SELECT no_such_col FROM t;"]) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("Error: in prepare, no such column:"), result.stderr);
  }
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", 'CREATE TABLE t(a INT); INSERT INTO t VALUES (1); SELECT "a", "hello", CASE 1 WHEN 1 THEN "matched" END FROM t;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "1|hello|matched\n");
});

test("sqlite3 preserves REAL expression types and JSON numeric representation", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT 4.0, typeof(4.0), CAST(4 AS REAL), typeof(CAST(4 AS REAL)), ROUND(3.5) + 1, typeof(ROUND(3.5) + 1), AVG(x), typeof(AVG(x)) FROM (SELECT 2 AS x UNION ALL SELECT 4 AS x);"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "4.0|real|4.0|real|5.0|real|3.0|real\n");
  const json = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", "SELECT ROUND(3.5) AS r, TOTAL(x) AS t FROM (SELECT 1 AS x);"]);
  assert.equal(json.stdout, '[{"r":4.0,"t":1.0}]\n');
});


test("sqlite3 REAL arithmetic preserves affinity without changing integer division", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT -4.0, +4.0, 4e0, 0xFE, 4.0-1, 4.0*2, 4.0/2, 4.0%3, 5/2, 5.0/2;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "-4.0|4.0|4.0|254|3.0|8.0|2.0|1.0|2|2.5\n");
});

for (const [name, sql, expected] of [
  ['SUM preserves REAL', 'CREATE TABLE r(x REAL); INSERT INTO r VALUES (1.0),(2.0); SELECT SUM(x),typeof(SUM(x)) FROM r;', '3.0|real\n'],
  ['ABS preserves REAL', 'SELECT ABS(-4.0),typeof(ABS(-4.0)),typeof(ABS(-4));', '4.0|real|integer\n'],
  ['JSON preserves REAL', `SELECT json_array(4.0,4),json_object('r',4.0,'i',4);`, '[4.0,4]|{"r":4.0,"i":4}\n'],
  ['INSERT applies REAL affinity', `CREATE TABLE r(x REAL,y FLOAT,z DOUBLE); INSERT INTO r VALUES (4,'5',6); SELECT x,typeof(x),y,typeof(y),z,typeof(z) FROM r;`, '4.0|real|5.0|real|6.0|real\n'],
  ['unqualified correlated columns', 'CREATE TABLE a(outer_id INT); CREATE TABLE b(aid INT,score INT); INSERT INTO a VALUES (1),(2); INSERT INTO b VALUES (1,99),(2,88); SELECT (SELECT score FROM b WHERE aid=outer_id) FROM a;', '99\n88\n'],
  ['inner columns shadow outer columns', 'CREATE TABLE a(id INT); CREATE TABLE b(id INT); INSERT INTO a VALUES (1); INSERT INTO b VALUES (2); SELECT (SELECT id FROM b), (SELECT a.id FROM b), (SELECT \'a.id\' FROM b) FROM a;', '2|1|a.id\n'],
] as const) {
  test(`sqlite3 ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [':memory:', sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

test('sqlite3 validates JOIN ON identifiers before visiting rows', async () => {
  for (const join of ['JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN']) {
    const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE a(id INT); CREATE TABLE b(id INT); SELECT * FROM a ${join} b ON a.id=b.no_such_col;`]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such column: b.no_such_col/);
  }
});


test('sqlite3 resolves nested, EXISTS, and IN correlations', async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, [':memory:', `CREATE TABLE a(outer_id INT); CREATE TABLE b(aid INT); INSERT INTO a VALUES (1),(2); INSERT INTO b VALUES (1); SELECT outer_id,EXISTS(SELECT aid FROM b WHERE aid=outer_id),outer_id IN (SELECT aid FROM b WHERE aid=outer_id),(SELECT (SELECT outer_id) FROM b) FROM a;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '1|1|1|1\n2|0|0|2\n');
});

test('sqlite3 REAL affinity survives persistence and preserves nonnumeric values', async () => {
  const fs = createMemoryFileSystem();
  const inserted = await runSqlite3(fs, ['/real.db', `CREATE TABLE r(x REAL); INSERT INTO r VALUES (4),(NULL),('text');`]);
  assert.equal(inserted.code, 0, inserted.stderr);
  const result = await runSqlite3(fs, ['/real.db', 'SELECT x,typeof(x) FROM r;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '4.0|real\n|null\ntext|text\n');
});

test('sqlite3 JSON aggregates preserve REAL numbers and escaped strings', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE r(x REAL); INSERT INTO r VALUES (4),(5); SELECT json_group_array(x),json_group_object('r',x) FROM r; SELECT json_array('quote"',NULL,4.5);`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '[4.0,5.0]|{"r":4.0,"r":5.0}\n["quote\\"",null,4.5]\n');
});


test('sqlite3 emits valid JSON for exponential REAL numbers', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', 'SELECT json_array(1e21,1e-20);']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [1e21, 1e-20]);
});

test("sqlite3 settings disable all resource ceilings by default", () => {
  assert.deepEqual(settings.limits, { maxInputBytes: Infinity, maxOutputBytes: Infinity, maxRows: Infinity });
});

for (const operation of ["INSERT", "UPDATE", "UPSERT"]) {
  test(`sqlite3 applies column affinities on ${operation}`, async () => {
    for (const [values, expected] of [
      ["'42', 42, '42.0', '42'", "42|integer|42|text|42|integer|42.0|real\n"],
      ["42.0, 42.5, 42.0, 7", "42|integer|42.5|text|42|integer|7.0|real\n"],
      ["'42.5', 'hello', '42.5', 'hello'", "42.5|real|hello|text|42.5|real|hello|text\n"],
      ["NULL, x'4142', '0x10', NULL", "|null|AB|blob|0x10|text||null\n"]
    ] as const) {
      const assignments = values.split(", ").map((value, index) => `${["i", "s", "n", "r"][index]} = ${value}`).join(", ");
      const write = operation === "INSERT" ? `INSERT INTO t VALUES (1, ${values});`
        : operation === "UPDATE" ? `INSERT INTO t VALUES (1, NULL, NULL, NULL, NULL); UPDATE t SET ${assignments};`
        : `INSERT INTO t VALUES (1, NULL, NULL, NULL, NULL); INSERT INTO t VALUES (1, NULL, NULL, NULL, NULL) ON CONFLICT(id) DO UPDATE SET ${assignments};`;
      const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
        `CREATE TABLE t(id INT PRIMARY KEY, i INT, s TEXT, n NUMERIC, r REAL); ${write} SELECT i, typeof(i), s, typeof(s), n, typeof(n), r, typeof(r) FROM t;`]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, expected, values);
    }
  });
}

for (const query of [
  "SELECT (SELECT no_such_col FROM b) FROM a",
  "SELECT * FROM a WHERE EXISTS (SELECT no_such_col FROM b)",
  "SELECT * FROM a WHERE id IN (SELECT no_such_col FROM b)",
  "SELECT (SELECT (SELECT no_such_col FROM b)) FROM a"
]) {
  test(`sqlite3 prepares empty-table subqueries: ${query}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
      `CREATE TABLE a(id INT); CREATE TABLE b(id INT); ${query};`]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such column: no_such_col/);
  });
}

test("sqlite3 prepares correlated and CTE subqueries without evaluating skipped expressions", async () => {
  for (const rows of ["", "INSERT INTO a VALUES (1);"]) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
      `CREATE TABLE a(id INT); CREATE TABLE b(id INT); ${rows}
       WITH c(v) AS (SELECT 1) SELECT (SELECT v FROM c WHERE v = a.id),
       CASE WHEN 0 THEN (SELECT abs(-9223372036854775808)) ELSE 2 END FROM a;`]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, rows ? "1|2\n" : "");
  }
});


test("sqlite3 preparation validates table-function arguments without executing them", async () => {
  const valid = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); SELECT (SELECT value FROM json_each('malformed')) FROM a;"]);
  assert.equal(valid.code, 0, valid.stderr);
  const invalid = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); SELECT (SELECT value FROM json_each(no_such_col)) FROM a;"]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /no such column: no_such_col/);
});

test("sqlite3 affinity respects declared-type precedence and preserves unconvertible values", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    `CREATE TABLE t(a CHARINT, b CLOB, c DOUBLE, d BLOB, e, f DECIMAL, g FLOATINGPOINT);
     INSERT INTO t VALUES ('3.0e+5', 42.0, '4.5', 42.0, '42', ' 42 ', '42.0');
     SELECT a, typeof(a), b, typeof(b), c, typeof(c), d, typeof(d), e, typeof(e), f, typeof(f), g, typeof(g) FROM t;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "300000|integer|42.0|text|4.5|real|42.0|real|42|text|42|integer|42|integer\n");
});

test("sqlite3 prepares table-function correlations against preceding FROM sources", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); CREATE TABLE b(doc TEXT); SELECT (SELECT value FROM b, json_each(b.doc)) FROM a;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("sqlite3 prepares recursive CTE terms inside empty-table subqueries", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); SELECT (WITH RECURSIVE c(v) AS (SELECT 1 UNION ALL SELECT no_such_col FROM c) SELECT v FROM c) FROM a;"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no such column: no_such_col/);
});

test("sqlite3 CLI preserves mutation scopes and exact integers", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE t(a INT, b INT); INSERT INTO t VALUES (1, 9007199254740993), (2, 1); " +
    "DELETE FROM t AS u WHERE u.a = 999; " +
    "WITH c(v) AS (SELECT 1) UPDATE t AS u SET b = u.b + (SELECT v FROM c) WHERE u.a = 1 RETURNING t.b, _rowid_, oid; " +
    "SELECT SUM(b), CAST('9007199254740993' AS INTEGER) FROM t; " +
    "WITH c(v) AS (SELECT 2) DELETE FROM t WHERE a = (SELECT v FROM c) RETURNING t.a;"
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "9007199254740994|1|1\n9007199254740995|9007199254740993\n2\n");
});

test("sqlite3 JSON output retains exact int64 numeric tokens", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", "SELECT 9007199254740993 AS x, -9223372036854775808 AS y"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), '[{"x":9007199254740993,"y":-9223372036854775808}]');
});

test("sqlite3 rejects invalid configured limits", () => {
  for (const key of ["maxInputBytes", "maxOutputBytes", "maxRows"] as const) {
    for (const value of [-1, NaN, -Infinity, 1.5]) {
      assert.throws(() => createSqlite3Command({ limits: { [key]: value } }), RangeError);
    }
    assert.doesNotThrow(() => createSqlite3Command({ limits: { [key]: Infinity } }));
    assert.doesNotThrow(() => createSqlite3Command({ limits: { [key]: 0 } }));
  }
});

test("sqlite3 reports unknown dot commands and honors bail", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), ["-bail", ":memory:"], ".not_a_command\n.print unreachable");
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, 'Error: unknown command or invalid arguments:  "not_a_command". Enter ".help" for help\n');
  assert.equal((await runSqlite3(createMemoryFileSystem(), [":memory:", ".help"])).code, 0);
});

test("sqlite3 counts UTF-8 input across stdin, SQL arguments and input files", async () => {
  for (const source of ["stdin", "argument", "read", "init", "import", "database"] as const) {
    const fs = createMemoryFileSystem();
    const text = "SELECT 'é';";
    await fs.writeFile("/input", new TextEncoder().encode(text));
    const args = source === "argument" ? [":memory:", text]
      : source === "read" ? [":memory:", ".read /input"]
      : source === "init" ? ["-init", "/input", ":memory:"]
      : source === "import" ? [":memory:", ".import /input t"]
      : source === "database" ? ["/input"] : [":memory:"];
    const result = await runSqlite3(fs, args, source === "stdin" ? text : "", { limits: { maxInputBytes: 1 } });
    assert.equal(result.code, 1, source);
    assert.match(result.stderr, /maxInputBytes/, source);
  }
  const exact = new TextEncoder().encode("SELECT 'é';").length;
  assert.equal((await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT 'é';"], "", { limits: { maxInputBytes: exact } })).code, 0);
});

test("sqlite3 bounds cumulative output including UTF-8 and output files", async () => {
  for (const destination of ["stdout", "output", "once"] as const) {
    const fs = createMemoryFileSystem();
    const args = [":memory:", ...(destination === "stdout" ? [] : [`.${destination} /result`]), "SELECT 'é';", "SELECT 'é';"];
    const result = await runSqlite3(fs, args, "", { limits: { maxOutputBytes: 3 } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /maxOutputBytes/);
    if (destination === "stdout") assert.equal(result.stdout, "é\n");
    else assert.equal(new TextDecoder().decode(await fs.readFile("/result")), "é\n");
  }
});

test("sqlite3 bounds result sets and table rows before persistence", async () => {
  for (const sql of ["SELECT 1 UNION ALL SELECT 2;", "CREATE TABLE t(x); INSERT INTO t VALUES (1), (2);"]) {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/db", sql], "", { limits: { maxRows: 1 } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /maxRows/);
    assert.equal(result.stdout, "");
    await assert.rejects(fs.readFile("/db"));
  }
});

test("sqlite3 applies output limit to serialized databases", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/db", "CREATE TABLE t(x);"], "", { limits: { maxOutputBytes: 1 } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /maxOutputBytes/);
  await assert.rejects(fs.readFile("/db"));
});


test("sqlite3 enforces row budgets on imports, database reloads and injected engines", async () => {
  const fs = createMemoryFileSystem();
  const seed = await runSqlite3(fs, ["/seed.db", "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2);"]);
  assert.equal(seed.code, 0);
  const loaded = await runSqlite3(fs, ["/seed.db"], "", { limits: { maxRows: 1 } });
  assert.equal(loaded.code, 1);
  assert.match(loaded.stderr, /maxRows/);
  await fs.writeFile("/rows.csv", new TextEncoder().encode("x\n1\n2\n"));
  const imported = await runSqlite3(fs, ["/import.db", ".import --csv /rows.csv t"], "", { limits: { maxRows: 1 } });
  assert.equal(imported.code, 1);
  assert.match(imported.stderr, /maxRows/);
  await assert.rejects(fs.readFile("/import.db"));
  const { SqliteDatabase } = await import("./engine.js");
  const backing = new SqliteDatabase();
  const injected = await runSqlite3(fs, [":memory:", "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2);"], "", {
    engine: { exec: (sql: string) => backing.exec(sql) }, limits: { maxRows: 1 }
  });
  assert.equal(injected.code, 1);
  assert.match(injected.stderr, /maxRows/);
});

test("sqlite3 supports exact and zero budgets and counts repeated reads", async () => {
  const fs = createMemoryFileSystem();
  const empty = await runSqlite3(fs, [":memory:"], "", { limits: { maxInputBytes: 0, maxOutputBytes: 0, maxRows: 0 } });
  assert.equal(empty.code, 0);
  const zero = await runSqlite3(fs, [":memory:", "SELECT 1;"], "", { limits: { maxRows: 0 } });
  assert.equal(zero.code, 1);
  await fs.writeFile("/script", new TextEncoder().encode("SELECT 1;"));
  const script = ".read /script\n.read /script";
  const repeated = await runSqlite3(fs, [":memory:", script], "", { limits: { maxInputBytes: script.length + 9 } });
  assert.equal(repeated.code, 1);
  assert.equal(repeated.stdout, "1\n");
  assert.match(repeated.stderr, /maxInputBytes/);
  const quit = await runSqlite3(fs, ["/quit.db"], "CREATE TABLE t(x);\n.quit");
  assert.equal(quit.code, 0);
  assert.ok((await fs.readFile("/quit.db")).length > 0);
});

test("dot-command CSV uses CRLF and returning to list restores separators", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", ".mode csv", "SELECT 1,2;", ".mode list", "SELECT 3,4;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "1,2\r\n3|4\n");
});

test("CLI CSV flag retains LF row separators", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), ["-csv", ":memory:", "SELECT 1,2;"]);
  assert.equal(result.stdout, "1,2\n");
});

for (const [name, script, expected] of [
  ["CSV to list", ".mode csv\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1,2\r\n3|4\n"],
  ["tabs to list", ".mode tabs\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1\t2\n3|4\n"],
  ["CSV to tabs to list", ".mode csv\nSELECT 1,2;\n.mode tabs\nSELECT 3,4;\n.mode list\nSELECT 5,6;", "1,2\r\n3\t4\r\n5|6\n"],
  ["list resets both custom separators", ".separator : !\n.mode list\nSELECT 1,2;\n.separator @ ~\nSELECT 3,4;\n.mode list\nSELECT 5,6;", "1|2\n3@4~5|6\n"],
  ["tabs honors separator overrides", ".mode tabs\n.separator : !\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1:2!3|4\n"],
  ["CSV honors a pipe separator", ".mode csv\n.separator | !\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1|2!3|4\n"],
  ["ASCII to tabs", ".mode ascii\nSELECT 1,2;\n.mode tabs\nSELECT 3,4;\n.mode list\nSELECT 5,6;", "1\x1f2\x1e3\t4\x1e5|6\n"],
  ["ASCII honors separator overrides", ".mode ascii\n.separator : !\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1:2!3|4\n"]
] as const) {
  test(`sqlite3 sync and async mode separators: ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), expected);
  });
}

for (const mode of ["line", "column", "quote"]) {
  test(`sqlite3 ${mode} mode resets the row separator in both execution paths`, async () => {
    const script = `.separator : !\n.mode ${mode}\n.mode tabs\n.headers off\nSELECT 1,2;`;
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "1\t2\n");
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), "1\t2\n");
  });
}

test("sqlite3 imports typed CSV columns with affinity and retains their types after reopening", async () => {
  const fs = createMemoryFileSystem();
  const csv = new TextEncoder().encode('"Bob, Jr.",10,88.0,3.0e+5,4,5\n');
  await fs.writeFile("/typed.csv", csv);
  const script = [
    "CREATE TABLE imp(a TEXT, b INT, c REAL, d NUMERIC, e FLOAT, f DOUBLE);",
    ".mode csv", ".import /typed.csv imp", ".mode list",
    "SELECT a,b,typeof(b),c,typeof(c),d,typeof(d),e,typeof(e),f,typeof(f) FROM imp;",
    ".mode json", "SELECT * FROM imp;"
  ].join("\n");
  const expected = 'Bob, Jr.|10|integer|88.0|real|300000|integer|4.0|real|5.0|real\n[{"a":"Bob, Jr.","b":10,"c":88.0,"d":300000,"e":4.0,"f":5.0}]\n';
  const result = await runSqlite3(fs, ["/typed.db"], script);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, expected);
  const reopened = await runSqlite3(fs, ["-json", "/typed.db", "SELECT * FROM imp;"]);
  assert.equal(reopened.code, 0, reopened.stderr);
  assert.equal(reopened.stdout, expected.slice(expected.indexOf("[")));

  const files = new Map<string, Uint8Array>([["/typed.csv", csv]]);
  const read = (path: string) => files.get(path);
  const write = (path: string, bytes: Uint8Array) => { files.set(path, bytes); return true; };
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), ["/typed.db"], read, write), expected);
  assert.equal(evalSyncSqlite3(undefined, ["-json", "/typed.db", "SELECT * FROM imp;"], read, write), reopened.stdout);
});

for (const [mode, separator, importOptions, data] of [
  ["csv", "|", "", "foo|10\nbar|20\n"],
  ["list", ":", "--csv ", "foo,10\nbar,20\n"]
] as const) {
  test(`sqlite3 import respects ${importOptions || mode} separators and column affinity`, async () => {
    const fs = createMemoryFileSystem();
    const bytes = new TextEncoder().encode(data);
    await fs.writeFile("/rows.csv", bytes);
    const script = `CREATE TABLE imp(a TEXT,b INT);\n.mode ${mode}\n.separator ${separator}\n.import ${importOptions}/rows.csv imp\n.mode list\nSELECT a,b,typeof(b) FROM imp;`;
    const expected = "foo|10|integer\nbar|20|integer\n";
    const result = await runSqlite3(fs, [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => bytes), expected);
  });
}

for (const [mode, expected] of [
  ["-list", "88.0|4.0|5.0|real|real|real\n"],
  ["-csv", "88.0,4.0,5.0,real,real,real\n"],
  ["-line", "    r = 88.0\n    f = 4.0\n    d = 5.0\n   rt = real\n   ft = real\n   dt = real\n"],
  ["-json", '[{"r":88.0,"f":4.0,"d":5.0,"rt":"real","ft":"real","dt":"real"}]\n']
] as const) {
  test(`sqlite3 REAL, FLOAT and DOUBLE storage classes survive ${mode} formatting and persistence`, async () => {
    const fs = createMemoryFileSystem();
    const select = "SELECT r,f,d,typeof(r) AS rt,typeof(f) AS ft,typeof(d) AS dt FROM t;";
    const sql = `CREATE TABLE t(r REAL, f FLOAT, d DOUBLE); INSERT INTO t VALUES (88.0, 4, '5'); ${select}`;
    const result = await runSqlite3(fs, [mode, "/real.db", sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    const reopened = await runSqlite3(fs, [mode, "/real.db", select]);
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(reopened.stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, [mode, ":memory:", sql]), expected);
  });
}

for (const sql of [
  "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<50000) SELECT count(*) FROM c;",
  "SELECT count(*) FROM generate_series(1,150000);",
  "SELECT count(*) FROM t a CROSS JOIN t b;",
  "SELECT sum(x) FROM t;",
  Array.from({ length: 1000 }, () => "SELECT 1;").join("")
]) {
  test(`cooperatively yields and cancels with a frozen Workers clock: ${sql.slice(0, 80)}`, async () => {
    const fs = createMemoryFileSystem();
    if (sql.includes("FROM t")) {
      const setup = await runSqlite3(fs, [
        "/db",
        "CREATE TABLE t(x); INSERT INTO t SELECT value FROM generate_series(1,5000);"
      ]);
      assert.equal(setup.code, 0, setup.stderr);
    }
    const host = globalThis as typeof globalThis & { setImmediate?: typeof setImmediate };
    const immediate = host.setImmediate;
    const timeout = host.setTimeout;
    const now = Date.now;
    const performanceNow = Object.getOwnPropertyDescriptor(performance, "now");
    let turns = 0;
    const controller = new AbortController();
    try {
      Reflect.deleteProperty(host, "setImmediate");
      Date.now = () => 0;
      Object.defineProperty(performance, "now", { configurable: true, value: () => 0 });
      host.setTimeout = ((
        callback: (...args: unknown[]) => void,
        ms?: number,
        ...args: unknown[]
      ) => {
        if (ms === 0) {
          turns++;
          if (turns === 3)
            return timeout(() => controller.abort(new Error("cancel SQLite workload")), 0);
        }
        return timeout(callback, ms, ...args);
      }) as typeof setTimeout;
      const pending = runSqlite3(
        fs,
        [sql.includes("FROM t") ? "/db" : ":memory:", sql],
        "",
        {},
        controller.signal
      );
      await assert.rejects(pending, /cancel SQLite workload/);
      assert.ok(turns >= 3);
    } finally {
      host.setImmediate = immediate;
      host.setTimeout = timeout;
      Date.now = now;
      if (performanceNow) Object.defineProperty(performance, "now", performanceNow);
      else Reflect.deleteProperty(performance, "now");
    }
  });
}

for (const sql of [
  "SELECT count(*) FROM generate_series(1,1000);",
  "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<1000) SELECT count(*) FROM c;"
]) {
  test(`maxRows bounds generated rows before aggregation: ${sql}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql], "", {
      limits: { maxRows: 10 }
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /maxRows/);
    assert.equal(result.stdout, "");
  });
}

test("maxRows bounds joins before aggregation and prevents saving earlier writes", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/db", "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2); SELECT count(*) FROM t a CROSS JOIN t b;"], "", { limits: { maxRows: 2 } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /maxRows/);
  assert.equal(result.stdout, "");
  await assert.rejects(fs.readFile("/db"));
});

test('sqlite3 applies REAL affinity on UPDATE and ALTER defaults', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', "CREATE TABLE r(x REAL); INSERT INTO r VALUES(1); UPDATE r SET x='4'; ALTER TABLE r ADD y DOUBLE DEFAULT 5; SELECT x,typeof(x),y,typeof(y) FROM r;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '4.0|real|5.0|real\n');
});

test('sqlite3 JSON constructors distinguish text and JSON and preserve duplicate keys', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `SELECT json_array('[1]',json('[1]')),json_object('a',1,'a',2); CREATE TABLE t(x TEXT); INSERT INTO t VALUES('[1]'),('[2]'); SELECT json_group_array(x),json_group_object('a',x) FROM t;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '["[1]",[1]]|{"a":1,"a":2}\n["[1]","[2]"]|{"a":"[1]","a":"[2]"}\n');
});

for (const expression of ['(SELECT missing FROM b)', 'id IN (SELECT missing FROM b)', 'EXISTS(SELECT missing FROM b)', '(SELECT id FROM b WHERE missing = a.id)']) {
  test(`sqlite3 validates subquery columns with empty outer rows: ${expression}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE a(id INT); CREATE TABLE b(id INT); SELECT ${expression} FROM a;`]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such column: missing/);
  });
}

test('sqlite3 accepts correlated schema references with empty outer rows', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', 'CREATE TABLE a(outer_id INT); CREATE TABLE b(id INT); SELECT (SELECT outer_id FROM b),outer_id IN (SELECT id FROM b WHERE id=a.outer_id),(SELECT (SELECT outer_id) FROM b) FROM a;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
});


test('sqlite3 JSON subtype is cleared by stored and derived tables and scalar subqueries', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE t(x TEXT); INSERT INTO t VALUES(json('[1]')); SELECT json_array(x),typeof(x) FROM t; SELECT json_array(x) FROM (SELECT json('[1]') AS x); SELECT json_array((SELECT json('[1]'))); SELECT json_array(json_extract('{"x":"[1]"}','$.x'),json_extract('{"x":[1]}','$.x')); SELECT json_array(json('{"a":1,"a":2}')); SELECT json('[1]')='[1]',typeof(json('[1]')),quote(json('[1]'));`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '["[1]"]|text\n["[1]"]\n["[1]"]\n["[1]",[1]]\n[{"a":1,"a":2}]\n1|text|\'[1]\'\n');
});


test('sqlite3 preserves ALTER REAL column defaults across database reopen and later inserts', async () => {
  const fs = createMemoryFileSystem();
  const created = await runSqlite3(fs, ['/alter.db', 'CREATE TABLE r(x INTEGER); INSERT INTO r VALUES(1); ALTER TABLE r ADD y DOUBLE DEFAULT 5;']);
  assert.equal(created.code, 0, created.stderr);
  const reopened = await runSqlite3(fs, ['/alter.db', 'INSERT INTO r(x) VALUES(2); SELECT x,y,typeof(y) FROM r ORDER BY x;']);
  assert.equal(reopened.code, 0, reopened.stderr);
  assert.equal(reopened.stdout, '1|5.0|real\n2|5.0|real\n');
});


test('sqlite3 applies REAL affinity to integer and numeric TEXT updates and REAL ALTER defaults', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', "CREATE TABLE r(x REAL); INSERT INTO r VALUES(1); UPDATE r SET x=6; SELECT x,typeof(x) FROM r; UPDATE r SET x='7'; ALTER TABLE r ADD y REAL DEFAULT 5; SELECT x,typeof(x),y,typeof(y) FROM r;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '6.0|real\n7.0|real|5.0|real\n');
});

test('sqlite3 quotes JSON-looking TEXT literals in quote, array, and object constructors', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `SELECT json_quote('[1, 2]'),json_array('[1, 2]'),json_object('k','{"a":1}');`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `"[1, 2]"|["[1, 2]"]|{"k":"{\\"a\\":1}"}\n`);
});


test('sqlite3 checks unboxed JSON text before applying REAL affinity', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE r(x REAL); INSERT INTO r VALUES(json('7')),(json('"x"')); SELECT x,typeof(x) FROM r;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '7.0|real\n"x"|text\n');
});

for (const [name, sql, expected] of [
  ["conditional projections over nullable rows",
    "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, 'x'), (2, NULL), (3, 'y'); SELECT a, COALESCE(b, 'none'), IFNULL(b, 'fallback'), IIF(a > 1, 'yes', 'no') FROM t ORDER BY a DESC;",
    "3|y|y|yes\n2|none|fallback|yes\n1|x|x|no\n"],
  ["aggregate IN in HAVING",
    "CREATE TABLE items(g TEXT, v INT); INSERT INTO items VALUES ('a', 1), ('a', 2), ('b', 5), ('c', 9); SELECT g FROM items GROUP BY g HAVING SUM(v) IN (3, 5) ORDER BY g;",
    "a\nb\n"],
  ["aggregate IN operands and NULL semantics",
    "CREATE TABLE t(v INT); INSERT INTO t VALUES (1), (2); SELECT COUNT(*) IN (1, 2), 3 IN (SUM(v)), SUM(v) NOT IN (4, 5), SUM(v) IN (4, NULL), SUM(v) NOT IN (4, NULL), SUM(v) IN (), SUM(v) NOT IN () FROM t;",
    "1|1|1|||0|1\n"],
  ["empty aggregate IN operands",
    "CREATE TABLE t(v INT); SELECT COUNT(*) IN (0, 1), SUM(v) IN (0), SUM(v) IN (), SUM(v) NOT IN () FROM t;",
    "1||0|1\n"],
  ["double-quoted INSERT strings and column precedence (DQS enabled)",
    'CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, "x"), (2, NULL), (3, "y"); SELECT "a", "b", "---" FROM t ORDER BY a;',
    "1|x|---\n2||---\n3|y|---\n"],
  ["recursive aggregate REAL formatting",
    "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 5) SELECT SUM(x), COUNT(*), AVG(x), TOTAL(x) FROM cnt;",
    "15|5|3.0|15.0\n"]
]) {
  test(`sqlite3 preserves expression parity: ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql!]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

for (const limits of [undefined, { maxInputBytes: Infinity, maxOutputBytes: Infinity, maxRows: Infinity }]) {
  test(`sqlite3 executes beyond former byte and row ceilings with ${limits ? "explicit Infinity" : "defaults"}`, async () => {
    const payload = "x".repeat(16 * 1024 * 1024 + 1);
    const sql = `SELECT '${payload}';`;
    const large = await runSqlite3(createMemoryFileSystem(), [":memory:", sql], "", {
      limits,
      engine: { exec: (query: string) => {
        assert.equal(query.length, sql.length - 1);
        assert.ok(query === sql.slice(0, -1));
        return [{ columns: ["value"], rows: [[payload]] }];
      } }
    });
    assert.equal(large.code, 0, large.stderr);
    assert.equal(large.stdout, payload + "\n");
    const rows = await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT value;"], "", {
      limits,
      engine: { exec: () => [{ columns: ["value"], rows: Array.from({ length: 100_001 }, () => [1]) }] }
    });
    assert.equal(rows.code, 0, rows.stderr);
    assert.equal(rows.stdout, "1\n".repeat(100_001));
  });
}

// Expected results checked against /usr/bin/sqlite3 3.43.2.
for (const [expression, expected] of [
  ["unhex('4142')", "X'4142'"],
  ["unhex('41 42')", "NULL"],
  ["unhex('41 42',' ')", "X'4142'"],
  ["unhex('41-42','-')", "X'4142'"],
  ["unhex('--41 :42--','- :')", "X'4142'"],
  ["unhex('4-1','-')", "NULL"],
  ["unhex('4142','14')", "X'4142'"],
  ["unhex('41-42',' ')", "NULL"],
  ["unhex('414')", "NULL"],
  ["unhex('41gg')", "NULL"],
  ["unhex('')", "X''"],
  ["unhex('--','-')", "X''"],
  ["unhex(NULL,'-')", "NULL"],
  ["unhex('4142',NULL)", "NULL"],
] as const) {
  test(`sqlite3 UNHEX native semantics in both execution paths: ${expression}`, async () => {
    const sql = `SELECT quote(${expression});`;
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql]),
      { code: 0, stdout: `${expected}\n`, stderr: "" });
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), `${expected}\n`);
  });
}

// Expected results checked against /usr/bin/sqlite3 3.43.2.
for (const [mode, expected] of [
  ["-json", '[{"precise":1.234567890123456691,"small":1.000000000000000082e-05,"large":1.0e+20,"overflow":9223372036854775810.0,"integer":9223372036854775807,"tiny":-9.99999999999999946e-21,"huge":1.000000000000000019e+30,"zero":0.0}]\n'],
  ["-list", "1.23456789012346|1.0e-05|1.0e+20|9.22337203685478e+18|9223372036854775807|-1.0e-20|1.0e+30|0.0\n"]
] as const) {
  test(`sqlite3 REAL precision matches native in ${mode}`, async () => {
    const sql = "SELECT 1.2345678901234567 AS precise, 1e-5 AS small, 1e20 AS large, 9223372036854775807+1 AS overflow, 9223372036854775807 AS integer, -1e-20 AS tiny, 1e30 AS huge, 0.0 AS zero;";
    const result = await runSqlite3(createMemoryFileSystem(), [mode, ":memory:", sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, [mode, ":memory:", sql]), expected);
    if (mode === "-json") {
      const [row] = JSON.parse(result.stdout);
      assert.equal(row.precise, 1.2345678901234567);
      assert.equal(row.overflow, 9223372036854775808);
    }
  });
}

for (const escape of ["''", "'!!'", "'😀😀'", "'!' || '!'"]) {
  test(`sqlite3 rejects invalid LIKE ESCAPE length: ${escape}`, async () => {
    const sql = `SELECT 'a_c' LIKE 'a!_c' ESCAPE ${escape};`;
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql]), {
      code: 1,
      stdout: "",
      stderr: "Error: stepping, ESCAPE expression must be a single character\n"
    });
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), undefined);
  });
}

// Expected results checked against /usr/bin/sqlite3 3.43.2.
for (const [label, sql, expected] of [
  ["GLOB treats exclamation marks as literal class members", "SELECT '!' GLOB '[!a]', 'a' GLOB '[!a]', 'b' GLOB '[!a]', '!' GLOB '[!]', 'a' GLOB '[!]', glob('[!a]', 'a'), 'a' NOT GLOB '[!a]', 'b' GLOB '[^a]', 'a' GLOB '[^a]', '!' GLOB '[^!]', 'a' GLOB '[^!]';", "1|1|0|1|0|1|0|1|0|0|1\n"],
  ["GLOB classes accept literal brackets", "SELECT ']' GLOB '[]]', 'a' GLOB '[]a]', ']' GLOB '[]a]', 'b' GLOB '[]a]', '[' GLOB '[[]', ']' GLOB '[^]]', 'a' GLOB '[^]]', 'a' GLOB '[^]a]', 'b' GLOB '[^]a]', glob('[]]', ']'), ']' NOT GLOB '[]]';", "1|1|1|0|1|0|1|0|1|1|0\n"],
  ["LIKE rejects dangling escapes", "SELECT 'a!' LIKE 'a!' ESCAPE '!', 'a' LIKE 'a!' ESCAPE '!', 'a!' LIKE 'a!!' ESCAPE '!', like('a!', 'a!', '!'), like('a!', 'a', '!'), like('a!!', 'a!', '!'), 'a!' NOT LIKE 'a!' ESCAPE '!', 'abc!' LIKE '%!' ESCAPE '!', '' LIKE '!' ESCAPE '!', 'a😀' LIKE 'a😀' ESCAPE '😀', like('a😀', 'a😀', '😀'), 'a!' LIKE 'a!';", "0|0|1|0|0|1|1|0|0|0|0|1\n"],
  ["LIKE ESCAPE preserves NULL and evaluated single characters", "SELECT 'a_c' LIKE 'a!_c' ESCAPE NULL, NULL LIKE 'a!_c' ESCAPE '!', 'a_c' LIKE NULL ESCAPE '!', 'a_c' LIKE 'a!_c' ESCAPE substr('!!', 1, 1), 'a_c' NOT LIKE 'a!_c' ESCAPE '!';", "|||1|0\n"],
  ["LIKE counts Unicode code points", "SELECT char(0x1F600) LIKE '_', char(0x1F600) LIKE '__', char(0xE000) LIKE '_', 'a😀b' LIKE 'a_b', '😀😀' LIKE '__', '😀' LIKE '%_', like('_', '😀'), '😀' NOT LIKE '_';", "1|0|1|1|1|1|1|0\n"],
  ["GLOB counts Unicode code points", "SELECT char(0x1F600) GLOB '?', char(0x1F600) GLOB '??', char(0xE000) GLOB '?', 'a😀b' GLOB 'a?b', '😀😀' GLOB '??', '😀' GLOB '*?', glob('?', '😀'), '😀' NOT GLOB '?', '😀' GLOB '[😀]', '😁' GLOB '[😀-😂]';", "1|0|1|1|1|1|1|0|1|1\n"],
  ["LIKE accepts Unicode escape characters", "SELECT 'a_c' LIKE 'a'||char(0x1F600)||'_c' ESCAPE char(0x1F600), like('a😀_c', 'a_c', '😀'), 'a%c' LIKE 'a😀%c' ESCAPE '😀', '😀' LIKE '😀😀' ESCAPE '😀', '😀' LIKE '😀', '😀' GLOB '😀';", "1|1|1|1|1|1\n"],
  ["LIKE folds ASCII case only", "SELECT 'É' LIKE 'é', 'é' LIKE 'É', 'a' LIKE 'A', 'Z' LIKE 'z', 'é' LIKE 'é', 'École' LIKE 'é%', 'École' LIKE 'ÉCO%', 'é' NOT LIKE 'É', like('É', 'é'), like('A', 'a'), 'É' GLOB 'é';", "0|0|1|1|1|0|1|1|0|1|0\n"],
  ["LIKE escapes preserve ASCII-only folding", "SELECT 'É' LIKE '!é' ESCAPE '!', 'a' LIKE '!A' ESCAPE '!', 'A' LIKE 'aA' ESCAPE 'a', 'a' LIKE 'AA' ESCAPE 'A', 'é_%' LIKE 'é!_!%' ESCAPE '!', like('!é', 'É', '!');", "0|1|1|1|1|0\n"],
  ["REAL arithmetic and aggregates", "SELECT 5.0 / 2, 10.0 / 4, CAST(5 AS REAL) / 2, 1.0 + 2.0, TOTAL(NULL), 5 / 2;", "2.5|2.5|2.5|3.0|0.0|2\n"],
  ["NULL boolean truth tables", "WITH t(x) AS (VALUES(NULL),(0),(1)) SELECT a.x AND b.x, a.x OR b.x FROM t a CROSS JOIN t b;", "|\n0|\n|1\n0|\n0|0\n0|1\n|1\n0|1\n1|1\n"],
  ["NULL BETWEEN comparisons", "SELECT 5 BETWEEN NULL AND 3, 5 NOT BETWEEN NULL AND 3, 5 NOT BETWEEN 6 AND NULL, 5 BETWEEN NULL AND 6, 5 NOT BETWEEN 3 AND NULL, NULL BETWEEN 1 AND 2;", "0|1|1|||\n"],
  ["NULL BETWEEN filtering", "WITH t(x) AS (VALUES(2),(5),(7)) SELECT x FROM t WHERE x NOT BETWEEN NULL AND 3;", "5\n7\n"],
  ["substring zero and out-of-range starts", "SELECT SUBSTR('abcdef',0,3), SUBSTR('abcdef',0,1), SUBSTR('abcdef',0,0), SUBSTR('abcdef',0,-3), SUBSTR('abcdef',0), SUBSTR('abcdef',-9,5), SUBSTR('abcdef',3,-2), SUBSTR('😀abc',0,3);", "ab||||abcdef|ab|ab|😀a\n"]
] as const) {
  test(`sqlite3 native semantics in both execution paths: ${label}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), expected);
  });
}

for (const [name, pattern, matches] of [
  ["a[b_c", "a[b_c", true], ["a[b]_c", "a[b]_c", true],
  ["a(b_c", "a(b_c", true], ["a\\b_c", "a\\b_c", true],
  ["abc_def", "abc_def", true], ["abc_def", "%bc_d%", true],
  ["abc_def", "bc_d", false], ["abc_def", "bc", false],
  ["abc_def", "abc*", false], ["ABC_def", "abc%", true],
  ["École", "é%", false], ["école", "É%", false], ["École", "ÉCO%", true]
] as const) {
  test(`sqlite3 .tables uses literal SQL LIKE patterns: ${name}, ${pattern}`, async () => {
    const script = `CREATE TABLE "${name}"(id INT);\n.tables ${pattern}\n`;
    const expected = matches ? `${name}\n` : "";
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), expected);
  });
}

test("sqlite3 preserves REAL storage after reopening", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/real.db", "CREATE TABLE t(x REAL); INSERT INTO t VALUES (5); SELECT x, x / 2, typeof(x) FROM t;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "5.0|2.5|real\n");
  const reopened = await runSqlite3(fs, ["/real.db", "SELECT x, x / 2, typeof(x) FROM t;"]);
  assert.deepEqual(reopened, { code: 0, stdout: result.stdout, stderr: "" });
});

for (const sql of ["-- comment\nINSERT INTO t VALUES(2)", "/* comment */ INSERT INTO t VALUES(2)", "WITH s AS (SELECT 2) INSERT INTO t SELECT * FROM s"]) {
  test(`sqlite3 persists and guards prefixed mutations: ${sql}`, async () => {
    const fs = createMemoryFileSystem();
    assert.equal((await runSqlite3(fs, ["/db", "CREATE TABLE t(x); INSERT INTO t VALUES(1)"])).code, 0);
    const denied = await runSqlite3(fs, ["-readonly", "/db", sql]);
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /readonly/);
    const written = await runSqlite3(fs, ["/db", sql]);
    assert.equal(written.code, 0, written.stderr);
    assert.equal((await runSqlite3(fs, ["/db", "SELECT * FROM t ORDER BY x"])).stdout, "1\n2\n");
  });
}
for (const command of [".import /data t", ".restore /backup"]) {
  test(`sqlite3 readonly rejects ${command}`, async () => {
    const fs = createMemoryFileSystem();
    await runSqlite3(fs, ["/db", "CREATE TABLE t(x); INSERT INTO t VALUES(1)"]);
    await fs.writeFile("/data", new TextEncoder().encode("2\n"));
    await fs.writeFile("/backup", await fs.readFile("/db"));
    const result = await runSqlite3(fs, ["-readonly", "/db"], command + "\n");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /readonly/);
    assert.equal((await runSqlite3(fs, ["/db", "SELECT * FROM t"])).stdout, "1\n");
  });
}

for (const ending of ["INSERT INTO t VALUES(1);", "", "COMMIT;"]) {
  test(`sqlite3 exit preserves only committed rows: ${ending || "unfinished transaction"}`, async () => {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/db", `
      CREATE TABLE t(x INT UNIQUE);
      INSERT INTO t VALUES(1);
      BEGIN;
      INSERT INTO t VALUES(2);
      ${ending}
    `]);
    const failed = ending.startsWith("INSERT");
    assert.equal(result.code, failed ? 19 : 0, result.stderr);
    if (failed) assert.match(result.stderr, /UNIQUE constraint failed: t.x/);
    const reopened = await runSqlite3(fs, ["/db", "SELECT x FROM t ORDER BY x;"]);
    assert.deepEqual(reopened, {
      code: 0, stdout: ending === "COMMIT;" ? "1\n2\n" : "1\n", stderr: ""
    });
  });
}

for (const [ending, expected] of [
  ["", "1\n"],
  ["ROLLBACK TO s; INSERT INTO t VALUES(3);", "1\n"],
  ["SAVEPOINT nested; INSERT INTO t VALUES(3); RELEASE nested;", "1\n"],
  ["RELEASE s;", "1\n2\n"],
  ["SAVEPOINT nested; RELEASE s;", "1\n2\n"],
  ["COMMIT;", "1\n2\n"],
  ["ROLLBACK; INSERT INTO t VALUES(3);", "1\n3\n"]
]) {
  test(`sqlite3 exit preserves committed savepoint rows: ${ending || "open savepoint"}`, async () => {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/db", `CREATE TABLE t(x INT);
      INSERT INTO t VALUES(1); SAVEPOINT s; INSERT INTO t VALUES(2); ${ending}`]);
    assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
    assert.deepEqual(await runSqlite3(fs, ["/db", "SELECT x FROM t ORDER BY x;"]),
      { code: 0, stdout: expected, stderr: "" });
  });
}

for (const begin of ["BEGIN", "SAVEPOINT s"]) {
  test(`sqlite3 sync exit rolls back unfinished ${begin} before persistence`, () => {
    const files = new Map<string, Uint8Array>();
    const read = (path: string) => files.get(path);
    const write = (path: string, bytes: Uint8Array) => { files.set(path, bytes); return true; };
    assert.equal(evalSyncSqlite3(undefined, ["/db",
      `CREATE TABLE t(x); INSERT INTO t VALUES(1); ${begin}; INSERT INTO t VALUES(2);`
    ], read, write), "");
    assert.equal(evalSyncSqlite3(undefined, ["/db", "SELECT x FROM t ORDER BY x;"], read, write), "1\n");
  });
}

test("sqlite3 sync persists comment and CTE mutations", () => {
  const files = new Map<string, Uint8Array>();
  const read = (path: string) => files.get(path);
  const write = (path: string, bytes: Uint8Array) => { files.set(path, bytes); return true; };
  assert.equal(evalSyncSqlite3(undefined, ["/db", "/* comment */ CREATE TABLE t(x)"], read, write), "");
  for (const sql of ["-- comment\nINSERT INTO t VALUES(1)", "WITH s AS (SELECT 2) INSERT INTO t SELECT * FROM s"]) {
    assert.equal(evalSyncSqlite3(undefined, ["/db", sql], read, write), "");
  }
  assert.equal(evalSyncSqlite3(undefined, ["/db", "SELECT * FROM t ORDER BY x"], read, write), "1\n2\n");
});

for (const strict of [false, true]) {
  for (const key of ["INT", "INTEGER PRIMARY KEY"]) {
    test(`sqlite3 imports affinity with STRICT ANY (${strict}) and ${key}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/aff.csv", new TextEncoder().encode("1,0006,6,6,6\n2,0039,39,39,39\n"));
      const result = await runSqlite3(fs, ["/aff.db"], [
        `CREATE TABLE aff(id ${key}, a ANY, i INT, r REAL, t TEXT) ${strict ? "STRICT" : ""};`,
        ".import --csv /aff.csv aff",
        "SELECT a,typeof(a),i,typeof(i),typeof(r),typeof(t) FROM aff ORDER BY i;",
        "SELECT MIN(i),MAX(i) FROM aff;"
      ].join("\n"));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, strict
        ? "0006|text|6|integer|real|text\n0039|text|39|integer|real|text\n6|39\n"
        : "6|integer|6|integer|real|text\n39|integer|39|integer|real|text\n6|39\n");
      const reopened = await runSqlite3(fs, ["/aff.db", "SELECT a,typeof(a) FROM aff ORDER BY i;"]);
      assert.equal(reopened.code, 0, reopened.stderr);
      assert.equal(reopened.stdout, strict ? "0006|text\n0039|text\n" : "6|integer\n39|integer\n");
    });
  }
}

test("sqlite3 conditional projection values reach command stdout", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "SELECT COALESCE(1, 2), COALESCE(NULL, 'fallback'), IFNULL(NULL, 9), IIF(10 > 5, 'yes', 'no');"]);
  assert.deepEqual(result, { code: 0, stdout: "1|fallback|9|yes\n", stderr: "" });
});

for (const end of ["COMMIT", "ROLLBACK"]) {
  test(`sqlite3 sync and async imports accept dot commands inside BEGIN TRANSACTION with ${end}`, async () => {
    const fs = createMemoryFileSystem();
    const csv = new TextEncoder().encode("1,first\n2,second\n");
    await fs.writeFile("/rows.csv", csv);
    const script = [
      "CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT);",
      "CREATE TABLE audit(id INTEGER);",
      "CREATE TRIGGER imported AFTER INSERT ON t BEGIN",
      "INSERT INTO audit VALUES(new.id);",
      "END;",
      "BEGIN TRANSACTION;",
      ".mode csv",
      ".import /rows.csv t",
      ".mode list",
      "SELECT count(*) FROM t;",
      `${end};`,
      "SELECT count(*) FROM t;",
      "SELECT count(*) FROM audit;"
    ].join("\n");
    const expected = end === "COMMIT" ? "2\n2\n2\n" : "2\n0\n0\n";
    const result = await runSqlite3(fs, [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => csv), expected);
  });
}

test("sqlite3 imports 25000 primary keys in sync and async transactions", async () => {
  const fs = createMemoryFileSystem();
  const csv = new TextEncoder().encode(Array.from({ length: 25000 }, (_, i) => `${i},value${i}\n`).join(""));
  await fs.writeFile("/rows.csv", csv);
  const script = [
    "CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT);",
    "BEGIN TRANSACTION;", ".mode csv", ".import /rows.csv t", "COMMIT;", ".mode list",
    "SELECT count(*), min(id), max(id) FROM t;",
    "INSERT OR IGNORE INTO t VALUES(24999, 'duplicate');",
    "SELECT value FROM t WHERE id = 24999;"
  ].join("\n");
  const expected = "25000|0|24999\nvalue24999\n";
  const result = await runSqlite3(fs, [":memory:"], script);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => csv), expected);
});

test("sqlite3 creates and queries an in-memory FTS5 table", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE VIRTUAL TABLE docs USING fts5(title, body); INSERT INTO docs VALUES ('hello', 'world'); SELECT * FROM docs; SELECT title FROM docs WHERE docs MATCH 'WORLD';"]);
  assert.deepEqual(result, { code: 0, stdout: "hello|world\nhello\n", stderr: "" });
});

test("sqlite3 records persistent foreign keys and enforces them only when enabled", async () => {
  const fs = createMemoryFileSystem();
  const setup = await runSqlite3(fs, ["/fk.db", "CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id) ON DELETE CASCADE); INSERT INTO child VALUES(1,99);"]);
  assert.equal(setup.code, 0, setup.stderr);
  const meta = await runSqlite3(fs, ["-json", "/fk.db", "PRAGMA foreign_key_list(child);"]);
  assert.deepEqual(JSON.parse(meta.stdout), [{ id: 0, seq: 0, table: "parent", from: "pid", to: "id", on_update: "NO ACTION", on_delete: "CASCADE", match: "NONE" }]);
  const invalid = await runSqlite3(fs, ["/fk.db", "PRAGMA foreign_keys=ON; INSERT INTO child VALUES(2,100);"]);
  assert.equal(invalid.code, 19);
  assert.match(invalid.stderr, /FOREIGN KEY constraint failed/);
});

test("sqlite3 cascades deletes and sets composite foreign keys to null", async () => {
  const res = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", `
    PRAGMA foreign_keys=ON;
    CREATE TABLE parent(a INTEGER, b TEXT, PRIMARY KEY(a,b));
    CREATE TABLE child(id INTEGER PRIMARY KEY, a INTEGER, b TEXT, CONSTRAINT fk FOREIGN KEY(a,b) REFERENCES parent(a,b) ON DELETE SET NULL);
    CREATE TABLE leaf(id INTEGER REFERENCES child(id) ON DELETE CASCADE);
    INSERT INTO parent VALUES(1,'x'); INSERT INTO child VALUES(7,1,'x'); INSERT INTO leaf VALUES(7);
    DELETE FROM parent; SELECT a,b FROM child; DELETE FROM child; SELECT count(*) AS n FROM leaf;
  `]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout.trim(), '[{"a":null,"b":null}]\n[{"n":0}]');
});

test("sqlite3 rejects orphaning parent writes and child updates atomically", async () => {
  const fs = createMemoryFileSystem();
  assert.equal((await runSqlite3(fs, ["/fk.db", "CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p); INSERT INTO p VALUES(1),(2); INSERT INTO c VALUES(1);"])).code, 0);
  for (const sql of ["DELETE FROM p", "UPDATE p SET id=3 WHERE id=1", "UPDATE c SET pid=9", "INSERT OR IGNORE INTO c VALUES(9)"]) {
    const res = await runSqlite3(fs, ["/fk.db", `PRAGMA foreign_keys=ON; ${sql};`]);
    assert.equal(res.code, 19, sql);
    assert.match(res.stderr, /FOREIGN KEY constraint failed/);
  }
  const rows = await runSqlite3(fs, ["/fk.db", "SELECT id FROM p ORDER BY id; SELECT pid FROM c;"]);
  assert.equal(rows.stdout, "1\n2\n1\n");
});

for (const [sql, diagnostic] of [
  ["CREATE TABLE t(x INTEGER UNIQUE); INSERT INTO t VALUES(1),(1);", "UNIQUE constraint failed: t.x"],
  ["CREATE TABLE t(x INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(1);", "UNIQUE constraint failed: t.x"],
  ["CREATE TABLE t(x NOT NULL); INSERT INTO t VALUES(NULL);", "NOT NULL constraint failed: t.x"],
  ["CREATE TABLE t(x CHECK(x > 0)); INSERT INTO t VALUES(0);", "CHECK constraint failed: x > 0"],
  ["PRAGMA foreign_keys=ON; CREATE TABLE p(id PRIMARY KEY); CREATE TABLE c(pid REFERENCES p); INSERT INTO c VALUES(1);", "FOREIGN KEY constraint failed"],
  ["CREATE TABLE t(a, b, UNIQUE(a,b)); INSERT INTO t VALUES(1,2),(1,2);", "UNIQUE constraint failed: t.a, t.b"],
  ["CREATE TABLE t(x UNIQUE); INSERT INTO t VALUES(1),(2); UPDATE t SET x=1 WHERE x=2;", "UNIQUE constraint failed: t.x"],
  ["CREATE TABLE t(x); INSERT INTO t VALUES(1),(1); CREATE UNIQUE INDEX i ON t(x);", "UNIQUE constraint failed: t.x"],
  ["CREATE TABLE t(x UNIQUE); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<40) INSERT INTO t SELECT x FROM n; INSERT INTO t VALUES(40);", "UNIQUE constraint failed: t.x"],
] as const) {
  test(`sqlite3 returns constraint status and diagnostic: ${sql}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.equal(result.code, 19, result.stderr);
    assert.equal(result.stderr, `Error: stepping, ${diagnostic} (19)\n`);
  });
}

test("sqlite3 keeps ordinary SQL errors at status 1", async () => {
  for (const sql of ["SELEC 1;", "SELECT * FROM missing;", "SELECT 'UNIQUE constraint failed: t.x';"]) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.equal(result.code, sql.includes("'UNIQUE") ? 0 : 1);
  }
});

test("sqlite3 NOCASE folds only ASCII in comparisons, constraints, indexes and sorting", async () => {
  const cases = [
    ["SELECT 'A' = 'a' COLLATE NOCASE, 'æ' = 'Æ' COLLATE NOCASE, 'é' = 'É' COLLATE NOCASE, 'Z' = 'z' COLLATE NOCASE;", "1|0|0|1\n"],
    ["CREATE TABLE t(x TEXT COLLATE NOCASE UNIQUE); INSERT INTO t VALUES('æ'),('Æ'); SELECT count(*) FROM t;", "2\n"],
    ["CREATE TABLE t(x TEXT); INSERT INTO t VALUES('æ'),('Æ'); CREATE UNIQUE INDEX idx ON t(x COLLATE NOCASE); INSERT INTO t VALUES('é'),('É'); SELECT count(*) FROM t;", "4\n"],
    ["CREATE TABLE t(x TEXT); CREATE UNIQUE INDEX idx ON t(x COLLATE NOCASE); INSERT INTO t VALUES('A'); INSERT OR IGNORE INTO t VALUES('a'); SELECT count(*) FROM t;", "1\n"],
    ["WITH t(x) AS (VALUES('a'),('B'),('A'),('b'),('æ'),('Æ')) SELECT x FROM t ORDER BY x COLLATE NOCASE;", "a\nA\nB\nb\nÆ\næ\n"],
    ["SELECT 'A' LIKE 'a', 'æ' LIKE 'Æ', 'A' GLOB 'a', 'æ' GLOB 'Æ', 'A' = 'a' COLLATE BINARY;", "1|0|0|0|0\n"],
  ];
  for (const [sql, stdout] of cases) {
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql!]),
      { code: 0, stdout, stderr: "" }, sql);
  }
});

for (const [sql, stdout] of [
  ["SELECT json('{a:1}'), json_extract('{a:1}', '$.a'), json_set('{a:1}', '$.b', 2);", '{"a":1}|1|{"a":1,"b":2}\n'],
  ["SELECT json_valid('{a:1}'), json_valid('{a:1}', 2), json_valid('{a:1}', 3), json_valid('{a:1}', 4), json_valid('{a:1}', 6), json_valid('{}', 8);", "0|1|1|0|1|0\n"],
  ["SELECT json('{/* comment */a:0x10,b:+2,c:.5,d:2.,e:[1,2,],}');", '{"a":16,"b":2,"c":0.5,"d":2.0,"e":[1,2]}\n'],
  ["SELECT json('{a:''hello'',b:''line\\\ncontinued''}');", '{"a":"hello","b":"linecontinued"}\n'],
  ["SELECT json('{a:Infinity,b:-Inf,c:NaN,d:QNaN,e:sNaN,é:1}');", '{"a":9e999,"b":-9e999,"c":null,"d":null,"e":null,"é":1}\n'],
  ["SELECT json('{a:1,a:2}');", '{"a":1,"a":2}\n'],
  ["SELECT json_type('{a:1}', '$.a'), json_array_length('{a:[1,2,]}', '$.a'), '{a:1}' -> 'a', '{a:1}' ->> 'a';", "integer|2|1|1\n"],
  ["SELECT json_insert('{a:1}', '$.b', 2), json_replace('{a:1}', '$.a', 2), json_remove('{a:1,b:2}', '$.a'), json_patch('{a:1}', '{b:2}');", '{"a":1,"b":2}|{"a":2}|{"b":2}|{"a":1,"b":2}\n'],
  ["SELECT key,value FROM json_each('{a:1,b:2}'); SELECT atom FROM json_tree('{a:[3,]}') WHERE atom IS NOT NULL;", "a|1\nb|2\n3\n"],
  ["SELECT json_valid('{a:}'), json_valid('{a:}', 2), json_valid(NULL, 2);", "0|0|\n"],
]) {
  test(`sqlite3 JSON5 input: ${sql}`, async () => {
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", sql!]),
      { code: 0, stdout, stderr: "" });
  });
}

for (const flags of [0, 16, -1]) {
  test(`sqlite3 rejects invalid json_valid flags ${flags}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT json_valid('{}', ${flags});`]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("FLAGS parameter to json_valid() must be between 1 and 15"));
  });
}

for (const [doc, path, stdout] of [
  ['[10,20,30]', '$[1]', '1|20|integer|$[1]|$\n'],
  ['{"a":{"b":1}}', '$.a', 'a|{"b":1}|object|$.a|$\nb|1|integer|$.a.b|$.a\n'],
  ['{"a":[10,20]}', '$.a[1]', '1|20|integer|$.a[1]|$.a\n'],
  ['{"a.b":{"c.d":null}}', '$."a.b"."c.d"', 'c.d||null|$."a.b"."c.d"|$."a.b"\n'],
  ['20', '$', '|20|integer|$|$\n'],
  ['{"a":1}', '$.missing', ''],
]) {
  test(`sqlite3 json_tree preserves subtree root location at ${path}`, async () => {
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:",
      `SELECT key, value, type, fullkey, path FROM json_tree('${doc}', '${path}');`]),
    { code: 0, stdout, stderr: "" });
  });
}

for (const [input, output] of [
  [String.raw`{\u0061:'\u0062',v:'\v',x:'\x41'}`, String.raw`{"\u0061":"\u0062","v":"\u0009","x":"\u0041"}`],
  [String.raw`{"a":"\u0061","b":"\/","c":1e+02}`, String.raw`{"a":"\u0061","b":"\/","c":1e+02}`],
  ["// comment\n{ a: [1,], }", '{"a":[1]}'],
]) {
  test(`sqlite3 JSON5 canonical spelling: ${input}`, async () => {
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT json('${input!.replaceAll("'", "''")}');`]),
      { code: 0, stdout: output + "\n", stderr: "" });
  });
}

for (const input of [String.raw`"\q"`, "[1,,2]", "{a:01}", "{a:}", "/* unterminated", "[1", "true false"]) {
  test(`sqlite3 rejects malformed JSON5: ${input}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", `SELECT json('${input}');`]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("malformed JSON"));
  });
}

test("sqlite3 preserves JSON5 infinities when modifying or extracting JSON", async () => {
  assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:",
    "SELECT json_set('{a:Inf}', '$.b', 1), json_extract('{a:Inf,b:-Inf}', '$.a', '$.b'), json_patch('{a:Inf}', '{b:NaN}');"]),
    { code: 0, stdout: '{"a":9e999,"b":1}|[9e999,-9e999]|{"a":9e999}\n', stderr: "" });
});
