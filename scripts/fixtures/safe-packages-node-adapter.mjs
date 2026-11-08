export default {
  abi: 'NP1-ENGINE-PUBLIC-SYNC-1', identity: 'packed-node-adapter',
  async execute({ bridge }) {
    bridge('entry', null, null, null, null, null);
    const reply = JSON.parse(bridge('writeOutput', 'stdout', null, null, 'worker\n', null));
    bridge('delivered', 'postcopy-v1', String(reply.sequence), reply.kind, null, null);
    bridge('cutoff', null, null, null, null, null);
    return { ok: true };
  },
};
