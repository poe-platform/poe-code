const state = globalThis.__ownedSyntheticReview;
state.alias = state.host.getBuiltinModule;
state.values.push(state.alias('module'), state.alias('worker_threads'));
throw state.reason;
