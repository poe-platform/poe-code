import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const before = 'const checkpoint = async () => {\n            this.signal.throwIfAborted();\n            await interruptible(new Promise(resolve => setImmediate(resolve)), this.signal);';
const after = 'const checkpoint = async () => {\n            this.signal.throwIfAborted();\n            await Promise.resolve();';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/node_modules/virtual-bash/dist/shell/runtime.js')) {
    const source = Buffer.from(result.source).toString();
    assert.equal(source.split(before).length, 2, 'one getopts-local checkpoint anchor');
    const changed = source.replace(before, after);
    fs.writeFileSync(process.env.REVIEW_MUTANT_RECORD, JSON.stringify({ id: 'task-checkpoint-v2', url, originalSHA256: createHash('sha256').update(source).digest('hex'), changedSHA256: createHash('sha256').update(changed).digest('hex'), from: before, to: after, inMemoryOnly: true }) + '\n', { flag: 'wx' });
    return { ...result, source: changed };
  }
  return result;
}
