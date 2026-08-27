import assert from 'node:assert/strict';
import test from 'node:test';
import { posix } from 'node:path';
import { observeExpanded } from '../../expanded.mjs';
import { compare } from '../../reuse/expanded-common.mjs';

for (const engine of ['virtual-bash', 'just-bash']) for (const profile of ['original', 'aligned']) {
  await test(`R1/R2 actual observeExpanded: ${engine}/${profile}`, async () => {
    const ours = engine === 'virtual-bash';
    const baseUrl = 'http://127.0.0.1:43210';
    const binary = Buffer.from([0, 127, 128, 255]);
    const stdoutBytes = Buffer.concat([binary, Buffer.from(`${baseUrl}/out\n`)]);
    const stderrBytes = Buffer.concat([Buffer.from([255, 0]), Buffer.from(`${baseUrl}/err\n`)]);
    const baselineStderr = `é ${baseUrl}/err\n`;
    const projectedStdout = Buffer.concat([binary, Buffer.from('{{BASE}}/out\n')]);
    const projectedStderr = ours ? Buffer.concat([Buffer.from([255, 0]), Buffer.from('{{BASE}}/err\n')]) : Buffer.from('é {{BASE}}/err\n');
    const entries = new Map([['/', { type: 'directory', mode: 0o755 }]]);
    const phases = [], timeline = [], calls = [];
    let enterSnapshot, releaseSnapshot, held = false;
    const snapshotEntered = new Promise(resolveEntered => { enterSnapshot = resolveEntered; });
    const snapshotReleased = new Promise(resolveReleased => { releaseSnapshot = resolveReleased; });
    const signal = new AbortController().signal;
    class SyntheticFs {
      async mkdir(filename) {
        const parent = posix.dirname(filename);
        if (!entries.has(parent)) await this.mkdir(parent);
        if (!entries.has(filename)) entries.set(filename, { type: 'directory', mode: 0o755 });
      }
      async chmod(filename, mode) { entries.get(filename).mode = mode; }
      async writeFile(filename, bytes) { entries.set(filename, { type: 'file', mode: 0o644, bytes: Buffer.from(bytes) }); }
      async utimes() {}
      async readdir(filename) {
        const names = [...entries.keys()].filter(name => name !== filename && posix.dirname(name) === filename).map(name => posix.basename(name));
        return ours ? names.map(name => ({ name })) : names;
      }
      async lstat(filename) {
        const entry = entries.get(filename);
        return { type: entry.type, mode: entry.mode, isFile: entry.type === 'file', isDirectory: entry.type === 'directory', isSymbolicLink: false };
      }
      async readFile(filename) {
        timeline.push(`read-start:${filename}`);
        if (!held) { held = true; enterSnapshot(); await snapshotReleased; }
        const bytes = Buffer.from(entries.get(filename).bytes);
        timeline.push(`read-complete:${filename}`);
        return bytes;
      }
      async readFileBuffer(filename) { return this.readFile(filename); }
    }
    class SyntheticRegistry {}
    class SyntheticShell {
      constructor(options) { this.options = options; calls.push({ kind: 'constructor', options }); }
      use() { return this; }
      async exec(script, options) {
        calls.push({ kind: 'exec', script, options });
        if (script) await this.options.fs.writeFile('/fixture/output', stdoutBytes);
        return { exitCode: 0, stdout: 'deliberately not the public stdout bytes', stderr: ours ? 'deliberately not the public stderr bytes' : baselineStderr, stdoutBytes, stderrBytes };
      }
      async dispose() { calls.push({ kind: 'dispose' }); }
    }
    const library = { createMemoryFileSystem: () => new SyntheticFs(), InMemoryFs: SyntheticFs, CommandRegistry: SyntheticRegistry, Shell: SyntheticShell, Bash: SyntheticShell, agentCommands: () => 'synthetic-plugin-token', stdoutAsBytes: () => stdoutBytes.toString('latin1'), latin1FromBytes: value => value };
    const specimen = { id: 'synthetic-expanded-adapter-r1-r2-not-main', script: 'synthetic {{BASE}}', directories: [], files: { input: binary.toString('base64') }, fileModes: { input: 0o600 }, fileTimes: {}, stdin: binary.toString('base64'), modes: true, network: false };
    const operation = observeExpanded({ library, engine, specimen, profile, baseUrl, signal, mark: async phase => { phases.push(phase); timeline.push(phase); } });
    await snapshotEntered;
    const phasesWhileSnapshotPending = [...phases];
    releaseSnapshot();
    const observation = await operation;
    const required = ['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled'];
    const issues = [];
    const check = (label, actual, expected) => { if (!compareValues(actual, expected)) issues.push({ label, actual, expected }); };
    check('no premature snapshot completion while actual VFS read is pending', phasesWhileSnapshotPending.filter(phase => required.includes(phase)), ['exec-start', 'exec-settled']);
    check('exact lifecycle phases after actual snapshot completion', phases.filter(phase => required.includes(phase)), required);
    check('marker follows both completed snapshot reads', timeline.indexOf('snapshot-complete') > timeline.lastIndexOf('read-complete:/fixture/output'), true);
    check('unprojected public stdout bytes retained', observation.raw?.stdoutBase64 ?? null, stdoutBytes.toString('base64'));
    check('unprojected available stderr representation retained', observation.raw?.stderrBase64 ?? null, (ours ? stderrBytes : Buffer.from(baselineStderr, 'utf8')).toString('base64'));
    check('baseline stderr remains explicitly public-text qualified', ours || observation.capture.includes('stderr UTF8 public text'), true);
    const expected = { stdout: projectedStdout.toString('base64'), stderr: projectedStderr.toString('base64'), exitCode: 0, entries: { input: { type: 'file', mode: 0o600, bytes: binary.toString('base64') }, output: { type: 'file', mode: 0o644, bytes: projectedStdout.toString('base64') } } };
    check('unchanged scored four-field projection', compare(expected, observation).pass, true);
    check('supplemental raw remains outside scored predicate', compare(expected, { ...observation, raw: { stdoutBase64: 'unscored', stderrBase64: 'unscored' } }).pass, true);
    check('exact scratch profile', entries.has('/tmp'), profile === 'aligned');
    const environment = calls.find(call => call.kind === 'constructor').options.env;
    check('TMPDIR omitted or explicitly aligned', Object.hasOwn(environment, 'TMPDIR') ? environment.TMPDIR : null, profile === 'aligned' ? '/tmp' : null);
    check('only actual ours dispose invoked', calls.filter(call => call.kind === 'dispose').length, ours ? 1 : 0);
    assert.deepEqual(issues, []);
  });
}

function compareValues(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }
