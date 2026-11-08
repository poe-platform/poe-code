import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShell } from '../../src/shell/parser.js';
import { parseArithmetic } from '../../src/shell/arithmetic.js';
import { ParseBudget } from '../../src/shell/parse-budget.js';
import { setup } from './helpers.js';
test('shell syntax and arithmetic admit nesting beyond former ceilings', async () => {
  const source = 'args ' + '${missing:-'.repeat(65) + 'leaf' + '}'.repeat(65);
  assert.doesNotThrow(() => parseShell(source));
  assert.throws(() => parseShell(source, 0, { maxSyntaxDepth: 64 }), /nesting/);
  const arithmetic = '('.repeat(65) + '1' + ')'.repeat(65);
  assert.doesNotThrow(() => parseArithmetic(arithmetic));
  assert.throws(() => parseArithmetic(arithmetic, 0, new ParseBudget(undefined, undefined, undefined, 64)), /nesting/);
  const {shell} = setup();
  try { assert.equal((await shell.exec(source)).stdout, '["leaf"]'); } finally {await shell.dispose();}
});
test('admitted descriptor handles default to unlimited and respect an explicit quota', async () => {
  for (const maxAdmittedHandles of [Infinity, 64]) {
    const {shell,fs} = setup({ limits: { maxAdmittedHandles } });
    await fs.writeFile('/input', new Uint8Array());
    shell.register({ name:'handles', async execute(context) {
      const handles = [];
      try {
        for(let index=0;index<64;index++) handles.push(await context.admittedHandles!.acquire(3,['read'],context.signal));
        if(maxAdmittedHandles===Infinity) handles.push(await context.admittedHandles!.acquire(3,['read'],context.signal));
        else await assert.rejects(context.admittedHandles!.acquire(3,['read'],context.signal), {code:'EMFILE'});
        return {exitCode:0};
      } finally {for(const handle of handles) await handle.close();}
    } });
    try {const result = await shell.exec('handles 3</input');assert.equal(result.exitCode,0,result.stderr);} finally {await shell.dispose();}
  }
});
