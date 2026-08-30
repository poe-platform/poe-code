import { describe, expect, it } from "vitest";

import { dump, dumpCurrent } from "../dump.js";
import { hostErrorData } from "../error/shape.js";
import { hashSource } from "../parse/hash.js";
import { restore } from "../restore.js";
import { run } from "../run.js";
import { DUMP_FORMAT_VERSION, EXECUTION_SEMANTICS } from "../snapshot/dump-format.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

const originalWorkflows = [
  {
    id: "01-waterfall-identity",
    source:
      'const trace = [];\nconst shared = { name: "ledger", entries: [], total: 0 };\nconst marker = { kind: "expected-stop" };\nconst advance = (amount) => {\n  shared.total += amount;\n  return shared;\n};\nconst waterfall = async (tasks, initial) => {\n  let values = initial;\n  for (let index = 0; index < tasks.length; index++) {\n    trace.push(["stage", index]);\n    values = await tasks[index](...values);\n  }\n  return values;\n};\nconst stages = [\n  async (ledger, update) => {\n    await tick("waterfall:load");\n    ledger.entries.push(2);\n    const pending = Promise.resolve(ledger);\n    const resolved = await pending;\n    return [resolved, update, resolved === ledger];\n  },\n  async (ledger, update, firstIdentity) => {\n    const tuple = await Promise.all([Promise.resolve(ledger), Promise.resolve(update)]);\n    tuple[1](3);\n    const returned = await (async () => tuple[0])();\n    trace.push(["identity", firstIdentity, tuple[0] === ledger, tuple[1] === update, returned === shared]);\n    return [returned, tuple[1]];\n  },\n  async (ledger, update) => {\n    await tick("waterfall:commit");\n    ledger.entries.push(5);\n    return [await Promise.resolve(ledger), await Promise.resolve(update)];\n  },\n  async (ledger, update) => [ledger === shared, update === advance, update(7) === ledger]\n];\nconst success = await waterfall(stages, [shared, advance]);\nlet caughtIdentity = false;\ntry {\n  await waterfall([\n    async (ledger) => [await Promise.resolve(ledger)],\n    async (ledger) => {\n      await tick("waterfall:fail");\n      ledger.entries.push(11);\n      throw marker;\n    },\n    async () => { trace.push(["unreachable"]); return []; }\n  ], [shared]);\n} catch (error) {\n  caughtIdentity = error === marker;\n} finally {\n  trace.push(["closed", shared.total]);\n}\nreturn { success, caughtIdentity, shared, trace };\n'
  },
  {
    id: "02-auto-dependency-closures",
    source:
      'const trace = [];\nconst origin = { name: "catalog", revision: 1 };\nconst tasks = {\n  seed: { deps: [], run: async () => { await tick("seed"); return origin; } },\n  weights: { deps: [], run: async () => { await tick("weights:a"); await tick("weights:b"); return [2, 3, 5]; } },\n  left: { deps: ["seed"], run: async (results) => {\n    const captured = results.seed;\n    await tick("left");\n    return { owner: captured, read: () => captured.revision + 10 };\n  } },\n  right: { deps: ["seed", "weights"], run: async (results) => {\n    const weights = results.weights;\n    const captured = results.seed;\n    await tick("right");\n    return { owner: captured, read: () => weights.reduce((total, value) => total + value, captured.revision) };\n  } },\n  combine: { deps: ["left", "right"], run: async (results) => {\n    const readers = await Promise.all([results.left.read, results.right.read]);\n    results.seed.revision += 2;\n    return { identity: results.left.owner === results.right.owner, values: readers.map((read) => read()) };\n  } },\n  labels: { deps: ["weights"], run: async (results) => {\n    await tick("labels");\n    return results.weights.map((value, index) => () => value + index);\n  } },\n  summary: { deps: ["combine", "labels"], run: async (results) => {\n    await tick("summary");\n    return { ...results.combine, labels: results.labels.map((read) => read()), owner: results.seed === origin };\n  } }\n};\nconst auto = async (definitions, concurrency) => {\n  const names = Object.keys(definitions);\n  const results = {};\n  const started = [];\n  let pending = [];\n  let peak = 0;\n  for (let pass = 0; pass < names.length; pass++) {\n    for (const name of names) {\n      if (pending.length >= concurrency) break;\n      if (started.includes(name)) continue;\n      if (!definitions[name].deps.every((dependency) => Object.hasOwn(results, dependency))) continue;\n      started.push(name);\n      trace.push(["start", name]);\n      const promise = (async () => ({ name, value: await definitions[name].run(results) }))();\n      pending.push({ name, promise });\n      peak = Math.max(peak, pending.length);\n    }\n    if (pending.length === 0) break;\n    const completed = await Promise.race(pending.map((entry) => entry.promise));\n    results[completed.name] = completed.value;\n    trace.push(["done", completed.name]);\n    pending = pending.filter((entry) => entry.name !== completed.name);\n  }\n  return { summary: results.summary, finished: Object.keys(results).length, peak };\n};\nreturn { result: await auto(tasks, 2), origin, trace };\n'
  },
  {
    id: "03-maplimit-lexical-state",
    source:
      'const trace = [];\nconst source = [2, 3, 5, 7, 11, 13];\nconst session = { completed: 0 };\nconst mapLimit = async (items, limit, mapper) => {\n  let cursor = 0;\n  const results = [];\n  const workers = [];\n  for (let workerId = 0; workerId < limit; workerId++) {\n    workers.push((async () => {\n      while (cursor < items.length) {\n        const index = cursor++;\n        results[index] = await mapper(items[index], index, workerId);\n      }\n    })());\n  }\n  await Promise.all(workers);\n  return results;\n};\nconst mapped = await mapLimit(source, 3, async (value, index, workerId) => {\n  let subtotal = value;\n  const local = { index, workerId };\n  const readers = [];\n  for (let offset = 0; offset < 3; offset++) {\n    readers.push(() => [index, offset, subtotal, local.workerId]);\n    await tick("map:" + index + ":" + offset);\n    subtotal += index + offset;\n  }\n  const update = (amount) => { subtotal += amount; return local; };\n  const returned = await Promise.resolve({ readers, update, local, session });\n  session.completed++;\n  trace.push(["finish", index, workerId]);\n  return returned;\n});\nconst checks = await Promise.all(mapped.map(async (entry, index) => {\n  await tick("verify:" + index);\n  const savedUpdate = entry.update;\n  const savedLocal = entry.local;\n  const sameLocal = entry.update(100 + index) === savedLocal;\n  await Promise.resolve();\n  return {\n    sameLocal,\n    sameFunction: await Promise.resolve(savedUpdate) === entry.update,\n    sameSession: entry.session === session,\n    readers: entry.readers.map((read) => read())\n  };\n}));\nreturn { checks, completed: session.completed, trace };\n'
  },
  {
    id: "04-nested-finally-precedence",
    source:
      'const trace = [];\nconst bodyError = { kind: "body" };\nconst innerError = { kind: "inner-cleanup" };\nconst outerError = { kind: "outer-cleanup" };\nconst chainError = { kind: "promise-finally" };\nconst bodyValue = { kind: "body-value" };\nconst overrideValue = { kind: "outer-value" };\nconst execute = async (policy) => {\n  try {\n    try {\n      await tick(policy.name + ":body");\n      if (policy.bodyFails) throw bodyError;\n      return bodyValue;\n    } finally {\n      trace.push([policy.name, "inner-enter"]);\n      await tick(policy.name + ":inner");\n      if (policy.innerFails) throw innerError;\n      trace.push([policy.name, "inner-exit"]);\n    }\n  } finally {\n    trace.push([policy.name, "outer-enter"]);\n    try {\n      await tick(policy.name + ":outer");\n      if (policy.outerFails) throw outerError;\n      if (policy.outerReturns) return overrideValue;\n    } finally {\n      await Promise.resolve();\n      trace.push([policy.name, "outer-exit"]);\n    }\n  }\n};\nconst policies = [\n  { name: "success" },\n  { name: "body", bodyFails: true },\n  { name: "inner", bodyFails: true, innerFails: true },\n  { name: "outer", bodyFails: true, innerFails: true, outerFails: true },\n  { name: "override", bodyFails: true, innerFails: true, outerReturns: true },\n  { name: "chain", bodyFails: true, chainFails: true }\n];\nconst results = await Promise.all(policies.map(async (policy) => {\n  try {\n    const value = await execute(policy).finally(async () => {\n      await tick(policy.name + ":promise-finally");\n      trace.push([policy.name, "promise-finally"]);\n      if (policy.chainFails) throw chainError;\n      return { ignored: true };\n    });\n    return { name: policy.name, value: value.kind, original: value === bodyValue, overridden: value === overrideValue };\n  } catch (error) {\n    return { name: policy.name, error: error.kind, body: error === bodyError, inner: error === innerError, outer: error === outerError, chain: error === chainError };\n  }\n}));\nreturn { results, trace };\n'
  },
  {
    id: "05-saga-delegation-cleanup",
    source:
      'const trace = [];\nconst problem = { kind: "effect-failed" };\nconst evaluate = async (effect) => {\n  if (effect.type === "all") return Promise.all(effect.effects.map(evaluate));\n  await tick(effect.name);\n  if (effect.type === "fail") throw problem;\n  return effect.value;\n};\nfunction* leaf(label, failing) {\n  try {\n    const initial = yield { type: "call", name: label + ":initial", value: 2 };\n    const pair = yield { type: "all", effects: [\n      { type: "call", name: label + ":left", value: initial + 3 },\n      { type: failing ? "fail" : "call", name: label + ":right", value: initial + 5 }\n    ] };\n    return pair[0] + pair[1];\n  } catch (error) {\n    trace.push([label, "caught", error === problem]);\n    const recovered = yield { type: "call", name: label + ":recover", value: 17 };\n    return recovered;\n  } finally {\n    trace.push([label, "leaf-enter"]);\n    yield { type: "call", name: label + ":leaf-close", value: null };\n    trace.push([label, "leaf-exit"]);\n  }\n}\nfunction* branch(label, failing) {\n  try {\n    const value = yield* leaf(label, failing);\n    trace.push([label, "branch-result", value]);\n    return { label, value };\n  } finally {\n    trace.push([label, "branch-enter"]);\n    yield { type: "call", name: label + ":branch-close", value: null };\n    trace.push([label, "branch-exit"]);\n  }\n}\nconst drive = async (label, failing, cancelAfter) => {\n  const iterator = branch(label, failing);\n  let method = "next";\n  let input;\n  let effects = 0;\n  for (let step = 0; step < 24; step++) {\n    const record = iterator[method](input);\n    if (record.done) return { result: record.value, effects };\n    try {\n      input = await evaluate(record.value);\n      effects++;\n      if (effects === cancelAfter) {\n        method = "return";\n        input = "cancelled";\n      } else method = "next";\n    } catch (error) {\n      method = "throw";\n      input = error;\n    }\n  }\n  throw Error("fixture driver exhausted");\n};\nconst results = [];\nresults.push(await drive("normal", false, -1));\nresults.push(await drive("recover", true, -1));\nresults.push(await drive("cancel", false, 1));\nreturn { results, trace };\n'
  },
  {
    id: "06-scan-reduce-state",
    source:
      'const trace = [];\nconst scan = async (values, accumulator, seed, hasSeed, emitEach) => {\n  let hasState = hasSeed;\n  let state = seed;\n  const emissions = [];\n  try {\n    for (let index = 0; index < values.length; index++) {\n      const value = values[index];\n      await tick("scan:" + index);\n      if (hasState) state = await accumulator(state, value, index);\n      else { state = value; hasState = true; }\n      if (emitEach) emissions.push(state);\n    }\n    if (!emitEach && hasState) emissions.push(state);\n    return { state, emissions, hasState };\n  } finally {\n    trace.push(["closed", values.length, emitEach]);\n  }\n};\nconst initial = { balance: 0, names: [] };\nconst beforeReplacement = initial;\nconst events = [\n  { name: "open", delta: 3 },\n  { name: "credit", delta: 5 },\n  { name: "replace", delta: -2, replace: true },\n  { name: "settle", delta: 7 }\n];\nconst accumulated = await scan(events, async (state, event, index) => {\n  const next = event.replace ? { balance: state.balance, names: [...state.names] } : state;\n  await Promise.resolve();\n  next.balance += event.delta;\n  next.names.push(event.name + ":" + index);\n  return next;\n}, initial, true, true);\nconst numericIndexes = [];\nconst numeric = await scan([3, 5, 8], async (state, value, index) => {\n  numericIndexes.push(index);\n  return state + value;\n}, undefined, false, false);\nconst emptySeeded = await scan([], async (state) => state, 19, true, false);\nconst emptyUnseeded = await scan([], async (state) => state, undefined, false, false);\nconst marker = { kind: "reduce-stop" };\nlet caughtIdentity = false;\ntry {\n  await scan([2, 4, 6], async (state, value) => {\n    if (value === 4) throw marker;\n    return state + value;\n  }, 0, true, false);\n} catch (error) { caughtIdentity = error === marker; }\nreturn {\n  balance: accumulated.state.balance,\n  names: accumulated.state.names,\n  initialBalance: beforeReplacement.balance,\n  aliases: [accumulated.emissions[0] === accumulated.emissions[1], accumulated.emissions[1] === accumulated.emissions[2], accumulated.emissions[2] === accumulated.emissions[3], accumulated.state === accumulated.emissions[3]],\n  numeric: numeric.emissions,\n  numericIndexes,\n  empty: [emptySeeded.emissions, emptyUnseeded.emissions, emptyUnseeded.hasState],\n  caughtIdentity,\n  trace\n};\n'
  },
  {
    id: "07-forkjoin-last-values",
    source:
      'const trace = [];\nconst shared = { id: "shared-last", value: 23 };\nconst failure = { kind: "stream-error" };\nconst forkJoin = async (streams) => {\n  const last = [];\n  const hasValue = [];\n  const outcomes = await Promise.allSettled(streams.map(async (stream, index) => {\n    hasValue[index] = false;\n    try {\n      for (const value of stream.values) {\n        await tick(stream.name);\n        last[index] = await Promise.resolve(value);\n        hasValue[index] = true;\n        trace.push([stream.name, "next"]);\n      }\n      if (stream.fail) throw failure;\n    } finally {\n      await Promise.resolve();\n      trace.push([stream.name, "complete"]);\n    }\n  }));\n  const rejected = outcomes.find((outcome) => outcome.status === "rejected");\n  if (rejected) throw rejected.reason;\n  if (!hasValue.every((value) => value)) return { emitted: false, values: [] };\n  return { emitted: streams.length > 0, values: last };\n};\nconst successful = await forkJoin([\n  { name: "first", values: [{ value: 2 }, shared] },\n  { name: "second", values: [shared] },\n  { name: "third", values: [3, 5, 7] }\n]);\nconst empty = await forkJoin([\n  { name: "empty", values: [] },\n  { name: "drained", values: [11, 13] }\n]);\nlet rejectedIdentity = false;\ntry {\n  await forkJoin([\n    { name: "failing", values: [17], fail: true },\n    { name: "joined", values: [19, 29] }\n  ]);\n} catch (error) { rejectedIdentity = error === failure; }\nreturn {\n  success: { emitted: successful.emitted, values: successful.values, alias: successful.values[0] === successful.values[1], original: successful.values[0] === shared },\n  empty,\n  noStreams: await forkJoin([]),\n  rejectedIdentity,\n  trace\n};\n'
  },
  {
    id: "08-plain-thenable-combinators",
    source:
      'const trace = [];\nconst shared = { kind: "selected", score: 31 };\nconst firstReason = { kind: "first-rejection" };\nconst secondReason = { kind: "second-rejection" };\nconst thenable = (name, turns, value, rejects) => ({\n  name,\n  then(resolve, reject) {\n    trace.push(["assimilate", this.name]);\n    const complete = async () => {\n      for (let turn = 0; turn < turns; turn++) await Promise.resolve();\n      trace.push(["settle", name]);\n      if (rejects) reject(value);\n      else resolve(value);\n    };\n    complete();\n  }\n});\nconst source = [\n  thenable("slow", 3, shared, false),\n  thenable("fast", 0, shared, false),\n  thenable("rejected", 1, firstReason, true)\n];\nconst promises = source.map((value) => Promise.resolve(value));\nconst settledPromise = Promise.allSettled(promises);\nconst racePromise = Promise.race(promises);\nconst anyPromise = Promise.any(promises);\ntrace.push(["caller"]);\nconst raceWinner = await racePromise;\nconst anyWinner = await anyPromise;\nconst settled = await settledPromise;\nconst pair = await Promise.all([promises[0], promises[1]]);\nlet rejectionIdentity = false;\ntry {\n  await Promise.all([Promise.resolve(shared), thenable("all-error", 0, secondReason, true)]);\n} catch (error) { rejectionIdentity = error === secondReason; }\nlet aggregate;\ntry {\n  await Promise.any([\n    thenable("any-first", 2, firstReason, true),\n    thenable("any-second", 0, secondReason, true)\n  ]);\n} catch (error) {\n  aggregate = { name: error.name, count: error.errors.length, first: error.errors[0] === firstReason, second: error.errors[1] === secondReason };\n}\nreturn {\n  winnerIdentity: [raceWinner === shared, anyWinner === shared, pair[0] === pair[1]],\n  settled: settled.map((entry) => entry.status === "fulfilled" ? [entry.status, entry.value === shared] : [entry.status, entry.reason === firstReason]),\n  rejectionIdentity,\n  aggregate,\n  empty: [await Promise.all([]), await Promise.allSettled([])],\n  trace\n};\n'
  },
  {
    id: "09-rejection-identity-matrix",
    source:
      'const marker = { kind: "marker" };\nconst rows = [];\ntry { throw marker; } catch (error) { rows.push(["direct-throw", error === marker]); }\nconst synchronous = () => { throw marker; };\ntry { synchronous(); } catch (error) { rows.push(["function-throw", error === marker]); }\ntry { await Promise.reject(marker); } catch (error) { rows.push(["await-reject", error === marker]); }\ntry { await (async () => { throw marker; })(); } catch (error) { rows.push(["async-immediate", error === marker]); }\ntry { await (async () => { await Promise.resolve(); throw marker; })(); } catch (error) { rows.push(["async-delayed", error === marker]); }\ntry { await { then(resolve, reject) { reject(marker); } }; } catch (error) { rows.push(["await-thenable", error === marker]); }\nrows.push(["promise-catch", await Promise.reject(marker).catch((error) => error === marker)]);\nconst settled = await Promise.allSettled([Promise.reject(marker)]);\nrows.push(["allSettled-reason", settled[0].reason === marker]);\nconst returnedReason = await Promise.reject(marker).catch((error) => error);\nrows.push(["catch-return-value", returnedReason === marker]);\nconst arrayReason = ["marker"];\ntry { await Promise.reject(arrayReason); } catch (error) { rows.push(["array-rejection", error === arrayReason]); }\nconst typedError = Error("typed-marker");\ntry { await Promise.reject(typedError); } catch (error) { rows.push(["error-rejection", error === typedError]); }\nreturn rows;\n'
  },
  {
    id: "10-recovery-annotation",
    source:
      'const reason = { attempt: 0, annotations: [] };\nlet caught;\ntry {\n  await Promise.reject(reason);\n} catch (error) {\n  caught = error;\n  error.attempt++;\n  error.annotations.push("recovered");\n}\nreturn {\n  sameReason: caught === reason,\n  sameAnnotations: caught.annotations === reason.annotations,\n  original: reason,\n  caught,\n  nextAttempt: reason.attempt + 1\n};\n'
  },
  {
    id: "11-waterfall-error-instance",
    source:
      'const trace = [];\nconst shared = { name: "ledger", entries: [], total: 0 };\nconst marker = Error("expected-stop");\nconst advance = (amount) => {\n  shared.total += amount;\n  return shared;\n};\nconst waterfall = async (tasks, initial) => {\n  let values = initial;\n  for (let index = 0; index < tasks.length; index++) {\n    trace.push(["stage", index]);\n    values = await tasks[index](...values);\n  }\n  return values;\n};\nconst stages = [\n  async (ledger, update) => {\n    await tick("waterfall:load");\n    ledger.entries.push(2);\n    const pending = Promise.resolve(ledger);\n    const resolved = await pending;\n    return [resolved, update, resolved === ledger];\n  },\n  async (ledger, update, firstIdentity) => {\n    const tuple = await Promise.all([Promise.resolve(ledger), Promise.resolve(update)]);\n    tuple[1](3);\n    const returned = await (async () => tuple[0])();\n    trace.push(["identity", firstIdentity, tuple[0] === ledger, tuple[1] === update, returned === shared]);\n    return [returned, tuple[1]];\n  },\n  async (ledger, update) => {\n    await tick("waterfall:commit");\n    ledger.entries.push(5);\n    return [await Promise.resolve(ledger), await Promise.resolve(update)];\n  },\n  async (ledger, update) => [ledger === shared, update === advance, update(7) === ledger]\n];\nconst success = await waterfall(stages, [shared, advance]);\nlet caughtIdentity = false;\ntry {\n  await waterfall([\n    async (ledger) => [await Promise.resolve(ledger)],\n    async (ledger) => {\n      await tick("waterfall:fail");\n      ledger.entries.push(11);\n      throw marker;\n    },\n    async () => { trace.push(["unreachable"]); return []; }\n  ], [shared]);\n} catch (error) {\n  caughtIdentity = error === marker;\n} finally {\n  trace.push(["closed", shared.total]);\n}\nreturn { success, caughtIdentity, shared, trace };\n'
  },
  {
    id: "12-finally-domain-records",
    source:
      'const trace = [];\nconst bodyError = { name: "DomainFailure", message: "body", kind: "body", retryable: true };\nconst innerError = { name: "DomainFailure", message: "inner-cleanup", kind: "inner-cleanup", retryable: true };\nconst outerError = { name: "DomainFailure", message: "outer-cleanup", kind: "outer-cleanup", retryable: true };\nconst chainError = { name: "DomainFailure", message: "promise-finally", kind: "promise-finally", retryable: true };\nconst bodyValue = { kind: "body-value" };\nconst overrideValue = { kind: "outer-value" };\nconst execute = async (policy) => {\n  try {\n    try {\n      await tick(policy.name + ":body");\n      if (policy.bodyFails) throw bodyError;\n      return bodyValue;\n    } finally {\n      trace.push([policy.name, "inner-enter"]);\n      await tick(policy.name + ":inner");\n      if (policy.innerFails) throw innerError;\n      trace.push([policy.name, "inner-exit"]);\n    }\n  } finally {\n    trace.push([policy.name, "outer-enter"]);\n    try {\n      await tick(policy.name + ":outer");\n      if (policy.outerFails) throw outerError;\n      if (policy.outerReturns) return overrideValue;\n    } finally {\n      await Promise.resolve();\n      trace.push([policy.name, "outer-exit"]);\n    }\n  }\n};\nconst policies = [\n  { name: "success" },\n  { name: "body", bodyFails: true },\n  { name: "inner", bodyFails: true, innerFails: true },\n  { name: "outer", bodyFails: true, innerFails: true, outerFails: true },\n  { name: "override", bodyFails: true, innerFails: true, outerReturns: true },\n  { name: "chain", bodyFails: true, chainFails: true }\n];\nconst results = await Promise.all(policies.map(async (policy) => {\n  try {\n    const value = await execute(policy).finally(async () => {\n      await tick(policy.name + ":promise-finally");\n      trace.push([policy.name, "promise-finally"]);\n      if (policy.chainFails) throw chainError;\n      return { ignored: true };\n    });\n    return { name: policy.name, value: value.kind, original: value === bodyValue, overridden: value === overrideValue };\n  } catch (error) {\n    return { name: policy.name, error: error.kind, body: error === bodyError, inner: error === innerError, outer: error === outerError, chain: error === chainError };\n  }\n}));\nreturn { results, trace };\n'
  },
  {
    id: "13-domain-error-metadata",
    source:
      'const record = { name: "DomainFailure", message: "try again", code: "RETRY", retryable: true, context: { job: "alpha" } };\nconst allocated = Error("try again");\nallocated.code = "RETRY";\nallocated.retryable = true;\nallocated.context = { job: "alpha" };\nconst inspect = async (value) => {\n  try {\n    await Promise.reject(value);\n  } catch (error) {\n    return {\n      same: error === value,\n      name: error.name,\n      message: error.message,\n      code: error.code,\n      retryable: error.retryable,\n      context: error.context,\n      contextSame: error.context === value.context\n    };\n  }\n};\nconst returned = await Promise.reject(record).catch((error) => error);\nreturn { plain: await inspect(record), allocated: await inspect(allocated), catchContinuationSame: returned === record };\n'
  }
];

