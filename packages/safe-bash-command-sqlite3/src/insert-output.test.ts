import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {createCommandArguments} from 'safe-bash-contracts';
import {createSqlite3Command, evalSyncSqlite3} from './index.js';

for (const [argument, identifier] of [
  ['', '"table"'],
  ['"sales totals"', '"sales totals"'],
  ["'sales\"totals'", '"sales""totals"'],
  ['SeLeCt', '"SeLeCt"'],
  ['returning', '"returning"'],
  ['123sales', '"123sales"'],
  ['sales_totals', 'sales_totals'],
  ['"sales; DROP TABLE t;--"', '"sales; DROP TABLE t;--"']
]) {
  test(`insert mode quotes table ${argument || '(default)'} and produces replayable SQL`, async () => {
    const input = `.mode insert ${argument}\nSELECT 10 AS b,20 AS a;`;
    const expected = `INSERT INTO ${identifier} VALUES(10,20);\n`;
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(input), [':memory:']), expected);
    let stdout = '', stderr = '';
    const result = await createSqlite3Command().execute({
      command: 'sqlite3', ...createCommandArguments([':memory:']),
      fs: createMemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
      stdin: {async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); }},
      stdout: {async write(bytes) { stdout += new TextDecoder().decode(bytes); }},
      stderr: {async write(bytes) { stderr += new TextDecoder().decode(bytes); }}
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, expected);
    assert.equal(evalSyncSqlite3(new Uint8Array(), [':memory:',
      `CREATE TABLE ${identifier}(b,a); ${stdout} SELECT b,a FROM ${identifier};`]), '10|20\n');
  });
}
