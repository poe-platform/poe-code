import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MemoryFileSystem, Shell, ShellLimitError, standardCommands } from 'virtual-bash';

const rows = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
const results = [];
const digest = value => ({ bytes: Buffer.from(value).length, sha256: createHash('sha256').update(Buffer.from(value)).digest('hex') });
const b64 = value => Buffer.from(value).toString('base64');
for (const row of rows) test(row.id, async () => {
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of Object.entries(row.files ?? {})) await fs.writeFile('/' + path, Buffer.from(bytes, 'base64'));
  const shell = new Shell({ fs }).use(standardCommands());
  const controller = new AbortController();
  const reason = new Error('independent-keyed-abort');
  const input = Buffer.from(row.input, 'base64');
  let finalized = false;
  const stdin = row.borrowedWidth ? (async function* () {
    const allocation = Buffer.alloc(row.borrowedWidth + 18, 88);
    try {
      for (let offset = 0; offset < input.length; offset += row.borrowedWidth) {
        allocation.fill(89);
        const count = Math.min(row.borrowedWidth, input.length - offset);
        allocation.set(input.subarray(offset, offset + count), 9);
        yield allocation.subarray(9, 9 + count);
      }
    } finally { allocation.fill(81); finalized = true; }
  })() : row.cancel ? (async function* () { try { yield input; controller.abort(reason); yield Buffer.from('b:1\n'); } finally { finalized = true; } })() : input;
  let result, error;
  const stdout = [], stderr = [];
  if (globalThis.__sortAuditReset) globalThis.__sortAuditReset();
  try { result = await shell.exec(row.script, { stdin, signal: controller.signal, ...(row.limits ? { limits: row.limits } : {}), stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } }); }
  catch (caught) { error = caught; }
  finally { await shell.dispose(); }
  const files = {};
  for (const entry of await fs.readdir('/')) files[entry.name] = b64(await fs.readFile('/' + entry.name));
  const actual = { ...(result ? { status: result.exitCode } : {}), stdout: b64(Buffer.concat(stdout)), stderr: b64(Buffer.concat(stderr)), files, ...(error ? { rejection: error === reason ? 'same-abort-reason' : error.limit ?? error.message } : {}) };
  const summary = { id: row.id, actual: input.length > 4096 ? { ...actual, stdout: digest(Buffer.concat(stdout)) } : actual, input: digest(input), stdout: digest(Buffer.concat(stdout)), finalized, counters: globalThis.__sortAudit ? structuredClone(globalThis.__sortAudit) : null };
  results.push(summary);
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  for (const [key, value] of Object.entries(row.expected)) {
    if (key === 'stdout') assert.deepEqual(digest(Buffer.from(actual.stdout, 'base64')), digest(Buffer.from(value, 'base64')), row.id + ': stdout');
    else assert.deepEqual(actual[key], value, row.id + ': ' + key);
  }
  if (!row.expected.rejection) assert.equal(error, undefined);
  if (row.expected.rejection === 'maxOutputBytes') assert.ok(error instanceof ShellLimitError);
  if (row.cancel || row.borrowedWidth) assert.equal(finalized, true);
});
