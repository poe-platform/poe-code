export const singleSource = `export default async fixture => {
  await boundary('before');
  const first = await fixture.input;
  const repeated = await fixture.input;
  return { value: first.value, sameHandle: first === repeated };
};
`;

export const fullSource = `export default async fixture => {
  const trace = [];
  const scan = async (values, accumulator, seed, hasSeed, emitEach, label) => {
    let hasState = hasSeed;
    let state = seed;
    const emissions = [];
    try {
      for (let index = 0; index < values.length; index++) {
        const value = values[index];
        await Promise.resolve();
        if (hasState) state = await accumulator(state, value, index);
        else { state = value; hasState = true; }
        if (emitEach) emissions.push(state);
      }
      if (!emitEach && hasState) emissions.push(state);
      return { state, emissions, hasState };
    } finally {
      trace.push(["closed", label, values.length, emitEach]);
    }
  };
  const promiseAliases = [
    fixture.primary === fixture.again,
    fixture.primary === fixture.nested.promise,
    fixture.remote === fixture.remoteAgain,
    fixture.primary !== fixture.remote
  ];
  const initial = { balance: 0, names: [] };
  let current = initial;
  const processed = [];
  const readState = () => ({ initialBalance: initial.balance, currentBalance: current.balance, processed: [...processed] });
  const emissions = [];
  const inputOutcomes = [];
  trace.push(["boundary", "both-pending"]);
  await boundary("both-pending");
  for (const key of fixture.order) {
    trace.push(["await", key]);
    const pending = key === "left" ? fixture.primary : fixture.remote;
    const alias = key === "left" ? fixture.again : fixture.remoteAgain;
    const batch = await pending;
    const sameHandle = await pending;
    batch.observedBy = key;
    const repeated = await alias;
    inputOutcomes.push({ key, status: "fulfilled", same: batch === repeated, batch: batch.name, sameHandle: batch === sameHandle, markerVisible: repeated.observedBy === key });
    trace.push(["fulfilled", key, batch.name, batch === repeated]);
    const accumulated = await scan(batch.events, async (state, event, index) => {
      const next = event.replace ? { balance: state.balance, names: [...state.names] } : state;
      await Promise.resolve();
      next.balance += event.delta;
      next.names.push(event.name + ":" + index);
      trace.push(["event", key, event.name, next.balance]);
      return next;
    }, current, true, true, key);
    current = accumulated.state;
    emissions.push(...accumulated.emissions);
    processed.push(key);
    const observed = readState();
    trace.push(["closure", key, observed.initialBalance, observed.currentBalance, observed.processed.length]);
    trace.push(["boundary", "after:" + key]);
    await boundary("after:" + key);
  }
  const numericIndexes = [];
  const numeric = await scan([3, 5, 8], async (state, value, index) => {
    numericIndexes.push(index);
    return state + value;
  }, undefined, false, false, "numeric");
  const emptySeeded = await scan([], async state => state, 19, true, false, "empty-seeded");
  const emptyUnseeded = await scan([], async state => state, undefined, false, false, "empty-unseeded");
  const emissionAliases = [];
  for (let index = 1; index < emissions.length; index++) emissionAliases.push(emissions[index - 1] === emissions[index]);
  return {
    balance: current.balance,
    names: current.names,
    promiseAliases,
    inputOutcomes,
    closure: readState(),
    emissionAliases,
    emissionBalances: emissions.map(item => item.balance),
    initialIsFirst: initial === emissions[0],
    lastIsCurrent: current === emissions[emissions.length - 1],
    numeric: numeric.emissions,
    numericIndexes,
    empty: [emptySeeded.emissions, emptyUnseeded.emissions, emptyUnseeded.hasState],
    trace
  };
};
`;
