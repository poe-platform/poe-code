import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { ROOT, OLD, NODE, durable } from './common.mjs';
import { supervise } from '../preparation-v2/supervisor.mjs';
const tools = path.join(OLD, 'work/tools'); const records = [];
for (const allowed of [false, true]) {
  const output = path.join(ROOT, 'controls-work', `nested-emission-${allowed}`); await mkdir(output);
  const fixture = path.join(ROOT, 'compiler-fixtures/nested/value.mts');
  const receipt = await supervise({ executable: NODE, args: ['--permission', '--disallow-code-generation-from-strings', `--allow-fs-read=${tools}`, `--allow-fs-read=${fixture}`, ...(allowed ? [`--allow-fs-read=${output}`] : []), `--allow-fs-write=${output}`,
    path.join(tools, 'node_modules/typescript/lib/tsc.js'), fixture, '--rootDir', path.join(ROOT, 'compiler-fixtures'), '--outDir', output, '--typeRoots', path.join(tools, 'node_modules/@types'), '--types', 'node', '--module', 'NodeNext', '--target', 'ES2023', '--skipLibCheck', '--noEmitOnError', '--pretty', 'false'],
    cwd: ROOT, directory: path.join(ROOT, 'controls-work', `nested-control-${allowed}`), timeoutMs: 60000, rawBytes: 65536, kind: 'SYNTHETIC_NESTED_EMISSION_READ_CONTROL' });
  const raw = await readFile(path.join(ROOT, 'controls-work', `nested-control-${allowed}/stdout.raw`), 'utf8');
  assert.equal(receipt.code, allowed ? 0 : 2); assert.equal(receipt.reaped, true); if (!allowed) assert.match(raw, /TS5033/);
  records.push({ allowed, receipt, raw });
}
await durable(path.join(ROOT, 'REPAIR-CONTROLS.json'), { classification: 'SYNTHETIC_COMPILER_INFRASTRUCTURE_ONLY', records, runtimeCandidateInvocations: 0 });
console.log(JSON.stringify({ controls: 2, reaped: 2, changedGrant: 'read fresh emission directory only', product: 0 }));
