import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'));
const sources = [
  ['rfc4918', 'https://www.rfc-editor.org/rfc/rfc4918.txt', [/^9\.10\.1\./, /^10\.5\./, /^14\.12\./, /^14\.13\./, /^14\.15\./, /^15\.6\./, /^17\.  /]],
  ['rfc2518', 'https://www.rfc-editor.org/rfc/rfc2518.txt', [/^8\.10\.1 /, /^9\.5 /, /^12\.1 activelock/, /^12\.7 lockscope/, /^12\.8 locktype/]],
  ['apache-2.4.66-lock', 'https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/main/util_lock.c', [/DAV_DECLARE\(const char \*\) dav_lock_get_activelock/]],
  ['wsgidav-4.3.5-request', 'https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/request_server.py', [/self\._evaluate_if_headers\(dest_res/, /\("Lock-Token", lock\["token"\]\)/]],
  ['wsgidav-4.3.5-property', 'https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/dav_provider.py', [/elif name == "\{DAV:\}getetag"/]],
];
const records = [];
for (const [name, url, patterns] of sources) {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  assert.equal(response.ok, true, url);
  const bytes = Buffer.from(await response.arrayBuffer());
  const lines = bytes.toString().split('\n');
  const matches = [];
  for (const pattern of patterns) {
    const index = lines.findIndex(line => pattern.test(line));
    assert.ok(index >= 0, `${name} ${pattern}`);
    matches.push({ line: index + 1, pattern: String(pattern), text: lines.slice(index, index + (name.startsWith('apache') ? 100 : 30)).join('\n') });
  }
  records.push({ name, url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, matches });
}
await writeFile(output, JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
console.log(records.map(record => ({ name: record.name, sha256: record.sha256, lines: record.matches.map(match => match.line) })));