const values = [
  ["domain record", '{ name: "DomainFailure", message: "retry" }'],
  ["Error-shaped record", '{ name: "Error", message: "retry" }'],
  ["TypeError-shaped record", '{ name: "TypeError", message: "retry" }'],
  ["plain record", "{}"],
  ["genuine TypeError", 'new TypeError("retry")'],
  ["string", '"retry"'],
  ["number", "42"],
  ["false", "false"],
  ["null", "null"],
  ["undefined", "undefined"]
] as const;

function exceptionSource(initializer: string, operation: string, checkpoint = "none") {
  return `
    const reason = ${initializer};
    const context = { job: "alpha", attempts: [], nested: { count: 0 } };
    const labels = ["original"];
    const objectReason = reason !== null && typeof reason === "object";
    if (objectReason) {
      reason.code = "RETRY";
      reason.retryable = true;
      reason.context = context;
      reason.cause = context;
      reason.labels = labels;
      reason.stack = "provided-stack";
      reason.optional = undefined;
      reason.zero = 0;
      reason.disabled = false;
    }
    let caught;
    const readers = [() => reason, () => caught, () => context, () => labels];
    try {
      ${checkpoint === "before" ? "await wait();" : ""}
      ${operation}
    } catch (error) {
      caught = error;
      if (objectReason) {
        error.context.attempts.push("caught");
        error.context.nested.count += 1;
        error.labels.push("catch");
        error.annotation = "recovered";
      }
      ${checkpoint === "after" ? "await wait();" : ""}
    }
    if (objectReason) {
      reason.context.nested.count += 2;
      return {
        same: caught === reason,
        readers: [readers[0]() === caught, readers[1]() === reason, readers[2]() === caught.context, readers[3]() === caught.labels],
        aliases: [caught.context === context, caught.cause === context, caught.labels === labels],
        metadata: { name: caught.name, message: caught.message, stack: caught.stack, code: caught.code, retryable: caught.retryable, optional: caught.optional, zero: caught.zero, disabled: caught.disabled, annotation: reason.annotation },
        keys: caught instanceof Error ? undefined : Object.keys(caught).sort(),
        context: reason.context,
        cause: caught.cause,
        labels,
        errorInstance: caught instanceof Error,
        typeErrorInstance: caught instanceof TypeError
      };
    }
    return { same: caught === reason, caught, readers: [readers[0]() === caught, readers[1]() === reason] };
  `;
}

