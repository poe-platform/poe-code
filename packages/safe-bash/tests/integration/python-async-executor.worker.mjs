import { Shell } from '@poe-platform/safe-bash';
import { pythonCommands, inspectPythonCapabilities, createPythonExecutorPool } from '@poe-platform/safe-bash/commands/python';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';

export default {
  async fetch() {
    for (const name of ['SharedArrayBuffer', 'Atomics']) Object.defineProperty(globalThis, name, {
      configurable: true, get() { throw new Error('Worker transport must not be inspected by the async executor'); },
    });
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input', new Uint8Array([0, 255, 42]));
    let retired = 0;
    let entered;
    let release;
    const running = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const phases = [];
    const createExecutor = () => ({
      async run(start) {
        start.onReady();
        entered();
        await held;
        const handle = await start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] });
        const bytes = await start.dispatch({ op: 'read', args: [handle, 3, 0] });
        await start.dispatch({ op: 'stdout', args: [Array.from(bytes)] });
        await start.dispatch({ op: 'close', args: [handle] });
        return 7;
      },
      async terminate() { retired++; },
    });
    const report = inspectPythonCapabilities({ createExecutor });
    const pool = createPythonExecutorPool({ createExecutor, maxConcurrentExecutors: 1 });
    const shell = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor, onProgress(event) { phases.push(event.phase); } }));
    const sibling = new Shell({ fs }).use(pythonCommands({ createExecutor: pool.createExecutor }));
    try {
      const pending = shell.exec('python3 -c pass');
      await running;
      const saturated = await sibling.exec('python -c pass');
      const occupied = pool.inspect();
      release();
      const result = await pending;
      const recovered = await sibling.exec('python -c pass');
      return Response.json({ configurationValid: report.configurationValid, exitCode: result.exitCode,
        bytes: Array.from(result.stdoutBytes), stderr: result.stderr, phases, retired,
        saturated: { exitCode: saturated.exitCode, stderr: saturated.stderr }, occupied,
        recovered: recovered.exitCode, available: pool.inspect(),
        qualification: 'asynchronous executor transport only; no Python interpreter is loaded',
      });
    } finally { release(); await shell.dispose(); await sibling.dispose(); await pool.dispose(); }
  },
};
