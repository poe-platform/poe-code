import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const relative = 'tests/shell/dotglob-precode-20260828';
const readyPath = '/tmp/dotglob-precode-20260828-ready.txt';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const exclusiveJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const gitRead = args => execFileSync(git, args, { cwd: repository, timeout: 3000, maxBuffer: 1024 * 1024 });
const [mode, commit, ...extra] = process.argv.slice(2);
if (!['--prepare', '--run'].includes(mode) || !/^[a-f0-9]{40}$/.test(commit ?? '') || extra.length) throw new Error('Expected --prepare|--run FULL_PROTOCOL_COMMIT');
const manifestBytes = readFileSync(join(directory, 'MANIFEST-v1.json'));
if (!manifestBytes.equals(gitRead(['show', `${commit}:${relative}/MANIFEST-v1.json`]))) throw new Error('Manifest differs from precommit');
const manifest = JSON.parse(manifestBytes);
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = readFileSync(join(directory, name));
  if (digest(bytes) !== expected || !bytes.equals(gitRead(['show', `${commit}:${relative}/${name}`]))) throw new Error(`Seal mismatch: ${name}`);
}
const bindings = readJson(join(directory, 'BINDINGS-v1.json'));
for (const tool of bindings.tools) if (digest(readFileSync(tool.path)) !== tool.sha256) throw new Error(`Qualified provenance mismatch: ${tool.path}`);
const rows = readJson(join(directory, 'ROWS-v1.json')).rows;
const scriptFor = row => [row.setup ?? '', ...row.probes.map((probe, index) => `printf '\\036begin:${index}\\n' >&2\n${probe}\nprintf '\\036status:${index}=%s\\n' "$?"\nshopt -p dotglob\nprintf '\\036end:${index}\\n'\nprintf '\\036end:${index}\\n' >&2`)].join('\n');
if (rows.length !== 24 || rows.length > 32) throw new Error('Call budget');
if (rows.reduce((total, row) => total + Buffer.byteLength(scriptFor(row)), 0) > 16384) throw new Error('Input budget');
if (1 + rows.length + rows.reduce((total, row) => total + (row.fixtures?.length ?? 0), 0) > 32) throw new Error('Fixture entry budget');
if (rows.flatMap(row => row.fixtures ?? []).reduce((total, item) => total + Buffer.byteLength(item.text ?? ''), 0) > 65536) throw new Error('Fixture byte budget');
const census = root => {
  const records = [];
  const visit = (path, name) => {
    const stat = lstatSync(path);
    const record = { path: name, type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', mode: stat.mode & 0o777, bytes: stat.isFile() ? stat.size : null };
    if (stat.isFile()) record.sha256 = digest(readFileSync(path));
    records.push(record);
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child), name === '.' ? child : `${name}/${child}`);
  };
  visit(root, '.');
  return records;
};
const groupExists = pid => {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const killOwned = pid => {
  try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
if (mode === '--prepare') {
  const output = mkdtempSync('/tmp/dotglob-precode-20260828-output-');
  const fixtureRoot = mkdtempSync('/tmp/dotglob-precode-20260828-fixtures-');
  const receipt = { schema: 'dotglob-readiness-v1', created: new Date().toISOString(), protocolCommit: commit, manifestSha256: digest(manifestBytes), toolHash: bindings.tools[0].sha256, rowsCount: rows.length, nativeCallsSoFar: 0, output, fixtureRoot };
  exclusiveJson(join(output, 'PRE.json'), { ...receipt, node: process.version, platform: process.platform, architecture: process.arch, gitStatus: gitRead(['status', '--short']).toString(), tools: bindings.tools });
  exclusiveJson(readyPath, receipt);
  console.log(JSON.stringify(receipt));
} else {
  const receipt = readJson(readyPath);
  if (receipt.protocolCommit !== commit || receipt.manifestSha256 !== digest(manifestBytes) || receipt.toolHash !== bindings.tools[0].sha256 || receipt.rowsCount !== rows.length || receipt.nativeCallsSoFar !== 0) throw new Error('Readiness mismatch');
  if (!receipt.output.startsWith('/tmp/dotglob-precode-20260828-output-') || !receipt.fixtureRoot.startsWith('/tmp/dotglob-precode-20260828-fixtures-')) throw new Error('Unowned receipt paths');
  exclusiveJson(join(receipt.output, 'RUN-ONCE.json'), { commit, start: new Date().toISOString() });
  const observations = [];
  for (const row of rows) {
    const rowdir = join(receipt.fixtureRoot, row.id);
    mkdirSync(rowdir, { mode: 0o700 });
    for (const item of row.fixtures ?? []) {
      if (item.path.startsWith('/') || item.path.split('/').some(part => part === '..' || part === '')) throw new Error('Unowned fixture');
      if (item.directory) mkdirSync(join(rowdir, item.path), { mode: 0o700 });
      else writeFileSync(join(rowdir, item.path), item.text, { flag: 'wx', mode: 0o600 });
    }
    const source = scriptFor(row);
    const before = census(rowdir);
    const start = new Date().toISOString();
    exclusiveJson(join(receipt.output, `${row.id}-PRE.json`), { row: row.id, source, sourceSha256: digest(source), before, start });
    const result = await new Promise((resolveResult, rejectResult) => {
      const child = spawn(bindings.tools[0].path, ['--noprofile', '--norc', '-c', source, 'dotglob-reference'], { cwd: rowdir, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1', TERM: 'dumb', HOME: rowdir, TMPDIR: rowdir, PATH: '/usr/bin:/bin' } });
      let captured = 0;
      let fault = null;
      const stdout = [];
      const stderr = [];
      const timer = setTimeout(() => { fault ??= 'deadline'; if (child.pid) killOwned(child.pid); }, 3000);
      const capture = (chunks, chunk) => {
        const keep = Math.max(0, 65536 - captured);
        if (keep) chunks.push(Buffer.from(chunk.subarray(0, keep)));
        captured += chunk.length;
        if (captured > 65536) { fault ??= 'capture-limit'; if (child.pid) killOwned(child.pid); }
      };
      child.stdout.on('data', chunk => capture(stdout, chunk));
      child.stderr.on('data', chunk => capture(stderr, chunk));
      child.on('error', error => { fault ??= `spawn:${error.code}`; });
      child.on('close', async (status, signal) => {
        clearTimeout(timer);
        try {
          if (child.pid && groupExists(child.pid)) {
            fault ??= 'group-survived-close';
            killOwned(child.pid);
            for (let attempt = 0; attempt < 25 && groupExists(child.pid); attempt++) await delay(20);
          }
          const groupAbsent = !child.pid || !groupExists(child.pid);
          resolveResult({ status, signal, fault, pid: child.pid ?? null, groupAbsent, capturedBytes: captured, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') });
        } catch (error) { rejectResult(error); }
      });
    });
    const observation = { id: row.id, start, end: new Date().toISOString(), sourceSha256: digest(source), before, after: census(rowdir), ...result };
    exclusiveJson(join(receipt.output, `${row.id}-RESULT.json`), observation);
    observations.push(observation);
    if (result.fault || !result.groupAbsent) throw new Error(`Stopped after ${row.id}: ${result.fault}; retained receipts`);
  }
  for (const tool of bindings.tools) if (digest(readFileSync(tool.path)) !== tool.sha256) throw new Error(`Postrun provenance mismatch: ${tool.path}`);
  exclusiveJson(join(receipt.output, 'RESULTS.json'), { protocolCommit: commit, nativeCalls: observations.length, rows: observations, fixtureCensus: census(receipt.fixtureRoot), completed: new Date().toISOString(), groupAbsenceConfirmed: true });
  console.log(JSON.stringify({ output: receipt.output, nativeCalls: observations.length }));
}
