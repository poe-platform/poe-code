import { inspectPythonCapabilities, pythonCommands, PythonFailure, Shell, createPythonPackageEnvironment, createPythonPackageManifestStore } from '@poe-platform/safe-bash';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';

function check(condition, message) { if (!condition) throw new Error(message); }

export default {
  async test() {
    const manifestStore = createPythonPackageManifestStore();
    const context = { fs: new MemoryFileSystem(), cwd: '/', signal: new AbortController().signal };
    const first = createPythonPackageEnvironment({ manifestStore, scope: 'tenant' });
    const installed = await first.prepare(context);
    await first.dispatch('package-commit', [installed.session, ['example==1']], context);
    first.finish(installed);
    await first.dispose();
    const second = createPythonPackageEnvironment({ manifestStore, scope: 'tenant' });
    const restored = await second.prepare(context);
    check(JSON.stringify(restored.requirements) === '["example==1"]', 'Host manifest state did not survive environment disposal');
    second.finish(restored);
    await second.dispose(); manifestStore.dispose();
    const report = inspectPythonCapabilities({});
    check(!report.configurationValid, 'Absent executor must not pass preflight');
    check(report.failures.some(failure => failure.category === 'executor-unavailable'), 'Missing executor category');
    try {
      pythonCommands({});
      throw new Error('Missing executor was accepted');
    } catch (error) {
      check(error instanceof PythonFailure && error.category === 'executor-unavailable', 'Missing typed registration failure');
    }
    const diagnostics = [];
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
      createWorker() { throw new PythonFailure('executor-unavailable'); },
      onDiagnostic(event) { diagnostics.push(event); },
    }));
    try {
      const result = await shell.exec('python -c pass');
      check(result.exitCode === 1, 'Unsupported executor must fail');
      check(!result.stderr.includes('internal error'), 'Generic failure leaked');
      check(diagnostics.some(event => ['executor-unavailable', 'transport-unavailable'].includes(event.failure.category)), 'Missing host capability diagnostic');
    } finally { await shell.dispose(); await shell.dispose(); }
    console.log('portable public Python package state, preflight and unsupported-host diagnostics passed');
  },
};
