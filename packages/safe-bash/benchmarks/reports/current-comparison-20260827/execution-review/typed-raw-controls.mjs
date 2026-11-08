import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function typedRawControls(execution) {
  const { observeExpanded } = await import(pathToFileURL(`${execution}/expanded.mjs`));
  const { compare } = await import(pathToFileURL(`${execution}/reuse/expanded-common.mjs`));
  const baseUrl = 'http://127.0.0.1:43210';
  const rawStdout = new Uint8Array(Buffer.concat([Buffer.from([0, 128, 255]), Buffer.from(baseUrl)]));
  const rawStderr = new Uint8Array(Buffer.concat([Buffer.from([255, 0, 129]), Buffer.from(baseUrl)]));
  const baselineStderr = `é:${baseUrl}`;
  const results = [];
  for (const profile of ['original', 'aligned']) for (const engine of ['virtual-bash', 'just-bash']) {
    const ours = engine === 'virtual-bash';
    const chronology = [], mkdirCalls = [], execCalls = [], issues = [];
    let constructor, lastSnapshotByteRead = false, disposed = 0;
    const signal = new AbortController().signal;
    const vfs = {
      async mkdir(filename) { mkdirCalls.push(filename); },
      async chmod() {},
      async readdir() { return ours ? [{ name: 'artifact' }] : ['artifact']; },
      async lstat() { return ours ? { type: 'file', mode: 0o600 } : { isFile: true, isDirectory: false, isSymbolicLink: false, mode: 0o600 }; },
      async readFile(filename, options) { assert.equal(options.signal, signal); lastSnapshotByteRead = true; chronology.push('snapshot-byte-read'); return new Uint8Array(rawStdout); },
      async readFileBuffer() { lastSnapshotByteRead = true; chronology.push('snapshot-byte-read'); return new Uint8Array(rawStdout); },
    };
    class SyntheticShell {
      constructor(options) { constructor = options; }
      use() { return this; }
      async exec(script, options) {
        execCalls.push(script);
        assert.equal(options.signal, signal);
        return { stdoutBytes: new Uint8Array(rawStdout), stderrBytes: new Uint8Array(rawStderr), stdout: 'DELIBERATELY WRONG PUBLIC TEXT', stderr: ours ? 'DELIBERATELY WRONG PUBLIC TEXT' : baselineStderr, exitCode: 0 };
      }
      async dispose() { disposed++; }
    }
    const library = { createMemoryFileSystem: () => vfs, InMemoryFs: class { constructor() { return vfs; } }, Shell: SyntheticShell, Bash: SyntheticShell, CommandRegistry: class {}, agentCommands: () => null, stdoutAsBytes: () => Buffer.from(rawStdout).toString('latin1'), latin1FromBytes: value => value };
    const specimen = { id: 'independent-R1-R2-typed-not-maincase', directories: [], files: {}, fileModes: {}, fileTimes: {}, stdin: '', script: 'synthetic-typed-byte-probe', modes: true };
    let observation;
    try {
      observation = await observeExpanded({ library, engine, specimen, profile, baseUrl, signal, mark: async (phase, detail) => {
        if (phase === 'snapshot-complete') assert.ok(lastSnapshotByteRead, 'completion must follow actual final VFS byte read');
        chronology.push({ phase, detail });
      } });
      const phases = chronology.filter(event => typeof event === 'object').map(event => event.phase).filter(phase => phase !== 'initialization-exec');
      assert.deepEqual(phases, ['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled']);
      const stderrBytes = ours ? Buffer.from(rawStderr) : Buffer.from(baselineStderr, 'utf8');
      assert.equal(observation.raw.stdoutBase64, Buffer.from(rawStdout).toString('base64'));
      assert.equal(observation.raw.stderrBase64, stderrBytes.toString('base64'));
      const stdoutProjected = Buffer.concat([Buffer.from([0, 128, 255]), Buffer.from('{{BASE}}')]).toString('base64');
      const stderrProjected = (ours ? Buffer.concat([Buffer.from([255, 0, 129]), Buffer.from('{{BASE}}')]) : Buffer.from('é:{{BASE}}')).toString('base64');
      const golden = { stdout: stdoutProjected, stderr: stderrProjected, exitCode: 0, entries: { artifact: { type: 'file', mode: 0o600, bytes: stdoutProjected } } };
      assert.ok(compare(golden, observation).pass, 'unchanged four-field predicate and projected VFS bytes');
      assert.notEqual(observation.stdout, observation.raw.stdoutBase64, 'raw must remain unprojected');
      assert.equal(mkdirCalls.includes('/tmp'), profile === 'aligned');
      assert.equal(Object.hasOwn(constructor.env, 'TMPDIR'), profile === 'aligned');
      if (profile === 'aligned') assert.equal(constructor.env.TMPDIR, '/tmp');
      assert.equal(disposed, ours ? 1 : 0);
      assert.deepEqual(execCalls, ours ? ['', specimen.script] : [specimen.script]);
    } catch (error) { issues.push(String(error.stack ?? error)); }
    results.push({ profile, engine, syntheticOnly: true, plainUint8ArrayChannels: true, publicTextDeliberatelyDifferent: ours, loopbackStringOnlyNoSocket: true, chronology, mkdirCalls, execCalls, disposed, satisfied: issues.length === 0, issues, observation });
  }
  return results;
}