function deferred() {
  let resolve!: (value: undefined) => void;
  const promise = new Promise<undefined>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("independent original AW source validation", () => {
  it.each(originalWorkflows)(
    "matches complete native output and tick log: $id",
    async ({ source }) => {
      const expectedCalls: unknown[] = [];
      const expected = await new AsyncFunction("tick", source)(async (label: unknown) => {
        if (expectedCalls.length >= 100) throw new Error("Native tick limit");
        expectedCalls.push(label);
        await Promise.resolve();
      });
      const actualCalls: unknown[] = [];
      const result = await run(source, {
        budget: new Budget({ maxSteps: 200_000 }),
        bindings: {
          tick: async (label: unknown) => {
            if (actualCalls.length >= 100) throw new Error("SafeJS tick limit");
            actualCalls.push(label);
            await Promise.resolve();
          }
        }
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.returnValue).toEqual(expected);
      expect(actualCalls).toEqual(expectedCalls);
    }
  );
});

describe.each(values)("independent source value: %s", (_name, initializer) => {
  it.each([
    [
      "cross-function",
      "function leaf() { throw reason; } function middle() { return leaf(); } middle();"
    ],
    [
      "cross-await",
      "async function leaf() { await 0; throw reason; } async function middle() { return await leaf(); } await middle();"
    ],
    [
      "rethrow-finally",
      "try { await Promise.reject(reason); } catch (inner) { await 0; throw inner; } finally { await 0; }"
    ]
  ])(
    "retains metadata, aliases and bidirectional mutations across %s",
    async (_path, operation) => {
      const source = exceptionSource(initializer, operation);
      const expected = await new AsyncFunction(source)();
      expect(expected.same).toBe(true);
      expect(expected.readers.every((same: boolean) => same)).toBe(true);
      const result = await run(source, { budget: new Budget({ maxSteps: 10_000 }) });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.returnValue).toEqual(expected);
    }
  );
});

describe("finite before/after catch checkpoints and current capture restoration", () => {
  it.each(
    values.flatMap(([name, initializer]) =>
      ["before", "after"].flatMap((position) =>
        ["next", "current"].map((capture) => ({ name, initializer, position, capture }))
      )
    )
  )(
    "restores $name at $position using $capture capture",
    async ({ initializer, position, capture }) => {
      const source = exceptionSource(
        initializer,
        "function leaf() { throw reason; } leaf();",
        position
      );
      const expected = await new AsyncFunction("wait", source)(async () => undefined);
      const pending = deferred();
      const entered = deferred();
      const result = run(source, {
        budget: new Budget({ maxSteps: 10_000 }),
        bindings: {
          wait:
            capture === "current"
              ? createSandboxClosure({
                  async: true,
                  call: () => {
                    entered.resolve(undefined);
                    return createSandboxPromise(pending.promise);
                  },
                  name: "wait"
                })
              : declareHostOperation(async () => {
                  entered.resolve(undefined);
                  await pending.promise;
                }, "re-issue")
        }
      });
      let snapshot;
      try {
        if (capture === "current") await entered.promise;
        snapshot = JSON.parse(await (capture === "current" ? dumpCurrent(result) : dump(result)));
      } finally {
        pending.resolve(undefined);
      }
      expect(snapshot.version).toBe(DUMP_FORMAT_VERSION);
      expect(snapshot.executionSemantics).toBe(EXECUTION_SEMANTICS);
      expect(snapshot.sourceHash).toBe(hashSource(source));
      const uninterrupted = await result;
      expect(uninterrupted.ok).toBe(true);
      if (!uninterrupted.ok) throw new Error(uninterrupted.error.message);
      expect(uninterrupted.returnValue).toEqual(expected);
      const resumed = await run(source, {
        budget: new Budget({ maxSteps: 10_000 }),
        bindings: {
          wait:
            capture === "current"
              ? createSandboxClosure({
                  async: true,
                  call: () => createSandboxPromise(Promise.resolve(undefined)),
                  name: "wait"
                })
              : declareHostOperation(async () => undefined, "re-issue")
        },
        snapshot: restore(snapshot, { source })
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) throw new Error(resumed.error.message);
      expect(resumed.returnValue).toEqual(expected);
    }
  );
});

describe("independent host and public boundaries", () => {
  it("rejects current capture while an injected host call is active", async () => {
    const pending = deferred();
    const entered = deferred();
    const result = run("await wait(); return 17;", {
      bindings: {
        wait: declareHostOperation(async () => {
          entered.resolve(undefined);
          await pending.promise;
        }, "re-issue")
      }
    });
    await entered.promise;
    try {
      expect(() => dumpCurrent(result)).toThrow("Sandbox object is already running.");
    } finally {
      pending.resolve(undefined);
    }
    await expect(result).resolves.toMatchObject({ ok: true, returnValue: 17 });
  });

  it.each(["sync", "async"])(
    "copies registered host Error metadata through %s rejection",
    async (mode) => {
      const detail = { attempts: [] as string[] };
      const failure = new TypeError("host retry");
      hostErrorData.set(failure, { code: "HOST", detail });
      const result = await run(
        `
      try { await fail(); } catch (error) {
        error.detail.attempts.push("caught");
        return { name: error.name, message: error.message, code: error.code, attempts: error.detail.attempts, type: error instanceof TypeError };
      }
    `,
        {
          bindings: {
            fail: () => {
              if (mode === "async") return Promise.reject(failure);
              throw failure;
            }
          }
        }
      );
      expect(result).toMatchObject({
        ok: true,
        returnValue: {
          name: "TypeError",
          message: "host retry",
          code: "HOST",
          attempts: ["caught"],
          type: true
        }
      });
      expect(detail.attempts).toEqual([]);
    }
  );

  it.each(["sync", "async"])(
    "normalizes host ordinary records through %s rejection",
    async (mode) => {
      const failure = {
        name: "DomainFailure",
        message: "host retry",
        code: "HOST",
        context: { attempts: [] }
      };
      const result = await run(
        `
      try { await fail(); } catch (error) {
        return { name: error.name, message: error.message, code: error.code, context: error.context, type: error instanceof Error };
      }
    `,
        {
          bindings: {
            fail: () => {
              if (mode === "async") return Promise.reject(failure);
              throw failure;
            }
          }
        }
      );
      expect(result).toMatchObject({
        ok: true,
        returnValue: {
          name: "Error",
          message: "host retry",
          code: undefined,
          context: undefined,
          type: true
        }
      });
      expect(failure.context.attempts).toEqual([]);
    }
  );

  it("keeps copied host return values source-local when thrown after awaiting", async () => {
    const original = {
      name: "DomainFailure",
      message: "retry",
      context: { attempts: [] as string[] }
    };
    const result = await run(
      `
      const reason = await input();
      try { await (async () => { throw reason; })(); } catch (error) {
        error.context.attempts.push("source");
        return { same: error === reason, contextSame: error.context === reason.context, attempts: reason.context.attempts, type: error instanceof Error };
      }
    `,
      { bindings: { input: async () => original } }
    );
    expect(result).toMatchObject({
      ok: true,
      returnValue: { same: true, contextSame: true, attempts: ["source"], type: false }
    });
    expect(original.context.attempts).toEqual([]);
  });

  it.each([
    ['throw { name: "DomainFailure", message: "retry", code: "RETRY" };', "Error", "retry"],
    [
      'await (async () => { throw { name: "TypeError", message: "retry", code: "RETRY" }; })();',
      "TypeError",
      "retry"
    ],
    ['throw new TypeError("retry");', "TypeError", "retry"],
    ['throw "retry";', "Error", "retry"],
    ["throw 42;", "Error", "42"],
    ["throw null;", "Error", "null"],
    ["throw undefined;", "Error", "undefined"],
    ['throw { code: "RETRY" };', "Error", '{"code":"RETRY"}']
  ])("retains public rejection normalization for %s", async (source, name, message) => {
    await expect(run(source)).rejects.toMatchObject({
      name,
      message,
      stack: expect.any(String),
      span: expect.any(Object)
    });
  });

  it("retains public diagnostic and successful return envelopes", async () => {
    await expect(run("return absent;")).resolves.toMatchObject({
      ok: false,
      error: { code: "UNBOUND_IDENTIFIER", name: "ReferenceError" }
    });
    await expect(run("return 17;")).resolves.toMatchObject({ ok: true, returnValue: 17 });
  });
});
