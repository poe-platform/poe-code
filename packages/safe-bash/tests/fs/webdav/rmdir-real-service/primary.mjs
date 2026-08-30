import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const label = process.argv[2] ?? 'primary';
assert.match(label, /^[a-z0-9-]+$/);
const folder = new URL(`./evidence/${label}/`, import.meta.url);
await mkdir(folder);
const sources = [
  ['rfc4918', 'https://www.rfc-editor.org/rfc/rfc4918.txt', [/^6\.6\. /, /^7\.4\. /, /^9\.6\.1\. /, /^10\.4\.4\. /, /^10\.2\. /]],
  ['rfc2518', 'https://www.rfc-editor.org/rfc/rfc2518.txt', [/^7\.1 Methods Restricted/, /^7\.5 Write Locks/, /^8\.6\.2 DELETE/]],
  ['apache-2.4.66-repos', 'https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/fs/repos.c', [/^static dav_error \* dav_fs_delete_walker/, /^static dav_error \* dav_fs_remove_resource/]],
];
const records = [];
for (const [name, url, patterns] of sources) {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer()), lines = bytes.toString().split('\n');
  const excerpts = patterns.map(pattern => {
    const index = lines.findIndex(line => pattern.test(line));
    return { pattern: String(pattern), found: index >= 0, ...(index >= 0 ? { line: index + 1, text: lines.slice(index, index + 65).join('\n') } : {}) };
  });
  records.push({ name, url, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString(), bytes: bytes.length, excerpts });
}
const memo = await readFile('/tmp/safe-bash-rmdir-contract-review.md');
const text = memo.toString();
await writeFile(new URL('review-dav.txt', folder), text.slice(text.indexOf('## DAV primary protocol basis')), { flag: 'wx' });
await writeFile(new URL('sources.json', folder), JSON.stringify({ records, reviewSha256: createHash('sha256').update(memo).digest('hex') }, null, 2), { flag: 'wx' });
console.log(records.map(record => ({ name: record.name, sha256: record.sha256, matches: record.excerpts.map(excerpt => excerpt.found) })));
