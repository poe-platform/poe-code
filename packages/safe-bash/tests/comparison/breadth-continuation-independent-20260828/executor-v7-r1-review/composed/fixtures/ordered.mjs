const state = globalThis.__ownedSyntheticReview;
const alias = state.host.getBuiltinModule;
state.alias = alias;
state.values.push(alias('module'));
state.firstSlot = state.window.snapshot();
state.values.push(alias('worker_threads'));
state.secondSlot = state.window.snapshot();
export function factory() {
  state.factoryCalls++;
  return state.window.snapshot().revoked;
}
