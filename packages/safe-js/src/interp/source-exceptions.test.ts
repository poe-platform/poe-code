import { describe, expect, it } from "vitest";

import { run } from "../run.js";
import { Budget } from "./budget.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

const workflows = [
  [
    "01-waterfall-identity",
    `const trace = [];
const shared = { name: "ledger", entries: [], total: 0 };
const marker = { kind: "expected-stop" };
const advance = (amount) => {
  shared.total += amount;
  return shared;
};
const waterfall = async (tasks, initial) => {
  let values = initial;
  for (let index = 0; index < tasks.length; index++) {
    trace.push(["stage", index]);
    values = await tasks[index](...values);
  }
  return values;
};
const stages = [
  async (ledger, update) => {
    await tick("waterfall:load");
    ledger.entries.push(2);
    const pending = Promise.resolve(ledger);
    const resolved = await pending;
    return [resolved, update, resolved === ledger];
  },
  async (ledger, update, firstIdentity) => {
    const tuple = await Promise.all([Promise.resolve(ledger), Promise.resolve(update)]);
    tuple[1](3);
    const returned = await (async () => tuple[0])();
    trace.push(["identity", firstIdentity, tuple[0] === ledger, tuple[1] === update, returned === shared]);
    return [returned, tuple[1]];
  },
  async (ledger, update) => {
    await tick("waterfall:commit");
    ledger.entries.push(5);
    return [await Promise.resolve(ledger), await Promise.resolve(update)];
  },
  async (ledger, update) => [ledger === shared, update === advance, update(7) === ledger]
];
const success = await waterfall(stages, [shared, advance]);
let caughtIdentity = false;
try {
  await waterfall([
    async (ledger) => [await Promise.resolve(ledger)],
    async (ledger) => {
      await tick("waterfall:fail");
      ledger.entries.push(11);
      throw marker;
    },
    async () => { trace.push(["unreachable"]); return []; }
  ], [shared]);
} catch (error) {
  caughtIdentity = error === marker;
} finally {
  trace.push(["closed", shared.total]);
}
return { success, caughtIdentity, shared, trace };
`
  ],
  [
    "02-auto-dependency-closures",
    `const trace = [];
const origin = { name: "catalog", revision: 1 };
const tasks = {
  seed: { deps: [], run: async () => { await tick("seed"); return origin; } },
  weights: { deps: [], run: async () => { await tick("weights:a"); await tick("weights:b"); return [2, 3, 5]; } },
  left: { deps: ["seed"], run: async (results) => {
    const captured = results.seed;
    await tick("left");
    return { owner: captured, read: () => captured.revision + 10 };
  } },
  right: { deps: ["seed", "weights"], run: async (results) => {
    const weights = results.weights;
    const captured = results.seed;
    await tick("right");
    return { owner: captured, read: () => weights.reduce((total, value) => total + value, captured.revision) };
  } },
  combine: { deps: ["left", "right"], run: async (results) => {
    const readers = await Promise.all([results.left.read, results.right.read]);
    results.seed.revision += 2;
    return { identity: results.left.owner === results.right.owner, values: readers.map((read) => read()) };
  } },
  labels: { deps: ["weights"], run: async (results) => {
    await tick("labels");
    return results.weights.map((value, index) => () => value + index);
  } },
  summary: { deps: ["combine", "labels"], run: async (results) => {
    await tick("summary");
    return { ...results.combine, labels: results.labels.map((read) => read()), owner: results.seed === origin };
  } }
};
const auto = async (definitions, concurrency) => {
  const names = Object.keys(definitions);
  const results = {};
  const started = [];
  let pending = [];
  let peak = 0;
  for (let pass = 0; pass < names.length; pass++) {
    for (const name of names) {
      if (pending.length >= concurrency) break;
      if (started.includes(name)) continue;
      if (!definitions[name].deps.every((dependency) => Object.hasOwn(results, dependency))) continue;
      started.push(name);
      trace.push(["start", name]);
      const promise = (async () => ({ name, value: await definitions[name].run(results) }))();
      pending.push({ name, promise });
      peak = Math.max(peak, pending.length);
    }
    if (pending.length === 0) break;
    const completed = await Promise.race(pending.map((entry) => entry.promise));
    results[completed.name] = completed.value;
    trace.push(["done", completed.name]);
    pending = pending.filter((entry) => entry.name !== completed.name);
  }
  return { summary: results.summary, finished: Object.keys(results).length, peak };
};
return { result: await auto(tasks, 2), origin, trace };
`
  ],
  [
    "03-maplimit-lexical-state",
    `const trace = [];
const source = [2, 3, 5, 7, 11, 13];
const session = { completed: 0 };
const mapLimit = async (items, limit, mapper) => {
  let cursor = 0;
  const results = [];
  const workers = [];
  for (let workerId = 0; workerId < limit; workerId++) {
    workers.push((async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index], index, workerId);
      }
    })());
  }
  await Promise.all(workers);
  return results;
};
const mapped = await mapLimit(source, 3, async (value, index, workerId) => {
  let subtotal = value;
  const local = { index, workerId };
  const readers = [];
  for (let offset = 0; offset < 3; offset++) {
    readers.push(() => [index, offset, subtotal, local.workerId]);
    await tick("map:" + index + ":" + offset);
    subtotal += index + offset;
  }
  const update = (amount) => { subtotal += amount; return local; };
  const returned = await Promise.resolve({ readers, update, local, session });
  session.completed++;
  trace.push(["finish", index, workerId]);
  return returned;
});
const checks = await Promise.all(mapped.map(async (entry, index) => {
  await tick("verify:" + index);
  const savedUpdate = entry.update;
  const savedLocal = entry.local;
  const sameLocal = entry.update(100 + index) === savedLocal;
  await Promise.resolve();
  return {
    sameLocal,
    sameFunction: await Promise.resolve(savedUpdate) === entry.update,
    sameSession: entry.session === session,
    readers: entry.readers.map((read) => read())
  };
}));
return { checks, completed: session.completed, trace };
`
  ],
  [
    "04-nested-finally-precedence",
    `const trace = [];
const bodyError = { kind: "body" };
const innerError = { kind: "inner-cleanup" };
const outerError = { kind: "outer-cleanup" };
const chainError = { kind: "promise-finally" };
const bodyValue = { kind: "body-value" };
const overrideValue = { kind: "outer-value" };
const execute = async (policy) => {
  try {
    try {
      await tick(policy.name + ":body");
      if (policy.bodyFails) throw bodyError;
      return bodyValue;
    } finally {
      trace.push([policy.name, "inner-enter"]);
      await tick(policy.name + ":inner");
      if (policy.innerFails) throw innerError;
      trace.push([policy.name, "inner-exit"]);
    }
  } finally {
    trace.push([policy.name, "outer-enter"]);
    try {
      await tick(policy.name + ":outer");
      if (policy.outerFails) throw outerError;
      if (policy.outerReturns) return overrideValue;
    } finally {
      await Promise.resolve();
      trace.push([policy.name, "outer-exit"]);
    }
  }
};
const policies = [
  { name: "success" },
  { name: "body", bodyFails: true },
  { name: "inner", bodyFails: true, innerFails: true },
  { name: "outer", bodyFails: true, innerFails: true, outerFails: true },
  { name: "override", bodyFails: true, innerFails: true, outerReturns: true },
  { name: "chain", bodyFails: true, chainFails: true }
];
const results = await Promise.all(policies.map(async (policy) => {
  try {
    const value = await execute(policy).finally(async () => {
      await tick(policy.name + ":promise-finally");
      trace.push([policy.name, "promise-finally"]);
      if (policy.chainFails) throw chainError;
      return { ignored: true };
    });
    return { name: policy.name, value: value.kind, original: value === bodyValue, overridden: value === overrideValue };
  } catch (error) {
    return { name: policy.name, error: error.kind, body: error === bodyError, inner: error === innerError, outer: error === outerError, chain: error === chainError };
  }
}));
return { results, trace };
`
  ],
  [
    "05-saga-delegation-cleanup",
    `const trace = [];
const problem = { kind: "effect-failed" };
const evaluate = async (effect) => {
  if (effect.type === "all") return Promise.all(effect.effects.map(evaluate));
  await tick(effect.name);
  if (effect.type === "fail") throw problem;
  return effect.value;
};
function* leaf(label, failing) {
  try {
    const initial = yield { type: "call", name: label + ":initial", value: 2 };
    const pair = yield { type: "all", effects: [
      { type: "call", name: label + ":left", value: initial + 3 },
      { type: failing ? "fail" : "call", name: label + ":right", value: initial + 5 }
    ] };
    return pair[0] + pair[1];
  } catch (error) {
    trace.push([label, "caught", error === problem]);
    const recovered = yield { type: "call", name: label + ":recover", value: 17 };
    return recovered;
  } finally {
    trace.push([label, "leaf-enter"]);
    yield { type: "call", name: label + ":leaf-close", value: null };
    trace.push([label, "leaf-exit"]);
  }
}
function* branch(label, failing) {
  try {
    const value = yield* leaf(label, failing);
    trace.push([label, "branch-result", value]);
    return { label, value };
  } finally {
    trace.push([label, "branch-enter"]);
    yield { type: "call", name: label + ":branch-close", value: null };
    trace.push([label, "branch-exit"]);
  }
}
const drive = async (label, failing, cancelAfter) => {
  const iterator = branch(label, failing);
  let method = "next";
  let input;
  let effects = 0;
  for (let step = 0; step < 24; step++) {
    const record = iterator[method](input);
    if (record.done) return { result: record.value, effects };
    try {
      input = await evaluate(record.value);
      effects++;
      if (effects === cancelAfter) {
        method = "return";
        input = "cancelled";
      } else method = "next";
    } catch (error) {
      method = "throw";
      input = error;
    }
  }
  throw Error("fixture driver exhausted");
};
const results = [];
results.push(await drive("normal", false, -1));
results.push(await drive("recover", true, -1));
results.push(await drive("cancel", false, 1));
return { results, trace };
`
  ],
  [
    "06-scan-reduce-state",
    `const trace = [];
const scan = async (values, accumulator, seed, hasSeed, emitEach) => {
  let hasState = hasSeed;
  let state = seed;
  const emissions = [];
  try {
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      await tick("scan:" + index);
      if (hasState) state = await accumulator(state, value, index);
      else { state = value; hasState = true; }
      if (emitEach) emissions.push(state);
    }
    if (!emitEach && hasState) emissions.push(state);
    return { state, emissions, hasState };
  } finally {
    trace.push(["closed", values.length, emitEach]);
  }
};
const initial = { balance: 0, names: [] };
const beforeReplacement = initial;
const events = [
  { name: "open", delta: 3 },
  { name: "credit", delta: 5 },
  { name: "replace", delta: -2, replace: true },
  { name: "settle", delta: 7 }
];
const accumulated = await scan(events, async (state, event, index) => {
  const next = event.replace ? { balance: state.balance, names: [...state.names] } : state;
  await Promise.resolve();
  next.balance += event.delta;
  next.names.push(event.name + ":" + index);
  return next;
}, initial, true, true);
const numericIndexes = [];
const numeric = await scan([3, 5, 8], async (state, value, index) => {
  numericIndexes.push(index);
  return state + value;
}, undefined, false, false);
const emptySeeded = await scan([], async (state) => state, 19, true, false);
const emptyUnseeded = await scan([], async (state) => state, undefined, false, false);
const marker = { kind: "reduce-stop" };
let caughtIdentity = false;
try {
  await scan([2, 4, 6], async (state, value) => {
    if (value === 4) throw marker;
    return state + value;
  }, 0, true, false);
} catch (error) { caughtIdentity = error === marker; }
return {
  balance: accumulated.state.balance,
  names: accumulated.state.names,
  initialBalance: beforeReplacement.balance,
  aliases: [accumulated.emissions[0] === accumulated.emissions[1], accumulated.emissions[1] === accumulated.emissions[2], accumulated.emissions[2] === accumulated.emissions[3], accumulated.state === accumulated.emissions[3]],
  numeric: numeric.emissions,
  numericIndexes,
  empty: [emptySeeded.emissions, emptyUnseeded.emissions, emptyUnseeded.hasState],
  caughtIdentity,
  trace
};
`
  ],
  [
    "07-forkjoin-last-values",
    `const trace = [];
const shared = { id: "shared-last", value: 23 };
const failure = { kind: "stream-error" };
const forkJoin = async (streams) => {
  const last = [];
  const hasValue = [];
  const outcomes = await Promise.allSettled(streams.map(async (stream, index) => {
    hasValue[index] = false;
    try {
      for (const value of stream.values) {
        await tick(stream.name);
        last[index] = await Promise.resolve(value);
        hasValue[index] = true;
        trace.push([stream.name, "next"]);
      }
      if (stream.fail) throw failure;
    } finally {
      await Promise.resolve();
      trace.push([stream.name, "complete"]);
    }
  }));
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  if (rejected) throw rejected.reason;
  if (!hasValue.every((value) => value)) return { emitted: false, values: [] };
  return { emitted: streams.length > 0, values: last };
};
const successful = await forkJoin([
  { name: "first", values: [{ value: 2 }, shared] },
  { name: "second", values: [shared] },
  { name: "third", values: [3, 5, 7] }
]);
const empty = await forkJoin([
  { name: "empty", values: [] },
  { name: "drained", values: [11, 13] }
]);
let rejectedIdentity = false;
try {
  await forkJoin([
    { name: "failing", values: [17], fail: true },
    { name: "joined", values: [19, 29] }
  ]);
} catch (error) { rejectedIdentity = error === failure; }
return {
  success: { emitted: successful.emitted, values: successful.values, alias: successful.values[0] === successful.values[1], original: successful.values[0] === shared },
  empty,
  noStreams: await forkJoin([]),
  rejectedIdentity,
  trace
};
`
  ],
  [
    "08-plain-thenable-combinators",
    `const trace = [];
const shared = { kind: "selected", score: 31 };
const firstReason = { kind: "first-rejection" };
const secondReason = { kind: "second-rejection" };
const thenable = (name, turns, value, rejects) => ({
  name,
  then(resolve, reject) {
    trace.push(["assimilate", this.name]);
    const complete = async () => {
      for (let turn = 0; turn < turns; turn++) await Promise.resolve();
      trace.push(["settle", name]);
      if (rejects) reject(value);
      else resolve(value);
    };
    complete();
  }
});
const source = [
  thenable("slow", 3, shared, false),
  thenable("fast", 0, shared, false),
  thenable("rejected", 1, firstReason, true)
];
const promises = source.map((value) => Promise.resolve(value));
const settledPromise = Promise.allSettled(promises);
const racePromise = Promise.race(promises);
const anyPromise = Promise.any(promises);
trace.push(["caller"]);
const raceWinner = await racePromise;
const anyWinner = await anyPromise;
const settled = await settledPromise;
const pair = await Promise.all([promises[0], promises[1]]);
let rejectionIdentity = false;
try {
  await Promise.all([Promise.resolve(shared), thenable("all-error", 0, secondReason, true)]);
} catch (error) { rejectionIdentity = error === secondReason; }
let aggregate;
try {
  await Promise.any([
    thenable("any-first", 2, firstReason, true),
    thenable("any-second", 0, secondReason, true)
  ]);
} catch (error) {
  aggregate = { name: error.name, count: error.errors.length, first: error.errors[0] === firstReason, second: error.errors[1] === secondReason };
}
return {
  winnerIdentity: [raceWinner === shared, anyWinner === shared, pair[0] === pair[1]],
  settled: settled.map((entry) => entry.status === "fulfilled" ? [entry.status, entry.value === shared] : [entry.status, entry.reason === firstReason]),
  rejectionIdentity,
  aggregate,
  empty: [await Promise.all([]), await Promise.allSettled([])],
  trace
};
`
  ],
  [
    "09-rejection-identity-matrix",
    `const marker = { kind: "marker" };
const rows = [];
try { throw marker; } catch (error) { rows.push(["direct-throw", error === marker]); }
const synchronous = () => { throw marker; };
try { synchronous(); } catch (error) { rows.push(["function-throw", error === marker]); }
try { await Promise.reject(marker); } catch (error) { rows.push(["await-reject", error === marker]); }
try { await (async () => { throw marker; })(); } catch (error) { rows.push(["async-immediate", error === marker]); }
try { await (async () => { await Promise.resolve(); throw marker; })(); } catch (error) { rows.push(["async-delayed", error === marker]); }
try { await { then(resolve, reject) { reject(marker); } }; } catch (error) { rows.push(["await-thenable", error === marker]); }
rows.push(["promise-catch", await Promise.reject(marker).catch((error) => error === marker)]);
const settled = await Promise.allSettled([Promise.reject(marker)]);
rows.push(["allSettled-reason", settled[0].reason === marker]);
const returnedReason = await Promise.reject(marker).catch((error) => error);
rows.push(["catch-return-value", returnedReason === marker]);
const arrayReason = ["marker"];
try { await Promise.reject(arrayReason); } catch (error) { rows.push(["array-rejection", error === arrayReason]); }
const typedError = Error("typed-marker");
try { await Promise.reject(typedError); } catch (error) { rows.push(["error-rejection", error === typedError]); }
return rows;
`
  ],
  [
    "10-recovery-annotation",
    `const reason = { attempt: 0, annotations: [] };
let caught;
try {
  await Promise.reject(reason);
} catch (error) {
  caught = error;
  error.attempt++;
  error.annotations.push("recovered");
}
return {
  sameReason: caught === reason,
  sameAnnotations: caught.annotations === reason.annotations,
  original: reason,
  caught,
  nextAttempt: reason.attempt + 1
};
`
  ],
  [
    "11-waterfall-error-instance",
    `const trace = [];
const shared = { name: "ledger", entries: [], total: 0 };
const marker = Error("expected-stop");
const advance = (amount) => {
  shared.total += amount;
  return shared;
};
const waterfall = async (tasks, initial) => {
  let values = initial;
  for (let index = 0; index < tasks.length; index++) {
    trace.push(["stage", index]);
    values = await tasks[index](...values);
  }
  return values;
};
const stages = [
  async (ledger, update) => {
    await tick("waterfall:load");
    ledger.entries.push(2);
    const pending = Promise.resolve(ledger);
    const resolved = await pending;
    return [resolved, update, resolved === ledger];
  },
  async (ledger, update, firstIdentity) => {
    const tuple = await Promise.all([Promise.resolve(ledger), Promise.resolve(update)]);
    tuple[1](3);
    const returned = await (async () => tuple[0])();
    trace.push(["identity", firstIdentity, tuple[0] === ledger, tuple[1] === update, returned === shared]);
    return [returned, tuple[1]];
  },
  async (ledger, update) => {
    await tick("waterfall:commit");
    ledger.entries.push(5);
    return [await Promise.resolve(ledger), await Promise.resolve(update)];
  },
  async (ledger, update) => [ledger === shared, update === advance, update(7) === ledger]
];
const success = await waterfall(stages, [shared, advance]);
let caughtIdentity = false;
try {
  await waterfall([
    async (ledger) => [await Promise.resolve(ledger)],
    async (ledger) => {
      await tick("waterfall:fail");
      ledger.entries.push(11);
      throw marker;
    },
    async () => { trace.push(["unreachable"]); return []; }
  ], [shared]);
} catch (error) {
  caughtIdentity = error === marker;
} finally {
  trace.push(["closed", shared.total]);
}
return { success, caughtIdentity, shared, trace };
`
  ],
  [
    "12-finally-domain-records",
    `const trace = [];
const bodyError = { name: "DomainFailure", message: "body", kind: "body", retryable: true };
const innerError = { name: "DomainFailure", message: "inner-cleanup", kind: "inner-cleanup", retryable: true };
const outerError = { name: "DomainFailure", message: "outer-cleanup", kind: "outer-cleanup", retryable: true };
const chainError = { name: "DomainFailure", message: "promise-finally", kind: "promise-finally", retryable: true };
const bodyValue = { kind: "body-value" };
const overrideValue = { kind: "outer-value" };
const execute = async (policy) => {
  try {
    try {
      await tick(policy.name + ":body");
      if (policy.bodyFails) throw bodyError;
      return bodyValue;
    } finally {
      trace.push([policy.name, "inner-enter"]);
      await tick(policy.name + ":inner");
      if (policy.innerFails) throw innerError;
      trace.push([policy.name, "inner-exit"]);
    }
  } finally {
    trace.push([policy.name, "outer-enter"]);
    try {
      await tick(policy.name + ":outer");
      if (policy.outerFails) throw outerError;
      if (policy.outerReturns) return overrideValue;
    } finally {
      await Promise.resolve();
      trace.push([policy.name, "outer-exit"]);
    }
  }
};
const policies = [
  { name: "success" },
  { name: "body", bodyFails: true },
  { name: "inner", bodyFails: true, innerFails: true },
  { name: "outer", bodyFails: true, innerFails: true, outerFails: true },
  { name: "override", bodyFails: true, innerFails: true, outerReturns: true },
  { name: "chain", bodyFails: true, chainFails: true }
];
const results = await Promise.all(policies.map(async (policy) => {
  try {
    const value = await execute(policy).finally(async () => {
      await tick(policy.name + ":promise-finally");
      trace.push([policy.name, "promise-finally"]);
      if (policy.chainFails) throw chainError;
      return { ignored: true };
    });
    return { name: policy.name, value: value.kind, original: value === bodyValue, overridden: value === overrideValue };
  } catch (error) {
    return { name: policy.name, error: error.kind, body: error === bodyError, inner: error === innerError, outer: error === outerError, chain: error === chainError };
  }
}));
return { results, trace };
`
  ],
  [
    "13-domain-error-metadata",
    `const record = { name: "DomainFailure", message: "try again", code: "RETRY", retryable: true, context: { job: "alpha" } };
const allocated = Error("try again");
allocated.code = "RETRY";
allocated.retryable = true;
allocated.context = { job: "alpha" };
const inspect = async (value) => {
  try {
    await Promise.reject(value);
  } catch (error) {
    return {
      same: error === value,
      name: error.name,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      context: error.context,
      contextSame: error.context === value.context
    };
  }
};
const returned = await Promise.reject(record).catch((error) => error);
return { plain: await inspect(record), allocated: await inspect(allocated), catchContinuationSame: returned === record };
`
  ]
] as const;

describe("source exception propagation", () => {
  it.each(workflows)("preserves the complete %s workflow", async (_name, source) => {
    const expectedCalls: string[] = [];
    const expected = await new AsyncFunction("tick", source)(async (label: string) => {
      expectedCalls.push(label);
      await Promise.resolve();
    });
    const actualCalls: string[] = [];
    const actual = await run(source, {
      bindings: {
        tick: async (label: unknown) => {
          actualCalls.push(String(label));
          await Promise.resolve();
        }
      },
      budget: new Budget({ maxSteps: 150000, maxCallDepth: 100 }),
      randomSeed: 827
    });

    expect(actualCalls).toEqual(expectedCalls);
    expect(actual.ok).toBe(true);
    if (actual.ok) expect(actual.returnValue).toEqual(expected);
  });
});
