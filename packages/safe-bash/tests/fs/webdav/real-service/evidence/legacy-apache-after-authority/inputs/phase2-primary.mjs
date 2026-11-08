import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const output = join(own, 'evidence', 'legacy-primary');
await mkdir(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  ['rfc2518', 'https://www.rfc-editor.org/rfc/rfc2518.txt', /^8\.10\.1 |^8\.10\.3 |^9\.5 |^12\.1 activelock|^13\.6 /, 24],
  ['rfc4918', 'https://www.rfc-editor.org/rfc/rfc4918.txt', /^9\.10\.1\.|^10\.5\.|^14\.1\.|^14\.12\.|^15\.6\./, 30],
  ['apache-lock', 'https://raw.githubusercontent.com/apache/httpd/2.4.66/modules/dav/main/util_lock.c', /^DAV_DECLARE\(const char \*\) dav_lock_get_activelock/, 130],
  ['wsgidav-request', 'https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/request_server.py', /self\._evaluate_if_headers\(dest_res|\("Lock-Token", lock\["token"\]\)/, 12],
  ['wsgidav-provider', 'https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/dav_provider.py', /elif name == "\{DAV:\}getetag"/, 10],
];
const evidence = [];
for (const [name, url, pattern, count] of sources) {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const lines = bytes.toString().split('\n');
  const excerpts = lines.flatMap((line, index) => pattern.test(line) ? [{ line: index + 1, text: lines.slice(index, index + count).join('\n') }] : []);
  if (!excerpts.length) throw new Error(`primary anchor absent: ${name}`);
  evidence.push({ name, url, fullSourceSha256: hash(bytes), bytes: bytes.length, excerpts });
}
const git = args => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const paths = ['src/fs/webdav/webdav.ts', 'src/fs/webdav/index.ts', 'src/fs/webdav/README.md', 'src/index.ts', 'package.json'];
const sourceHashes = {};
for (const path of paths) sourceHashes[path] = hash(await readFile(join(repo, path)));
await writeFile(join(output, 'sources.json'), JSON.stringify({ capturedAt: new Date().toISOString(), initialRequestedCommit: '76d1dd721f8b6efc9417b847e14d674cf9cbae0f', observedHead: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1']), index: git(['diff', '--cached', '--name-only']), sourceHashes, package: JSON.parse(await readFile(join(repo, 'package.json'))), evidence }, null, 2), { flag: 'wx' });
