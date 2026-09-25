import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell, standardCommands } from '../../../src/core.js';
import { pythonCommands } from '../../../src/commands/python/index.js';
import { createPythonShellCapability } from '../../../src/commands/python/shell-capability.js';

test('Python shell capability dispatches literal argv and explicit scripts through the parent shell', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.writeFile('/work/data', new Uint8Array([255, 0, 42]));
  const observed: unknown[] = [];
  const diagnostics: unknown[] = [];
  let interpreterRuns = 0;
  const shell = new Shell({ fs, cwd: '/work' }).use(standardCommands()).use(pythonCommands({
    createCapabilities: createPythonShellCapability,
    onDiagnostic(event) { diagnostics.push(event.cause); },
    createExecutor: () => ({
      async run(start) {
        if (++interpreterRuns > 1) return 0;
        const run = async (payload: Record<string, unknown>) => start.dispatch({op:'capability', args:['shell.run', payload]});
        observed.push(await run({ argv: ['echo', '$(secret)', 'two words'] }));
        observed.push(await run({ script: 'printf x | cat' }));
        observed.push(await run({ argv: ['cat', 'data'] }));
        observed.push(await run({ argv: ['bash', '-c', 'printf "%s" "$ONLY"'], env: {ONLY:'child'} }));
        observed.push(await run({ argv: ['bash', '-c', 'printf err >&2; exit 7'] }));
        const opened = await start.dispatch({op:'capability',args:['shell.stream.open',{argv:['echo','stream']} ]}) as {handle:string};
        const first = await start.dispatch({op:'capability',args:['shell.stream.next',opened]}) as {done:boolean;value:{type:string;data:number[]}};
        assert.equal(first.value.type, 'stdout');
        assert.equal(new TextDecoder().decode(Uint8Array.from(first.value.data)), 'stream\n');
        await start.dispatch({op:'capability',args:['shell.stream.close',opened]});
        const limit = await run({argv:['echo','overflow'],max_output_bytes:1}) as {error:{code:string}};
        assert.ok(limit.error, JSON.stringify(limit));
        assert.equal(limit.error.code, 'limit');
        const nested = await run({argv:['python','-c','pass']}) as {error:{code:string}};
        assert.ok(nested.error, JSON.stringify(nested));
        assert.equal(nested.error.code, 'nested_python');
        const nestedScript = await run({script:'python -c pass'}) as {returncode:number};
        assert.equal(nestedScript.returncode, 1);
        assert.equal(interpreterRuns, 1);
        const timeout = await run({argv:['wait-for-cancellation'],timeout:0.01}) as {error:{code:string}};
        assert.ok(timeout.error, JSON.stringify(timeout));
        assert.equal(timeout.error.code, 'timeout');
        return 0;
      }, terminate() {},
    }),
  }));
  shell.register({name:'wait-for-cancellation',async execute(context) {
    await new Promise<void>((resolve,reject) => {
      if (context.signal.aborted) { reject(context.signal.reason); return; }
      context.signal.addEventListener('abort',() => reject(context.signal.reason),{once:true});
    });
    return {exitCode:0};
  }});
  try {
    const result = await shell.exec('python -c pass');
    assert.equal(result.exitCode, 0, result.stderr + diagnostics.map(String).join('\n'));
    const results = observed as {stdout: number[]; stderr: number[]; returncode: number}[];
    assert.equal(new TextDecoder().decode(Uint8Array.from(results[0]!.stdout)), '$(secret) two words\n');
    assert.equal(new TextDecoder().decode(Uint8Array.from(results[1]!.stdout)), 'x');
    assert.deepEqual(results[2]!.stdout, [255,0,42]);
    assert.equal(new TextDecoder().decode(Uint8Array.from(results[3]!.stdout)), 'child');
    assert.equal(results[4]!.returncode, 7);
    assert.equal(new TextDecoder().decode(Uint8Array.from(results[4]!.stderr)), 'err');
  } finally { await shell.dispose(); }
});
