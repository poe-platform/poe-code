import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const [name, sql, expected] of [
  ["numeric result types", `SELECT typeof('{"a":1}' -> 'a'), typeof('{"a":1}' ->> 'a'), typeof('[1.5]' -> 0);`, "text|integer|text\n"],
  ["JSON scalar values", `SELECT '[1,1.5,true,false,null,"hello"]' -> 0,
    '[1,1.5,true,false,null,"hello"]' -> 1, '[true]' -> 0, '[false]' -> 0,
    '[null]' -> 0, '["hello"]' -> 0;`, '1|1.5|true|false|null|"hello"\n'],
  ["JSON scalar types", `SELECT typeof('[true]' -> 0), typeof('[false]' -> 0),
    typeof('[null]' -> 0), typeof('["hello"]' -> 0);`, "text|text|text|text\n"],
  ["SQL scalar extraction", `SELECT '[true]' ->> 0, '[false]' ->> 0, '["hello"]' ->> 0,
    typeof('[null]' ->> 0), typeof('[1.5]' ->> 0),
    json_extract('[true]', '$[0]'), typeof(json_extract('[null]', '$[0]')),
    typeof(json_extract('[1]', '$[0]'));`, "1|0|hello|null|real|1|null|integer\n"],
  ["missing values and SQL null", `SELECT typeof('{}' -> 'missing'), typeof('[]' -> 0),
    typeof(NULL -> 'a'), typeof('[1]' -> NULL);`, "null|null|null|null\n"],
  ["containers and JSON subtype", `SELECT '{"a":[1,true,null]}' -> 'a',
    '[{"a":1}]' -> 0, json_array('[true]' -> 0, '[false]' -> 0, '[null]' -> 0,
    '[1]' -> 0, '["hello"]' -> 0);`, '[1,true,null]|{"a":1}|[true,false,null,1,"hello"]\n']
]) {
  test(`sqlite3 JSON arrow preserves ${name}`, async () => {
    const args = [":memory:", sql!];
    let stdout = "", stderr = "";
    const result = await createSqlite3Command().execute({
      command: "sqlite3", ...createCommandArguments(args),
      fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, args), expected);
  });
}
