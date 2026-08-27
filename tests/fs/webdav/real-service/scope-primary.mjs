import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('./evidence/scope-primary/', import.meta.url);
await mkdir(output);
const sources = [
  ['rfc4918', 'https://www.rfc-editor.org/rfc/rfc4918.txt', [/^14\.1\. /, /^14\.13\. /, /^14\.15\. /, /^17\. /]],
  ['rfc2518', 'https://www.rfc-editor.org/rfc/rfc2518.txt', [/^12\.1 activelock/, /^12\.7 lockscope/, /^12\.8 locktype/]],
];
const records = [];
for (const [name, url, patterns] of sources) {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const lines = bytes.toString().split('\n');
  const excerpts = patterns.map(pattern => {
    const start = lines.findIndex(line => pattern.test(line));
    assert.ok(start >= 0, `${name} ${pattern}`);
    return { line: start + 1, text: lines.slice(start, start + 45).join('\n') };
  });
  records.push({ name, url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, excerpts });
}
await writeFile(new URL('sources.json', output), JSON.stringify(records, null, 2), { flag: 'wx' });
console.log(JSON.stringify(records, null, 2));
