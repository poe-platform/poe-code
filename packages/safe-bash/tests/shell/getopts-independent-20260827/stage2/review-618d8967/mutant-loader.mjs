import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const definitions = {
  'cursor-publication': ['state.getopts.cursor = result.state;', 'void result.state;'],
  'task-checkpoint': ['await interruptible(new Promise(resolve => setImmediate(resolve)), this.signal);', 'await Promise.resolve();'],
};
const mutant = definitions[process.env.REVIEW_MUTANT];
assert(mutant);
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/node_modules/virtual-bash/dist/shell/runtime.js')) {
    const source = Buffer.from(result.source).toString();
    assert.equal(source.split(mutant[0]).length, 2, 'single authenticated mutation anchor');
    const changed = source.replace(mutant[0], mutant[1]);
    fs.writeFileSync(process.env.REVIEW_MUTANT_RECORD, JSON.stringify({ id: process.env.REVIEW_MUTANT, url, originalSHA256: createHash('sha256').update(source).digest('hex'), changedSHA256: createHash('sha256').update(changed).digest('hex'), from: mutant[0], to: mutant[1], inMemoryOnly: true }) + '\n', { flag: 'wx' });
    return { ...result, source: changed };
  }
  return result;
}
