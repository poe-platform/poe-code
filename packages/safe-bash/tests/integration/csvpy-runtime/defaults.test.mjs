import {test as it} from "node:test";
import assert from "node:assert/strict";
import {Shell} from "../../../src/shell/index.js";
import {MemoryFileSystem} from "../../../src/fs/memory/index.js";
import {csvkitCommands} from "../../../src/commands/csvkit/index.js";

it("provides a real persistent Python console and Agate table by default", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/résumé.csv", new TextEncoder().encode("id,name,score,city\n1,alice,95,nyc\n2,bob,82,sf\n"));
  const shell = new Shell({fs}).use(csvkitCommands());
  try {
    const result = await shell.exec("csvpy --agate /résumé.csv", {stdin: 'import agate\nprint(isinstance(table, agate.Table))\nprint(table.aggregate(agate.Mean("score")))\nprint(table.where(lambda row: row["score"] > 90).rows[0]["name"])\n'});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /True/);
    assert.match(result.stdout, /88\.5/);
    assert.match(result.stdout, /alice/);
    assert.match(result.stderr, /agate.Table/);
    assert.match(result.stderr, /résumé.csv/);
    assert.doesNotMatch(result.stderr, /Traceback/);
  } finally {await shell.dispose();}
});
for (const [option, expression, expected] of [
  ['', 'print(next(reader)); print(next(reader)); print(reader.dialect.delimiter, reader.dialect.quotechar, reader.dialect.quoting)', "['name', 'score']"],
  ['--dict', 'print(next(reader))', "{'name': 'alice', 'score': '95'}"]
]) it(`provides the default csvpy ${option || 'reader'} console`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/data.csv', new TextEncoder().encode('name,score\nalice,95\n'));
  const shell = new Shell({fs}).use(csvkitCommands());
  try {
    const result = await shell.exec(`csvpy ${option} /data.csv`, {stdin: expression + '\n'});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(expected), result.stdout);
    if (!option) assert.ok(result.stdout.includes(', " 0'), result.stdout);
    assert.doesNotMatch(result.stderr, /Traceback/);
  } finally {await shell.dispose();}
});

it('enforces the default interpreter work budget', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/data.csv', new TextEncoder().encode('name\nalice\n'));
  const shell = new Shell({fs}).use(csvkitCommands({limits: {maxInterpreterWork: 1}}));
  try {
    const result = await shell.exec('csvpy --agate /data.csv');
    assert.equal(result.exitCode, 78);
    assert.match(result.stderr, /interpreter work budget exceeded/);
    assert.equal(result.stdout, '');
  } finally {await shell.dispose();}
});

it('cancels a running Python loop and retires its worker', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/data.csv', new TextEncoder().encode('name\nalice\n'));
  const shell = new Shell({fs}).use(csvkitCommands());
  const controller = new AbortController();
  const reason = new Error('cancel running Python');
  let timer; let ready = false;
  try {
    const running = shell.exec('csvpy --agate /data.csv', {
      signal: controller.signal,
      stdin: 'print("LOOP_READY")\nwhile True: pass\n\n',
      stdout: {async write(bytes) {
        if (new TextDecoder().decode(bytes).includes('LOOP_READY')) {
          ready = true; timer = setTimeout(() => controller.abort(reason), 50);
        }
      }}
    });
    await assert.rejects(running, error => error === reason);
    assert.equal(ready, true);
  } finally {clearTimeout(timer); controller.abort(reason); await shell.dispose();}
});
