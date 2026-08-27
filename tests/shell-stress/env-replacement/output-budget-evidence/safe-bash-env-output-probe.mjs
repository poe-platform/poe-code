import { Shell, agentCommands, createMemoryFileSystem, writeText, pipeBytes } from '/Users/kjopek/Workspace/safe-bash/src/index.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const rows = [];
for (const flag of ['omitted', false, true]) {
  for (const mode of ['direct', 'invoke-implicit', 'invoke-explicit', 'nested-implicit', 'nested-explicit', 'recursive-implicit', 'env-recursive', 'pipeline', 'env-pipeline']) {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    let calls = 0; let output = ''; let stderr = ''; let error;
    const options = context => ({ ...(flag === 'omitted' ? {} : { replaceEnv: flag }), ...(mode.includes('explicit') ? { stdout: context.stdout, stderr: context.stderr } : {}) });
    shell.register({ name: 'tick', async execute(context) {
      calls++; await writeText(context.stdout, '1234');
      if (mode.includes('recursive') && calls < 4) return context.invoke('tick', [], options(context));
      return { exitCode: 0 };
    } });
    shell.register({ name: 'bridge', execute: context => context.invoke('tick', [], options(context)) });
    shell.register({ name: 'outer', execute: context => context.invoke('bridge', [], options(context)) });
    shell.register({ name: 'forward', async execute(context) { await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 }; } });
    const source = mode === 'direct' ? 'tick; tick; tick' : mode.startsWith('nested') ? 'outer; outer; outer' : mode.startsWith('invoke') ? 'bridge; bridge; bridge' : mode === 'env-recursive' ? 'env -i tick' : mode === 'recursive-implicit' ? 'tick' : mode === 'pipeline' ? 'tick | forward' : 'env -i tick | forward';
    try { await shell.exec(source, { limits: { maxOutputBytes: 10 }, stdout: { write(bytes) { output += Buffer.from(bytes).toString(); } }, stderr: { write(bytes) { stderr += Buffer.from(bytes).toString(); } } }); }
    catch (caught) { error = { name: caught.name, message: caught.message, limit: caught.limit, stack: caught.stack }; }
    finally { await shell.dispose(); }
    rows.push({ flag, mode, source, calls, output, outputHex: Buffer.from(output).toString('hex'), stderr, error });
  }
}
const runtimePath = '/Users/kjopek/Workspace/safe-bash/src/shell/runtime.ts';
console.log(JSON.stringify({ profile: process.env.OUTPUT_PROBE_PROFILE, importedRuntime: import.meta.resolve(runtimePath), worktreeRuntimeHash: createHash('sha256').update(readFileSync(runtimePath)).digest('hex'), rows }, null, 2));
