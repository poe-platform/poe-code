import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { Session } from 'node:inspector';
import { pathToFileURL } from 'node:url';

const started = performance.now(), root = process.env.SORT_ROOT, variant = process.env.SORT_VARIANT;
const imports = new Set();
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  assert.ok(!result.url.includes('/Users/kjopek/Workspace/'), result.url);
  assert.ok(!result.url.startsWith(pathToFileURL(root).href) || !result.url.includes('/src/'), result.url);
  imports.add(result.url); return result;
} });
const source = variant === 'baseline' ? `${root}/baseline/node_modules/just-bash/dist/bundle/index.js` : `${root}/${variant}/dist/index.js`;
const library = await import(pathToFileURL(source));
const environment = { PATH: '/usr/bin:/bin', HOME: '/work', TMPDIR: '/tmp', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
const fixtures = JSON.parse(await readFile(`${root}/workloads.json`, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const setupStarted = performance.now();
const fs = variant === 'baseline' ? new library.InMemoryFs() : library.createMemoryFileSystem();
await fs.mkdir('/tmp', { recursive: true }); await fs.mkdir('/work', { recursive: true });
const shell = variant === 'baseline' ? new library.Bash({ fs, cwd: '/work', env: environment,
  executionLimits: { maxOutputSize: 4 * 1024 * 1024, maxCommandCount: 10000, maxLoopIterations: 10000, maxExecutionTimeMs: 5000 } })
  : new library.Shell({ fs, cwd: '/work', env: environment, limits: { maxOutputBytes: 4 * 1024 * 1024, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } }).use(library.agentCommands());
if (variant !== 'baseline') await shell.exec('');
const setupMs = performance.now() - setupStarted, importAndSetupMs = performance.now() - started;
async function execute(specimen) {
  for (const entry of await fs.readdir('/work')) await fs.rm('/work/' + (typeof entry === 'string' ? entry : entry.name), { recursive: true, force: true });
  for (const [name, value] of Object.entries(specimen.files)) await fs.writeFile('/work/' + name, Buffer.from(value, 'base64'));
  const input = Buffer.from(specimen.stdin, 'base64'), controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('bounded benchmark execution')), 5000);
  let result, milliseconds;
  const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage();
  try {
    const start = performance.now();
    result = variant === 'baseline' ? await shell.exec(specimen.script, { stdin: input.toString('latin1'), stdinKind: 'bytes', rawScript: true, replaceEnv: true, env: environment, signal: controller.signal })
      : await shell.exec(specimen.script, { stdin: input, signal: controller.signal });
    milliseconds = performance.now() - start;
  } finally { clearTimeout(deadline); }
  const cpu = process.cpuUsage(cpuBefore), memoryAfter = process.memoryUsage();
  const stdout = variant === 'baseline' ? Buffer.from(library.latin1FromBytes(library.stdoutAsBytes(result)), 'latin1') : Buffer.from(result.stdoutBytes);
  const stderr = variant === 'baseline' ? Buffer.from(result.stderr) : Buffer.from(result.stderrBytes);
  const files = {};
  for (const entry of await fs.readdir('/work')) {
    const name = typeof entry === 'string' ? entry : entry.name;
    files[name] = Buffer.from(variant === 'baseline' ? await fs.readFileBuffer('/work/' + name) : await fs.readFile('/work/' + name)).toString('base64');
  }
  const observation = { stdout: stdout.toString('base64'), stderr: stderr.toString('base64'), status: result.exitCode, files };
  const equivalent = JSON.stringify(observation) === JSON.stringify(specimen.expected);
  return { id: specimen.id, milliseconds, equivalent, stdout: { bytes: stdout.length, sha256: hash(stdout) }, stderr: stderr.toString('base64'), status: result.exitCode,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { bytes: Buffer.from(bytes, 'base64').length, sha256: hash(Buffer.from(bytes, 'base64')) }])),
    ...(!equivalent ? { actual: observation } : {}), memoryBefore, memoryAfter, processLifetimeMaxRssKiB: process.resourceUsage().maxRSS, cpu };
}
process.send({ ready: true, variant, pid: process.pid, node: process.version, setupMs, importAndSetupMs });
process.on('message', async message => {
  try {
    if (message.close) { if (variant !== 'baseline') await shell.dispose(); process.send({ id: message.id, closed: true, imports: [...imports] }); process.disconnect(); return; }
    if (message.gc) { global.gc?.(); process.send({ id: message.id, gc: true }); return; }
    const specimen = fixtures.find(row => row.id === message.workload); assert.ok(specimen);
    const samples = [];
    let profiler;
    const post = method => new Promise((resolve, reject) => profiler.post(method, (error, result) => error ? reject(error) : resolve(result)));
    if (message.profile) { profiler = new Session(); profiler.connect(); await post('Profiler.enable'); await post('Profiler.start'); }
    try { for (let index = 0; index < (message.repetitions ?? 1); index++) samples.push(await execute(specimen)); }
    finally { if (profiler) { const profile = await post('Profiler.stop'); profiler.disconnect(); await appendFile(message.profile, JSON.stringify(profile) + '\n', { flag: 'wx' }); } }
    process.send({ id: message.id, samples });
  } catch (error) { process.send({ id: message.id, error: error.stack ?? String(error) }); }
});
