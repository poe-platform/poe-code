import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, jobId, fixtureRoot] = process.argv.slice(2);
const receipt = { schemaVersion: 1, jobId, outcome: 'PASS', raw: 'synthetic-only' };
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

switch (mode) {
  case 'pass':
    emit(receipt);
    break;
  case 'pass-exit-7':
    emit(receipt);
    process.exitCode = 7;
    break;
  case 'fail':
    emit({ ...receipt, outcome: 'FAIL' });
    break;
  case 'assert-fail':
    emit({ ...receipt, raw: 'captured-before-assert', observed: 2, expected: 1 });
    process.stderr.write('raw diagnostic before parent assertion\n');
    break;
  case 'mutate-add':
    writeFileSync(join(fixtureRoot, 'new-entry'), 'added\n', { flag: 'wx' });
    emit(receipt);
    break;
  case 'mutate-content':
    writeFileSync(join(fixtureRoot, 'fixture'), 'changed\n');
    emit(receipt);
    break;
  case 'mutate-mode':
    chmodSync(join(fixtureRoot, 'fixture'), 0o600);
    emit(receipt);
    break;
  case 'deadline':
    process.stderr.write('bounded child awaiting host deadline\n');
    setTimeout(() => { process.exitCode = 9; }, 8000);
    break;
  case 'malformed':
    process.stdout.write('{not-json}\n');
    break;
  case 'duplicate':
    emit(receipt);
    emit(receipt);
    break;
  case 'missing':
    break;
  case 'wrong-job':
    emit({ ...receipt, jobId: 'unrequested' });
    break;
  case 'signal':
    process.kill(process.pid, 'SIGTERM');
    break;
  case 'overflow':
    process.stdout.write('x'.repeat(70000));
    break;
  default:
    throw new Error('Unknown sealed synthetic child mode');
}
