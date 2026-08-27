import assert from 'node:assert/strict';
import { hostCases } from './cases.mjs';

export async function observeHost(library, id) {
  const specimen = hostCases.find(candidate => candidate.id === id);
  assert.ok(specimen);
  const fs = new library.MemoryFileSystem();
  await fs.mkdir('/fixture');
  const shell = new library.Shell({ fs, cwd: '/fixture', env: { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, limits: specimen.limits }).use(library.agentCommands());
  const controller = new AbortController();
  const reason = new Error('errexit-holdout-caller-cancel');
  const late = new Error('errexit-holdout-late-host-rejection');
  const marks = [], output = [], unhandled = [];
  let ticks = 0, entered = false, delivered = false, sinkCompleted = 0, caught, result;
  const onUnhandled = error => unhandled.push(String(error));
  const payload = Buffer.from('bounded\u0000pipeline\n', 'utf8');
  const pending = [];
  process.on('unhandledRejection', onUnhandled);
  shell.register({ name: 'mark', async execute(context) { marks.push([...context.args]); return { exitCode: 0 }; } });
  shell.register({ name: 'tick', async execute() { ticks += 1; return { exitCode: 0 }; } });
  shell.register({ name: 'stall', execute() {
    entered = true;
    let finish;
    pending.push(new Promise(resolve => { finish = resolve; }));
    const work = new Promise((resolve, reject) => { setTimeout(() => controller.abort(reason), 2); setTimeout(() => { delivered = true; reject(late); finish(); }, 15); });
    return work;
  } });
  shell.register({ name: 'burst', async execute(context) { await context.stdout.write(payload.subarray(0, 8)); await context.stdout.write(payload.subarray(8)); return { exitCode: 7 }; } });
  shell.register({ name: 'bridge', async execute(context) {
    const script = id === 'H01' ? 'printf "<%s>\\n" "$1"; false; mark inner-after' : id === 'H02' ? 'tick; tick; tick; tick; tick' : 'stall; mark inner-after';
    return context.invoke('bash', ['-ec', script, 'nested', ...context.args]);
  } });
  try {
    try {
      result = await shell.exec(specimen.script, { signal: controller.signal, stdout: { async write(bytes) { const copy = Buffer.from(bytes); await new Promise(resolve => setTimeout(resolve, 2)); output.push(copy); sinkCompleted += 1; } } });
    } catch (error) { caught = error; }
    const completedAtReturn = sinkCompleted;
    await Promise.all(pending);
    await new Promise(resolve => setTimeout(resolve, 25));
    const observation = { id, status: result?.exitCode ?? null, error: caught ? { name: caught.name, message: caught.message, limit: caught.limit ?? null } : null, sameReason: caught === reason, ticks, entered, delivered, stdout: Buffer.concat(output).toString('base64'), resultStdout: result?.stdout === undefined ? null : Buffer.from(result.stdout).toString('base64'), stderr: result?.stderr === undefined ? null : Buffer.from(result.stderr).toString('base64'), marks, unhandled, completedAtReturn, sinkCompleted };
    const checks = { noTrailingCommands: marks.length === 0, noUnhandled: unhandled.length === 0 };
    if (id === 'H01') Object.assign(checks, { status: result?.exitCode === 1, noHostError: !caught, literalOutput: observation.stdout === Buffer.from('<literal; false>\n').toString('base64'), noStderr: observation.stderr === '' });
    if (id === 'H02') Object.assign(checks, { sharedLimit: caught?.limit === 'maxCommands', someButNotAllTicks: ticks > 0 && ticks < 5, noOutput: observation.stdout === '' });
    if (id === 'H03') Object.assign(checks, { reasonIdentity: caught === reason, entered, lateDelivered: delivered, noOutput: observation.stdout === '' });
    if (id === 'H04') Object.assign(checks, { status: result?.exitCode === 7, noHostError: !caught, completeOutput: observation.stdout === payload.toString('base64'), noStderr: observation.stderr === '', drainedAtReturn: completedAtReturn > 0 && completedAtReturn === sinkCompleted });
    return { ...observation, checks, pass: Object.values(checks).every(Boolean) };
  } finally { await Promise.all(pending); process.off('unhandledRejection', onUnhandled); await shell.dispose(); }
}
