import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exactJson, verifyTree, check, Hold } from './core.mjs';
import { executeCase, assertCase } from './executor.mjs';
import { installGuard } from './guard.mjs';

const [jobFile, size, digest] = process.argv.slice(2);
check(Number.isSafeInteger(Number(size)) && Number(size) > 0, 'JOB_BYTES_REQUIRED');
const job = await exactJson(jobFile, { bytes: Number(size), sha256: digest });
const synthetic = job.authorization === 'SEALED_SYNTHETIC_QUALIFICATION';
check(synthetic || (job.authorization === 'ROOT_AUTHORIZED_DIFFERENT_MODULE_REVIEW' && job.candidateCommit?.length === 40), 'CANDIDATE_HANDOFF_REQUIRED');
check(['SOURCE', 'INSTALLED_MOVED'].includes(job.layout) && job.rows.length <= 138, 'JOB_SCOPE');
check(job.factoryExport && job.apiAuthority && job.entries.some(entry => entry.path === job.entry), 'DECLARED_API_REQUIRED');
check(job.directOnly === true && job.outputBytes === 65536, 'DIRECT_FIXTURE_BOUND_ONLY');
await verifyTree(job.root, job.entries);
installGuard(job.root, job.entries, job.builtins);
const module = await import(pathToFileURL(path.join(job.root, job.entry)).href);
if (synthetic) check(module.classification === 'SYNTHETIC_HELPER_CONTROL_NOT_PRODUCT', 'SYNTHETIC_ONLY');
check(typeof module[job.factoryExport] === 'function', 'DECLARED_EXPORT_MISSING');
const command = module[job.factoryExport](job.options);
check(command?.name === 'xan' && typeof command.execute === 'function', 'COMMAND_DEFINITION_BINDING');
async function emit(value) {
  const text = `${JSON.stringify(value, (_, item) => item?.type === 'Buffer' && Array.isArray(item.data) ? { base64: Buffer.from(item.data).toString('base64') } : item)}\n`;
  if (!process.stdout.write(text)) await new Promise(resolve => process.stdout.once('drain', resolve));
}
for (const row of job.rows) {
  let record;
  try {
    record = await executeCase(command.execute, row, { outputBytes: job.outputBytes, receipt: async observed => emit({ stage: 'RECEIPT_BEFORE_ASSERTION', observed }) });
    await verifyTree(job.root, job.entries);
  } catch (error) {
    await emit({ id: row.id, status: 'DEPENDENTS_HELD', code: error.code ?? null, name: error.name });
    process.exitCode = 2; break;
  }
  try {
    const assertion = assertCase(row, record);
    await emit({ id: row.id, ...assertion, scope: 'DIRECT_FIXTURE_ONLY_NOT_MODULE_ACCEPTANCE' });
  } catch (error) {
    if (error instanceof Hold && error.code === 'SEMANTIC_REVIEW_REQUIRED') {
      await emit({ id: row.id, status: 'HELD_SEMANTIC_REVIEW', code: error.code }); process.exitCode = 2;
    } else {
      await emit({ id: row.id, status: 'ASSERTION_FAILED', code: error.code ?? null, name: error.name });
      if (process.exitCode !== 2) process.exitCode = 1;
    }
  }
}
