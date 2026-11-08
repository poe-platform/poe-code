import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MemoryFileSystem, createStandardCommands } from 'virtual-bash';

const rows = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
assert.deepEqual(rows.map(row => row.id), ['borrowed-offset-finalizer-newline', 'borrowed-offset-finalizer-nul']);
const results = [];
const digest = value => ({ bytes: Buffer.from(value).length, sha256: createHash('sha256').update(Buffer.from(value)).digest('hex') });
const b64 = value => Buffer.from(value).toString('base64');
const command = createStandardCommands().find(command => command.name === 'sort');
assert.ok(command);
for (const row of rows) test(row.id, async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const input = Buffer.from(row.input, 'base64');
  let finalized = false;
  const stdin = (async function* () {
    const allocation = Buffer.alloc(row.borrowedWidth + 18, 88);
    try {
      for (let offset = 0; offset < input.length; offset += row.borrowedWidth) {
        allocation.fill(89);
        const count = Math.min(row.borrowedWidth, input.length - offset);
        allocation.set(input.subarray(offset, offset + count), 9);
        yield allocation.subarray(9, 9 + count);
      }
    } finally { allocation.fill(81); finalized = true; }
  })();
  const stdout = [], stderr = [];
  if (globalThis.__sortAuditReset) globalThis.__sortAuditReset();
  const result = await command.execute({ command: 'sort', args: row.script.split(' ').slice(1), cwd: '/', env: {}, fs, signal: controller.signal, stdin,
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } });
  const files = {};
  for (const entry of await fs.readdir('/')) files[entry.name] = b64(await fs.readFile('/' + entry.name));
  const actual = { status: result.exitCode, stdout: b64(Buffer.concat(stdout)), stderr: b64(Buffer.concat(stderr)), files };
  results.push({ id: row.id, actual, input: digest(input), stdout: digest(Buffer.concat(stdout)), finalized, counters: globalThis.__sortAudit ? structuredClone(globalThis.__sortAudit) : null });
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(actual, row.expected);
  assert.equal(finalized, true);
});
