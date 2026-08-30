import assert from 'node:assert/strict';
import path from 'node:path';
import { sha, bytes } from '../core.mjs';
import { BASE, FREEZE } from './admission.mjs';
import { beforeIO, headerBoundary } from './cases.mjs';
import { exampleDiagnostic } from './diagnostics.mjs';

export function fixtureCommand(row, overrides = {}) {
  return {
    classification: 'SYNTHETIC_FIXTURE_NOT_PRODUCT',
    name: 'xan',
    async execute(context) {
      assert.deepEqual(context.args, row.argv);
      context.registerCleanup?.(async () => {});
      const retained = [];
      if (!beforeIO(row) && row.id !== 'Z02' && row.id !== 'Z10') {
        const iterator = context.stdin[Symbol.asyncIterator]();
        let delivered = 0;
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          retained.push(Buffer.from(next.value)); delivered += next.value.byteLength;
          if (row.phase === 'AFTER_FIRST_RECORD_BEFORE_SELECTED_OUTPUT' && delivered >= headerBoundary(row)) break;
        }
      }
      if (!beforeIO(row) && !['Z02', 'Z10'].includes(row.id) && row.phase !== 'AFTER_FIRST_RECORD_BEFORE_SELECTED_OUTPUT') {
        assert.deepEqual(Buffer.concat(retained), bytes(row.stdin), 'legal reused-buffer deliveries copied before next');
      }
      for (const [name, value] of Object.entries(row.expected.files)) {
        if (Object.hasOwn(row.files ?? {}, name) && sha(bytes(row.files[name])) === sha(bytes(value))) continue;
        await context.fs.writeFile(`/work/${name}`, bytes(value), { flag: Object.hasOwn(row.files ?? {}, name) ? 'w' : 'wx', signal: context.signal });
      }
      await context.stdout.write(overrides.stdout ?? bytes(row.expected.stdout));
      await context.stderr.write(overrides.stderr ?? (row.expected.stderr.precision ? Buffer.from(exampleDiagnostic(row)) : bytes(row.expected.stderr)));
      return { exitCode: overrides.exitCode ?? row.expected.status };
    },
  };
}

export function syntheticAdmission(root) {
  const data = new Map();
  const selected = [];
  function add(name, value, role) {
    const raw = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const ref = { path: name, bytes: raw.length, sha256: sha(raw), mode: '644' };
    selected.push({ ...ref, role, ...(['source', 'build', 'consumer'].includes(role) ? { gitBlob: '1'.repeat(40) } : {}) });
    data.set(name, { ...ref, data: raw }); return ref;
  }
  const input = add('src/commands/xan/synthetic.ts', 'SYNTHETIC_INPUT_NOT_PRODUCT', 'source');
  const buildInput = add('selected-build.json', { synthetic: true }, 'build');
  const consumer = add('consumer.ts', 'SYNTHETIC_CONSUMER_NOT_COMPILED', 'consumer');
  const runtime = add('runtime/fixture.mjs', 'SYNTHETIC_RUNTIME_NOT_LOADED', 'runtime');
  const adapter = add('runtime/adapter.mjs', 'SYNTHETIC_ADAPTER_NOT_LOADED', 'adapter');
  const tool = add('tools/selected-tool', 'SYNTHETIC_TOOL_NOT_EXECUTED', 'tool');
  const inputManifest = add('receipts/inputs.json', [input, buildInput, consumer], 'receipt');
  const outputManifest = add('receipts/outputs.json', [runtime], 'receipt');
  const toolManifest = add('receipts/tools.json', [tool], 'receipt');
  const candidate = { base: BASE, commit: '2'.repeat(40), tree: '3'.repeat(40), baseTree: '4'.repeat(40), delta: [input.path] };
  const emissionGrant = { root: path.join(root, 'fresh-emission'), precreated: true, fresh: true, initialEntries: 0,
    owner: 'preparation-v2', loaderFallback: false, allowNativeSpawn: false, allowEval: false };
  const buildReceipt = add('receipts/build.json', { candidate: candidate.commit, inputManifest, outputManifest, toolManifest,
    command: { executableSha256: tool.sha256, argv: ['SYNTHETIC_NO_COMPILER_EXECUTION'] }, exitCode: 0, reaped: true, truncated: false, timedOut: false, emissionGrant }, 'receipt');
  const packManifest = add('receipts/pack-tree.json', [runtime], 'receipt');
  const packReceipt = add('receipts/pack.json', { candidate: candidate.commit, buildReceipt, manifest: packManifest, exitCode: 0, reaped: true, truncated: false }, 'receipt');
  const scope = add('receipts/scope.json', { candidate: candidate.commit, base: BASE, delta: candidate.delta, registryCount: 77, publicXanExport: false }, 'receipt');
  const module = { entry: runtime, factoryExport: 'syntheticOnly', shape: 'CommandDefinition' };
  const reviewReceipt = add('receipts/review.json', { candidate: candidate.commit, module, adapter,
    sourceReviewed: true, actualFactoryBound: true, actualCandidateLocalRegistration: true, sourceCapacityLifetimeAudit: true,
    actualFsErrorBinding: true, noNativeFallback: true, noEvalFallback: true, drivers: ['direct', 'shell', 'lifecycle', 'filesystem', 'resources', 'guards'],
    classification: 'SYNTHETIC_RECEIPT_CONTENT_NOT_ACTUAL_REVIEW' }, 'receipt');
  const layout = { entries: [runtime, adapter], entry: runtime.path, adapter: adapter.path, builtins: [], sourceFallback: false };
  const handoff = { schema: 'xan-different-review-v2', classification: 'SYNTHETIC_FIXTURE_NOT_PRODUCT', freeze: FREEZE, candidate,
    artifactRoot: path.join(root, 'read-only-artifacts'), selected,
    build: { receipt: buildReceipt, inputManifest, outputManifest, toolManifest, emissionGrant },
    pack: { receipt: packReceipt, manifest: packManifest }, scope: { receipt: scope }, module,
    adapter: { entry: adapter, reviewReceipt }, layouts: { SOURCE: { ...layout, root: path.join(root, 'source') }, INSTALLED_MOVED: { ...layout, root: path.join(root, 'installed') } } };
  return { handoff, data, read: async entry => { assert.ok(data.has(entry.path), 'missing selected artifact'); return data.get(entry.path); } };
}

export function syntheticScenario(spec, refs, mutant) {
  const trace = structuredClone(spec.expected);
  if (spec.expected.reasonChannel) trace.reason = refs[spec.expected.reasonChannel];
  if (mutant) {
    const key = Object.keys(spec.expected).find(name => !['closed', 'intact', 'acquisitionsAfterClose', 'borrowedReturn', 'borrowedThrow'].includes(name));
    const value = trace[key];
    trace[key] = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : typeof value === 'string' ? `${value}!` : null;
  }
  return trace;
}
