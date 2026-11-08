import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { structuredCommands } from "../../../src/commands/structured/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

test('real virtual pipelines preserve generator ordering and slurp statuses', { timeout: 3000 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { pipeHighWaterMark: 2 } }).use(standardCommands()).use(structuredCommands());
  const result = await shell.exec("printf '%s\\n' '[[10,11],[20,21]]' | jq -c '.[(0,1)][(0,1)]' | jq -sce '.'", { signal: AbortSignal.timeout(2000) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '[10,20,11,21]\n');
  assert.equal(result.stderr, '');
  const status = await shell.exec("printf '%s\\n' '{}' | jq -ce '. |= empty'", { signal: AbortSignal.timeout(2000) });
  assert.equal(status.exitCode, 1, status.stderr);
  assert.equal(status.stdout, 'null\n');
});

test('relative program files and output redirection remain memory-only', { timeout: 3000 }, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.writeFile('/work/filter.jq', Buffer.from('.jobs|map(select(.ok)|.name)'));
  await fs.writeFile('/work/input.json', Buffer.from('{"jobs":[{"name":"build","ok":true},{"name":"deploy","ok":false}]}'));
  const shell = new Shell({ fs, cwd: '/work' }).use(standardCommands()).use(structuredCommands());
  const result = await shell.exec("jq -c -f filter.jq input.json | jq -r '.[]' > selected.txt; cat selected.txt", { signal: AbortSignal.timeout(2000) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'build\n');
  assert.equal(Buffer.from(await fs.readFile('/work/selected.txt')).toString(), 'build\n');
});

test('downstream early closure bounds indexed generator work', { timeout: 3000 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(structuredCommands());
  const result = await shell.exec("jq -nc '[42][range(1000000000)]' | head -n 1", { signal: AbortSignal.timeout(2000) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '42\n');
});
