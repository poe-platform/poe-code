import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const baseline = '1ea140b50f0b4edcfa28a60e2f89351b97e509a5';
const label = process.argv[2] ?? 'wsgidav-raw-initial';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('invalid cohort label');
const evidence = join(own, 'evidence', label);
await mkdir(evidence, { recursive: true });
const workspace = await mkdtemp(join(own, '.work-'));
const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin', HOME: `${workspace}/home`, TMPDIR: workspace, LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1', PIP_CONFIG_FILE: '/dev/null' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
async function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, env, timeout: 120000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  records.push({ command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error}`);
  return result.stdout;
}
let server;
let started;
try {
  for (const name of ['home', 'root', 'downloads', 'snapshot', 'consumer']) await mkdir(join(workspace, name));
  const status = await run('git', ['status', '--porcelain=v1']);
  const archive = spawnSync('git', ['archive', baseline, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], { cwd: repo, env, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(String(archive.stderr));
  await writeFile(`${workspace}/baseline.tar`, archive.stdout);
  await run('tar', ['xf', `${workspace}/baseline.tar`, '-C', `${workspace}/snapshot`]);
  const sourceHashes = {};
  async function hashTree(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await hashTree(join(path, entry.name), `${prefix}${entry.name}/`);
      else sourceHashes[`${prefix}${entry.name}`] = sha(await readFile(join(path, entry.name)));
    }
  }
  await hashTree(`${workspace}/snapshot`);
  await writeFile(`${evidence}/baseline.json`, JSON.stringify({ baseline, status, archiveSha256: sha(archive.stdout), sourceHashes, package: JSON.parse(await readFile(`${workspace}/snapshot/package.json`, 'utf8')), node: process.version, platform: process.platform, arch: process.arch }, null, 2), { flag: 'wx' });
  const lock = JSON.parse(await readFile(join(own, 'dependencies.json'), 'utf8'));
  for (const dependency of lock) {
    const url = new URL(dependency.url);
    if (url.protocol !== 'https:' || url.hostname !== 'files.pythonhosted.org') throw new Error('non-PyPI artifact');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`artifact HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== dependency.sha256) throw new Error('artifact hash mismatch');
    await writeFile(`${workspace}/downloads/${dependency.filename}`, bytes);
  }
  await copyFile(join(own, 'dependencies.json'), `${evidence}/dependencies.json`);
  await run('/opt/homebrew/bin/python3', ['-I', '-m', 'venv', `${workspace}/venv`]);
  await run(`${workspace}/venv/bin/python`, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir', 'install', '--no-index', '--no-deps', ...lock.map(item => `${workspace}/downloads/${item.filename}`)]);
  await run(`${workspace}/venv/bin/python`, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir', 'check']);
  await run(`${workspace}/venv/bin/python`, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir', 'list', '--format=json']);
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${workspace}/key.pem`, '-out', `${workspace}/cert.pem`, '-days', '1', '-config', join(own, 'openssl.cnf')]);
  await copyFile(`${workspace}/cert.pem`, `${evidence}/cert.pem`);
  started = Date.now();
  server = spawn(`${workspace}/venv/bin/python`, ['-I', '-u', join(own, 'server.py'), workspace], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  server.on('error', error => { serverLog += String(error); });
  for (let attempt = 0; ; attempt++) {
    try { await readFile(`${workspace}/ready.json`); break; }
    catch { if (attempt > 100 || server.exitCode !== null) throw new Error(`server startup: ${serverLog}`); await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  await run(process.execPath, [join(own, 'raw.mjs'), workspace, evidence]);
  await writeFile(`${evidence}/server.log`, serverLog, { flag: 'wx' });
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await writeFile(`${evidence}/commands.json`, JSON.stringify(records, null, 2), { flag: 'wx' });
  await writeFile(`${evidence}/cleanup.json`, JSON.stringify({ workspace, serverPid: server?.pid, serviceDurationMs: started ? Date.now() - started : 0, removed: true }, null, 2), { flag: 'wx' });
  await rm(workspace, { recursive: true, force: true });
}
