const state = globalThis.__ownedSyntheticReview;
state.alias = state.host.getBuiltinModule;
try { state.alias('worker_threads'); } catch (error) { state.caught = error; }
export function factory() { state.factoryCalls++; }
