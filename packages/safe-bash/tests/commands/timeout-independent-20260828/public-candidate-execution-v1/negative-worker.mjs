import assert from 'node:assert/strict';
import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(process.env.TIMEOUT_CONFIG));
assert.equal(config.executionAuthorized, true);
const expected = config.negative;
let caught;
try {
  if (expected.kind === 'root-export') {
    const root = await import('virtual-bash');
    assert.equal(typeof root.createTimeoutCommand, 'function', 'MISSING_ROOT_EXPORT:createTimeoutCommand');
  } else if (expected.kind === 'wrong-leaf') {
    const leaf = await import('virtual-bash/commands/timeout');
    assert.deepEqual(Object.keys(leaf).sort(), ['createTimeoutCommand','createTimeoutCommands','timeoutCommands'], 'LEAF_EXPORTS');
  } else await import(expected.target ?? 'virtual-bash/commands/timeout');
} catch (error) { caught = { name: error.name, code: error.code, message: error.message, stack: error.stack }; }
const receipt = { kind: expected.kind, caught, survived: caught === undefined };
fs.writeFileSync(`${config.output}/NEGATIVE.json`, JSON.stringify(receipt,null,2)+'\n', { flag:'wx' });
console.log(JSON.stringify(receipt));
assert.ok(caught, 'NEGATIVE_SURVIVED');assert.equal(caught.code,expected.code);assert.ok(caught.message.includes(expected.message),'WRONG_NEGATIVE_REASON');
