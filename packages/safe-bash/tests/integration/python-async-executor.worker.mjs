import { Shell } from '@poe-platform/safe-bash';
import { pythonCommands, inspectPythonCapabilities } from '@poe-platform/safe-bash/commands/python';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';

export default {
  async fetch() {
    for (const name of ['SharedArrayBuffer', 'Atomics']) Object.defineProperty(globalThis, name, {
      configurable: true, get() { throw new Error('Worker transport must not be inspected by the async executor'); },
    });
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input', new Uint8Array([0, 255, 42]));
    let retired = 0;
    const phases = [];
    const createExecutor = () => ({
      async run(start) {
        start.onReady();
        const handle = await start.dispatch({ op: 'open', args: ['/input', { access: 'read' }] });
        const bytes = await start.dispatch({ op: 'read', args: [handle, 3, 0] });
        await start.dispatch({ op: 'stdout', args: [Array.from(bytes)] });
        await start.dispatch({ op: 'close', args: [handle] });
        return 7;
      },
      async terminate() { retired++; },
    });
    const report = inspectPythonCapabilities({ createExecutor });
    const shell = new Shell({ fs }).use(pythonCommands({ createExecutor, onProgress(event) { phases.push(event.phase); } }));
    try {
      const result = await shell.exec('python3 -c pass');
      return Response.json({ configurationValid: report.configurationValid, exitCode: result.exitCode,
        bytes: Array.from(result.stdoutBytes), stderr: result.stderr, phases, retired,
        qualification: 'asynchronous executor transport only; no Python interpreter is loaded',
      });
    } finally { await shell.dispose(); }
  },
};
