import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
const records = [];
for (const filename of process.argv.slice(2)) {
  let denied = false; let handle;
  try { handle = await open(filename, 'r+'); } catch (error) { denied = error.code === 'ERR_ACCESS_DENIED'; }
  finally { await handle?.close(); }
  records.push({ operation: 'write-capable-open-without-mutation', filename, denied }); assert.equal(denied, true);
}
try { Function('return 1')(); assert.fail('eval admitted'); } catch (error) { assert.equal(error.name, 'EvalError'); records.push({ evalDenied: true }); }
console.log(JSON.stringify({ records }));
