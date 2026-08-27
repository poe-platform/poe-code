import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { apacheConfig } from './apache.mjs';
import { connect } from 'node:net';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const baseline = '1ea140b50f0b4edcfa28a60e2f89351b97e509a5';
const label = process.argv[2] ?? 'wsgidav-raw-initial';
const provider = process.argv[3] ?? 'wsgidav';
if (!['wsgidav', 'apache'].includes(provider)) throw new Error('invalid provider');
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('invalid cohort label');
const evidence = join(own, 'evidence', label);
await mkdir(evidence, { recursive: true });
const workspace = await mkdtemp(join(own, '.work-'));
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin`, HOME: `${workspace}/home`, TMPDIR: workspace, LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1', PIP_CONFIG_FILE: '/dev/null' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
async function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, env, timeout: 120000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  records.push({ command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
let server;
let started;
let serverLog = '';
try {
  for (const name of ['home', 'root', 'downloads', 'snapshot', 'consumer']) await mkdir(join(workspace, name));
  const status = await run('git', ['status', '--porcelain=v1']);
  const fixtureHashes = {};
  await mkdir(`${evidence}/inputs`);
  for (const filename of (await readdir(own)).filter(name => /\.(mts|mjs|py|cnf|json)$/.test(name))) {
    fixtureHashes[filename] = sha(await readFile(join(own, filename)));
    await copyFile(join(own, filename), `${evidence}/inputs/${filename}`);
  }
  await writeFile(`${evidence}/fixture-hashes.json`, JSON.stringify(fixtureHashes, null, 2), { flag: 'wx' });
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
  await run(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', `${workspace}/snapshot/tsconfig.build.json`]);
  await writeFile(`${workspace}/user.npmrc`, '');
  await writeFile(`${workspace}/global.npmrc`, '');
  env.NPM_CONFIG_USERCONFIG = `${workspace}/user.npmrc`;
  env.NPM_CONFIG_GLOBALCONFIG = `${workspace}/global.npmrc`;
  const packed = JSON.parse(await run('npm', ['pack', `${workspace}/snapshot`, '--ignore-scripts', '--json', '--pack-destination', `${workspace}/consumer`]))[0];
  await mkdir(`${workspace}/consumer/node_modules/virtual-bash`, { recursive: true });
  await writeFile(`${workspace}/consumer/package.json`, JSON.stringify({ name: 'independent-webdav-consumer', private: true, type: 'module' }));
  await run('tar', ['xf', `${workspace}/consumer/${packed.filename}`, '-C', `${workspace}/consumer/node_modules/virtual-bash`, '--strip-components=1']);
  await writeFile(`${evidence}/package.json`, JSON.stringify({ ...packed, sha256: sha(await readFile(`${workspace}/consumer/${packed.filename}`)) }, null, 2), { flag: 'wx' });
  const consumerFiles = ['https.mts', 'example.mts', 'consumer.mts'];
  for (const filename of consumerFiles) await copyFile(join(own, filename), `${workspace}/consumer/${filename}`);
  await run(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', '--rootDir', `${workspace}/consumer`, '--outDir', `${workspace}/consumer/out`, ...consumerFiles.map(filename => `${workspace}/consumer/${filename}`)], `${workspace}/consumer`);
  const lock = provider === 'wsgidav' ? JSON.parse(await readFile(join(own, 'dependencies.json'), 'utf8')) : [];
  for (const dependency of lock) {
    const url = new URL(dependency.url);
    if (url.protocol !== 'https:' || url.hostname !== 'files.pythonhosted.org') throw new Error('non-PyPI artifact');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`artifact HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== dependency.sha256) throw new Error('artifact hash mismatch');
    await writeFile(`${workspace}/downloads/${dependency.filename}`, bytes);
  }
  if (provider === 'wsgidav') {
  await copyFile(join(own, 'dependencies.json'), `${evidence}/dependencies.json`);
  await run('/opt/homebrew/bin/python3', ['-I', '-m', 'venv', `${workspace}/venv`]);
  await run(`${workspace}/venv/bin/python`, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir', 'install', '--no-index', '--no-deps', ...lock.map(item => `${workspace}/downloads/${item.filename}`)]);
  await run(`${workspace}/venv/bin/python`, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir', 'check']);
  await run(`${workspace}/venv/bin/python`, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir', 'list', '--format=json']);
  await run(`${workspace}/venv/bin/python`, ['-I', '-c', 'import sys,ssl,ensurepip,pathlib,hashlib,json; print(json.dumps({"python":sys.version,"ssl":ssl.OPENSSL_VERSION,"bootstrap_wheels":{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (pathlib.Path(ensurepip.__file__).parent / "_bundled").glob("*.whl")}},indent=2))']);
  }
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${workspace}/key.pem`, '-out', `${workspace}/cert.pem`, '-days', '1', '-config', join(own, 'openssl.cnf')]);
  await copyFile(`${workspace}/cert.pem`, `${evidence}/cert.pem`);
  started = Date.now();
  if (provider === 'apache') {
    const profile = await apacheConfig(workspace);
    profile.version = await run('/usr/sbin/httpd', ['-v']);
    await writeFile(`${evidence}/apache-profile.json`, JSON.stringify(profile, null, 2), { flag: 'wx' });
    await run('/usr/sbin/httpd', ['-t', '-f', `${workspace}/httpd.conf`]);
    server = spawn('/usr/sbin/httpd', ['-X', '-f', `${workspace}/httpd.conf`], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    await writeFile(`${workspace}/ready.json`, JSON.stringify({ port: profile.port }));
  } else {
    server = spawn(`${workspace}/venv/bin/python`, ['-I', '-u', join(own, 'server.py'), workspace], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  server.on('error', error => { serverLog += String(error); });
  for (let attempt = 0; ; attempt++) {
    try {
      const { port } = JSON.parse(await readFile(`${workspace}/ready.json`));
      await new Promise((resolve, reject) => { const socket = connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject); });
      break;
    }
    catch { if (attempt > 100 || server.exitCode !== null) throw new Error(`server startup: ${serverLog}`); await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  await run(process.execPath, [join(own, 'raw.mjs'), workspace, evidence]);
  const { port } = JSON.parse(await readFile(`${workspace}/ready.json`));
  const config = { baseUrl: `https://127.0.0.1:${port}/dav/`, aliasUrl: `https://127.0.0.1:${port}/alias/`, serverRoot: `${workspace}/root`, caFile: `${workspace}/cert.pem`, authorization: `Basic ${Buffer.from('fixture:fixture-only-password').toString('base64')}` };
  await writeFile(`${workspace}/config.json`, JSON.stringify(config, null, 2));
  await copyFile(`${workspace}/config.json`, `${evidence}/literal-config.json`);
  await run(process.execPath, ['--unhandled-rejections=strict', `${workspace}/consumer/out/example.mjs`, `${workspace}/config.json`]);
  await run(process.execPath, ['--unhandled-rejections=strict', `${workspace}/consumer/out/consumer.mjs`, `${workspace}/config.json`, evidence, provider]);
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await writeFile(`${evidence}/server.log`, serverLog, { flag: 'wx' });
  try { await copyFile(`${workspace}/error.log`, `${evidence}/apache-error.log`); } catch {}
  await writeFile(`${evidence}/commands.json`, JSON.stringify(records, null, 2), { flag: 'wx' });
  await rm(workspace, { recursive: true, force: true });
  await writeFile(`${evidence}/cleanup.json`, JSON.stringify({ workspace, serverPid: server?.pid, serviceDurationMs: started ? Date.now() - started : 0, removed: true }, null, 2), { flag: 'wx' });
}
