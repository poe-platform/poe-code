import type { NodeEngineAdapter } from "../../src/commands/node/worker-types.js";

// Trusted transport fixture: exercise both directions without running guest code.
export default {
  abi: 'NP1-ENGINE-PUBLIC-SYNC-1', identity: 'optional-transport-fixture',
  async execute({ request, bridge }) {
    bridge('entry', null, null, null, null, null);
    const target = '/' + 'a'.repeat(70_000) + '.json';
    const response = JSON.parse(bridge('authorizeJson', 'json', target, 'r', null, null)!);
    if (response.kind !== 'fsError' || response.error.path !== target) throw new Error('metadata was truncated');
    bridge('delivered', 'postcopy-v1', String(response.sequence), response.kind, null, null);
    for (let index = 0; index < 140; index++) {
      const output = JSON.parse(bridge('writeOutput', 'stdout', null, null, request.source, null)!);
      bridge('delivered', 'postcopy-v1', String(output.sequence), output.kind, null, null);
    }
    bridge('cutoff', null, null, null, null, null);
    return { ok: true };
  },
} satisfies NodeEngineAdapter;
