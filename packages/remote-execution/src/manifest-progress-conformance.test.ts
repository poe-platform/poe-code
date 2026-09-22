import { describe, expect, it } from 'vitest';
import { validateDependencyMaterialization, type DependencyMaterialization } from './protocol.js';

function progress(): DependencyMaterialization {
  return {
    operationId: 'preparation', manifestId: 'identified-dependencies', manifestRevision: 'manifest-1',
    directoryRevision: 'directory-1', state: 'ready',
    entries: [{ index: 0, state: 'applied', revision: 'entry-1' }],
    callbackGrantIds: ['revalidate-input', 'live-title'],
  };
}

describe.each([
  { name: 'direct SDK', transport: (value: DependencyMaterialization): unknown => value },
  { name: 'REST JSON', transport: (value: DependencyMaterialization): unknown => JSON.parse(JSON.stringify(value)) },
])('$name preparation observations without a parser or CLI', ({ transport }) => {
  it('preserves ready revision and mutable-source callbacks as separate observations', () => {
    const value = transport(progress());
    const before = JSON.stringify(value);
    validateDependencyMaterialization(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(value.callbackGrantIds).toEqual(['revalidate-input', 'live-title']);
    expect(value.directoryRevision).toBe('directory-1');
  });

  it.each(['missing-blob', 'wrong-length', 'wrong-hash', 'stale-revision'] as const)(
    'retains the distinct %s failure and pending entry', error => {
      const value = transport({ ...progress(), state: 'failed', directoryRevision: null, error,
        entries: [{ index: 0, state: 'failed', revision: null, error },
          { index: 1, state: 'pending', revision: null }] });
      validateDependencyMaterialization(value);
      expect(value.error).toBe(error);
      expect(value.entries[1].state).toBe('pending');
    },
  );

  it.each(['partial', 'unknown'] as const)('preserves applied progress in a %s tree', state => {
    const value = transport({ ...progress(), state,
      entries: [...progress().entries, { index: 1, state: state === 'partial' ? 'failed' : 'unknown', revision: null }] });
    validateDependencyMaterialization(value);
    expect(value.state).toBe(state);
    expect(value.entries[0]).toEqual({ index: 0, state: 'applied', revision: 'entry-1' });
  });

  it.each(['pending', 'failed', 'unknown'] as const)('refuses ready with a %s required entry', state => {
    const value = { ...progress(), entries: [{ index: 0, state, revision: null }] };
    expect(() => validateDependencyMaterialization(transport(value))).toThrow(TypeError);
  });

  it('refuses missing readiness receipts, repeated callbacks and inconsistent entry indices', () => {
    for (const value of [
      { ...progress(), directoryRevision: null },
      { ...progress(), error: 'wrong-hash' as const },
      { ...progress(), entries: [{ index: 0, state: 'applied' as const, revision: null }] },
      { ...progress(), entries: [{ index: 1, state: 'applied' as const, revision: 'entry-1' }] },
      { ...progress(), callbackGrantIds: ['live-title', 'live-title'] },
    ]) expect(() => validateDependencyMaterialization(transport(value))).toThrow(TypeError);
  });
});
