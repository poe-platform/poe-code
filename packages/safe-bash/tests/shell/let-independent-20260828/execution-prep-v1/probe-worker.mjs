import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { capture, failure, loadProduct, readAdmission, activationReceipt } from './support.mjs';

const manifest = readAdmission(process.argv[2], process.argv[3]);
if (process.argv[4] === 'fallback') await import(process.env.LET_FORBIDDEN_SOURCE);
if (process.argv[4] === 'read-fence') readFileSync(fileURLToPath(process.env.LET_FORBIDDEN_SOURCE));
const { api } = await loadProduct(manifest, specifier => import.meta.resolve(specifier));
const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
const observation = { id: 'A0', pass: false, settled: false, disposed: false };
try {
  const result = await shell.exec('let 1'); observation.result = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); observation.pass = true;
} catch (error) { observation.failure = failure(error); }
finally {
  observation.settled = true;
  const disposed = await capture(shell.dispose()); observation.disposed = disposed.kind === 'return'; if (!observation.disposed) observation.pass = false;
  process.stdout.write(JSON.stringify({ observation }) + '\n'); activationReceipt();
  process.stdout.write(JSON.stringify({ summary: { cases: 1, pass: observation.pass ? 1 : 0, failed: observation.pass ? [] : ['A0'] } }) + '\n');
  if (!observation.pass) process.exitCode = 1;
}
