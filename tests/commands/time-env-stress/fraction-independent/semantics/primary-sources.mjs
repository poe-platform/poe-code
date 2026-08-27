import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const scratch = mkdtempSync('/tmp/fraction-semantics-primary-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requests = [
  ['release-archive', 'https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz'],
  ['release-date', 'https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/date.c'],
  ['release-manual', 'https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi'],
  ['online-manual-supplemental', 'https://www.gnu.org/software/coreutils/manual/html_node/Padding-and-other-flags.html'],
  ['online-manual-version', 'https://www.gnu.org/software/coreutils/manual/html_node/index.html'],
  ['posix-2018', 'https://pubs.opengroup.org/onlinepubs/9699919799.2018edition/functions/strftime.html'],
  ['posix-2024', 'https://pubs.opengroup.org/onlinepubs/9799919799/functions/strftime.html'],
];
const results = [];
try {
  for (const [id, url] of requests) {
    const path = join(scratch, id);
    const args = ['--silent', '--show-error', '--location', '--fail', '--connect-timeout', '5', '--max-time', '25', '--output', path, '--write-out', '%{http_code}\n%{url_effective}\n', url];
    const result = spawnSync('/usr/bin/curl', args, { cwd: scratch, env: { LC_ALL: 'C' }, timeout: 30000, maxBuffer: 1024 * 1024 });
    let bytes;
    try { bytes = readFileSync(path); } catch {}
    const record = { id, url, fetchedAt: new Date().toISOString(), args, status: result.status, signal: result.signal,
      stdoutHex: result.stdout?.toString('hex') ?? '', stderrHex: result.stderr?.toString('hex') ?? '',
      bytes: bytes?.length ?? 0, sha256: bytes ? hash(bytes) : null };
    if (bytes && id !== 'release-archive') {
      const text = bytes.toString();
      const pattern = id.startsWith('posix') ? /%g|%G|ISO 8601|January|Thursday/g : /%-N|adjust_resolution|res_width|[Vv]ersion 9\.\d+|coreutils 9\.\d+/g;
      const matches = [...text.matchAll(pattern)].slice(0, 20);
      record.excerpts = matches.map(match => text.slice(Math.max(0, match.index - 150), match.index + 450));
    }
    results.push(record);
    console.log(JSON.stringify({ id, status: record.status, sha256: record.sha256, bytes: record.bytes, excerpts: record.excerpts }));
  }
  writeFileSync(join(here, 'primary-fetch.json'), JSON.stringify({
    note: 'web.run official-source searches/opens were attempted first but supplied no readable body to this thread. Bounded direct HTTPS retrieval supplies independently readable primary sources. Failed fetches retained.',
    results,
  }, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(scratch, { recursive: true, force: true }); }
