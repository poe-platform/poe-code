# SafeJS

Run a JavaScript subset with explicit host capabilities, execution budgets, and resumable checkpoints.

This README describes the current source checkout. See [Development status](#development-status)
for local changes that are not yet released; installing the published package
does not necessarily include them.

## Quickstart

Install the public package (Node.js 18.18+ and ESM):

```sh
npm install @poe-platform/safe-js
```

Save this as `example.mjs`, then run `node example.mjs`:

```js
import { Budget, run } from "@poe-platform/safe-js";

const result = await run("return prices.map(price => price * 2);", {
  bindings: { prices: [3, 5, 8] },
  budget: new Budget({ maxSteps: 10_000, maxCallDepth: 100 })
});

if (!result.ok) throw result.error;
console.log(result.returnValue);
// [6, 10, 16]
```

`run()` takes source text, not a file path. Success returns `ok`, `returnValue`, `snapshot`, and `stats`. Handle both an `ok: false` result and a rejected promise: parsing, budget exhaustion, cancellation, and some execution failures can reject. Top-level `await` in this example lets rejections reach Node.

`@poe-platform/safe-js/core` exposes `run`, `createRealm`, `defineExtension`, `lint`, `Budget`, and replayable-random helpers. The shared filesystem lives in `@poe-platform/safe-fs`, with a portable `/core` entry. Existing `@poe-platform/safe-js/fs`, `/fs/core`, and `/fs/node` imports re-export it. Legacy `poe-code/safe-js` imports remain available through the CLI package but use a separate runtime; keep factories and errors within one import family.

## Supported features

- **JavaScript control flow:** functions and closures, classes, async/await, loops, destructuring, spread, templates, exceptions, and synchronous and asynchronous generators.
- **Guest function objects:** own properties on functions and arrows; ordinary constructors with shared prototypes, inherited methods and `instanceof`. `Object.create`, `getPrototypeOf`, `setPrototypeOf`, own-property inspection, and data descriptors work on ordinary sandbox records.
- **Data processing:** arrays, objects, strings, numbers, BigInt, Symbol, JSON, Math, Date, Map, Set, typed arrays, ArrayBuffer/DataView, promises, Intl APIs, and budgeted regular expressions. Built-in presence does not imply complete ECMAScript conformance.
- **Explicit capabilities:** static imports and dynamic `import()` resolve against host-supplied modules, not arbitrary npm packages or files. Optional helpers cover agents, MCP tools, files, environment reads, time, logging, and metrics.
- **Persistent realms:** keep guest state across evaluations; register trusted extensions with explicit grants, live host objects, revocable callbacks, and ordered cleanup.
- **Execution controls:** step, call-depth, string, array, and retained-data budgets; an absolute deadline; host cancellation; console and telemetry sinks.
- **Checkpoints:** capture execution state, restore compatible source, and reconcile pending host operations. Changed programs can use explicit continuation migration.
- **Authoring tools:** lint diagnostics and fixes, source-positioned errors, Markdown harnesses, and paired Markdown/script files. `run()` does not lint automatically; harness runners do.

Scripts have no ambient `process`, `require`, `fetch`, or filesystem access. Host functions still execute with the host's privileges. Register only the capabilities the script needs; this is not OS or process isolation.

```js
const result = await run(`
  function Counter(value) { this.value = value; }
  Counter.label = "counter";
  Counter.prototype.read = function () { return this.value; };
  const counter = new Counter(7);
  return [Counter.label, counter.read(), counter instanceof Counter];
`, { budget: new Budget({ maxSteps: 10_000 }) });
// result.returnValue: ["counter", 7, true]
```

Properties stay inside the interpreter, not on native host functions. Arrows and object methods remain nonconstructible. Supported guest prototype links include arrays and function objects; native `Function.prototype` is never exposed.

<details>
<summary>Object inspection and prototypes</summary>

Ordinary objects inherit a sandbox-owned `Object.prototype`. Cached inspection works:

```js
const result = await run(`
  const inspect = ({}).toString;
  return [inspect.call([]), inspect.call(new Date(0)),
    Object.getPrototypeOf({}) === Object.prototype];
`);
// result.returnValue: ["[object Array]", "[object Date]", true]
```

- `Object()` / `new Object()` create ordinary objects; passing an object preserves its identity.
- `toString`, `valueOf`, `hasOwnProperty`, `propertyIsEnumerable` and `isPrototypeOf` support ordinary inspection. Type tags use sandbox brands, not guest-supplied fields.
- Intrinsic methods are non-enumerable. Guest constructor prototypes inherit the ordinary Object prototype; explicit null/custom prototypes work with `Object.create`, `Object.setPrototypeOf` and literal `__proto__`. A computed `['__proto__']` remains an own data property.
- Prototype mutations stay inside the current run or persistent realm and consume its retained-data budget. They never change native prototypes or another realm.

Guest symbols, supported prototype links, and mutated guest intrinsics can be
represented in checkpoints. Plain data-copy helpers have narrower contracts:
for example, copying an array with a custom prototype can be rejected rather
than silently discarding the prototype. Checkpoint support does not imply that
every host object or prototype graph is copyable. `run()` does not lint
automatically.

</details>

<details>
<summary>Dates and clocks</summary>

`new Date(0).toISOString()` returns `1970-01-01T00:00:00.000Z`. Both `Date.now()` and `+new Date` work without a host shim.

| Operation | Supported |
| --- | --- |
| Construction | Current time, epoch milliseconds, strings, another Date, or calendar components; `Date()` returns a time string. |
| Static methods | `now`, `parse`, `UTC`. |
| Reading | `getTime`, `valueOf`, `getTimezoneOffset`; local and UTC getters for full year, month, date, day, hours, minutes, seconds and milliseconds. |
| Mutation | `setTime`; local and UTC setters for full year, month, date, hours, minutes, seconds and milliseconds. Overflow and invalid dates follow Date semantics. |
| Formatting | `toISOString`, `toJSON`, `toString`, `toUTCString`, `toDateString`, `toTimeString`. Invalid dates stringify as `Invalid Date`, become JSON `null`, and throw on `toISOString`. |

Current time defaults to wall time. Supply a clock for controlled reads:

```js
const result = await run("return [Date.now(), new Date().toISOString()];", {
  clock: { now: () => 0, snapshot: () => undefined }
});
```

Current-time reads are recorded for replay; replay does not call `now()` again. A stateful provider can implement `restore({ next })` to advance its state after each replayed read. `snapshot()` retains its existing clock-metadata role. The same clock option works in persistent realms.

Date values copy by value across host bindings, preserving aliases within a graph. Checkpoints preserve epoch values, invalid dates and mutations rather than converting dates to strings. Parsing is limited to 4,096 characters and consumes the work/string budgets; retained values consume data budget. Local methods and non-ISO parsing follow the host timezone/runtime, so use explicit-zone ISO strings and UTC methods for portable output.

</details>

## Add a host capability

Expose a small module rather than an entire application client:

```js
import { Budget, lint, run } from "@poe-platform/safe-js";

const source = `
  import { lookup } from "catalog";
  const item = await lookup("pencil");
  return item.price;
`;

const diagnostics = lint(source, { modules: { catalog: ["lookup"] } });
if (diagnostics.some(diagnostic => diagnostic.severity === "error")) {
  throw new Error(JSON.stringify(diagnostics));
}

const result = await run(source, {
  modules: {
    catalog: {
      lookup: async name => {
        if (name !== "pencil") throw new Error("Unknown item");
        return { price: 2 };
      }
    }
  },
  budget: new Budget({ maxSteps: 10_000, maxCallDepth: 100 })
});

if (!result.ok) throw result.error;
console.log(result.returnValue);
// 2
```

The lint registry describes exports; the runtime registry supplies their values. Both accept records or Maps. Module names are host-defined identifiers, not file paths or npm packages. Validate arguments and enforce permissions inside each host operation. Adding a function does not make its effects safe to replay.

## Keep state between evaluations

```js
import { Budget, createRealm } from "@poe-platform/safe-js/core";

const realm = createRealm({ budget: new Budget({ maxSteps: 10_000 }) });
try {
  await realm.evaluate("let total = 1;");
  const result = await realm.evaluate("return ++total;");
  if (!result.ok) throw new Error(result.error.message);
  console.log(result.returnValue);
} finally {
  await realm.close();
}
```

This prints `2`. Evaluations share declarations, closures and object identity without rerunning earlier source. Budgets are cumulative. `evaluate(source, { filename? })` returns `ok`, `returnValue` or `error`, and `stats`; it can also reject. Concurrent evaluations are rejected. Deferred callbacks can run while guest code awaits their result; overlapping invocation of the same callback is rejected. Close cancels pending work, revokes capabilities and awaits cleanup; repeated close does not rerun cleanup. Unhandled execution failures also close the realm.

`createRealm(options?)` accepts `bindings`, `modules`, `budget`, `clock`, `signal`, `sink` and `randomSeed` as described below, plus:

| Option | Purpose / default |
| --- | --- |
| `extensions` | Explicit `defineExtension(...)` registrations; `[]`. Setup runs once, on first evaluation, not on construction or unused close. |
| `grants` | Granted capability names; `[]`. Every requested capability must be granted before any extension setup runs. |
| `builtinOverrides` | Optional `{ console: "extension-name" }` authorizes that registered extension to replace only the builtin console. It must declare `console` and export a host object created in the realm. No overrides by default. |
| `limits` | Positive integer caps: `extensions: 32`, `hostObjects: 1024`, `callbacks: 1024`, `guestReferences: 1024`, `cleanups: 1024`, `nestedEvaluations: 16`. Collection budgets also apply. |

Ordinary host arguments/results are still copied. To preserve live native identity, explicitly create a host object. A guest function crossing to the host becomes an opaque callback: invoke it with `realm.invokeCallback(callback, { thisValue?, args? })`, then `realm.releaseCallback(callback)` when no longer needed. Callbacks and live objects cannot cross realms or survive close. For deferred arguments that must preserve guest identity, opt into retained references as described below.

Need synchronous effects without waiting for an async callback's tail? Use `realm.startCallback(callback, options)` or `context.startCallback(callback, options)`. The frozen `CallbackInvocation` exposes two promises: await `synchronous` when the guest function returns or its async body reaches its first `await`; await `result` for the final value. Interpreter implementation awaits and budget work do not complete the prefix. Ordinary throws reject both promises; nonfatal async-function errors reject only `result`, even before the first `await`. Close, abort and fatal errors reject still-pending handles without changing a completed prefix. The same callback limits, identity and reentry rules apply; no extra grant is required. Calls started outside a host operation are queued in invocation order. Browser event/default-action policy remains the host's responsibility.

<details>
<summary>Trusted extensions and live host objects</summary>

```js
import { createRealm, defineExtension } from "@poe-platform/safe-js/core";

const counter = defineExtension({
  manifest: {
    version: 1,
    name: "counter",
    capabilities: ["counter-state"],
    globals: ["counter"]
  },
  setup(context) {
    let value = 0;
    return { globals: {
      counter: context.createHostObject({
        properties: { value: { get: () => value } },
        methods: { increment: () => ++value }
      })
    } };
  }
});

const realm = createRealm({ extensions: [counter], grants: ["counter-state"] });
try {
  await realm.evaluate("counter.increment();");
  console.log((await realm.evaluate("return counter.value;")).returnValue);
} finally {
  await realm.close();
}
```

The manifest requires `version: 1` and a nonempty `name`. Optional `capabilities` and `globals` are name arrays; `modules` maps module names to export-name arrays. Synchronous `setup(context)` returns `{ globals?, modules? }` matching those declarations exactly. Module exports use the existing record/Map registry. Duplicate names, incompatible versions, missing grants and conflicts with intrinsics or caller values are rejected before setup. Accessor-based declarations and asynchronous factories are unsupported.

**Sharing an owned console.** An extension can expose the same host object as `console`, `window.console` and `self.console`:

```js
const browser = defineExtension({
  manifest: { version: 1, name: "browser", globals: ["console", "window", "self"] },
  setup(context) {
    const console = context.createHostObject({ methods: {
      log: (...args) => journal.log(...args),
      warn: (...args) => journal.warn(...args)
    } });
    const window = context.createHostObject({ properties: {
      console: { get: () => console }
    } });
    return { globals: { console, window, self: window } };
  }
});
const realm = createRealm({
  extensions: [browser],
  builtinOverrides: { console: "browser" }
});
```

Supply your own bounded `journal`; this does not add browser console behavior. Without authorization, registration still fails before setup. Caller-provided console bindings, another extension claiming console, unknown override names and missing capability grants still reject. JSON and other intrinsics cannot be overridden this way. The replacement uses normal capability accounting and revocation; its calls do not also go to the builtin `sink`. Close the realm when finished, as in the example above.

| Context member | Contract |
| --- | --- |
| `signal` | Realm cancellation signal; aborted on close or failure. |
| `onCleanup(fn)` | Register a sync/async disposer. Cleanup runs in reverse order, awaits every disposer, and reports failures without skipping the rest. |
| `chargeWork(units = 1)` | Charge a nonnegative integer against the shared execution budget. Fatal exhaustion cannot be swallowed to continue execution. |
| `createHostObject({ properties?, methods?, indexed?, named? })` | Create a realm-owned capability. Properties declare synchronous `get`/`set` functions; methods are host functions. Optional `indexed` and `named` expose bounded live members. Undeclared members expose no native prototype. |
| `invokeCallback(callback, { thisValue?, args? })` | Invoke a captured guest function with the realm's state, cancellation and budgets. Same operation as on the realm. |
| `startCallback(callback, { thisValue?, args? })` | Return separate `synchronous` and `result` promises for the same realm-owned invocation. Also available on the realm. |
| `releaseCallback(callback)` | Revoke the callback and release its retained guest state. |
| `retainGuestArguments(operation, from)` | During setup, opt an operation into opaque argument references starting at the zero-based index `from`. Requires declared and granted `guest:retain`. Earlier arguments keep normal conversion; live host methods preserve the declaration. |
| `releaseGuestReference(reference)` | Revoke one reference and release its retained state. Also available on the realm. |
| `nestedOperation(fn)` | During setup, mark a host operation authorized to run nested source. Requires declared and granted `source:nested`. |
| `evaluateNested(source)` | Only inside that extension's authorized operation. Completes before the enclosing call returns to guest code, shares scope/budgets, and propagates errors. Parallel nested evaluations and ordinary source reentry are rejected. |

For a timer-shaped `schedule(callback, delay, ...args)`, register `context.retainGuestArguments(schedule, 2)`. The host receives normal callback/delay values and opaque `GuestReference` handles for the remaining arguments. Pass those handles to `context.invokeCallback(callback, { args })` to recover the original guest objects and observe mutations made after scheduling. References also work as callback receivers and host return values, including cycles, closures, primitives and live host objects.

Release each reference when the host no longer needs it; returning it does not release it. Retained graphs count against data budgets and `limits.guestReferences`. Synchronous native failure releases references captured for that call; asynchronous operations must release theirs in host cleanup. Close revokes all remaining references. Handles cannot be inspected, used in another realm, or serialized into replay/error data. Unmarked operations still copy values.

For a live collection, keep the elements in your adapter and expose virtual indices instead of declaring one getter per element:

```js
const collection = context.createHostObject({ indexed: {
  length: () => elements.length,
  get: index => elements[index],
  maxLength: 4096
} });
```

`length()` and `get(index)` must be synchronous. `maxLength` is required: an integer from 1 to 65,536. Every reported length must be a nonnegative integer within that cap and the execution array-length budget. Return existing `HostObject` handles for elements that need live identity; ordinary results use the normal copy boundary.

Saved collections observe current host contents. Index reads, `Object.keys`/`values`/`entries`, `Object.hasOwn`, `in`, `for...in`, `for...of`, array/object spread and `Array.from` use the live view. Enumerable keys include current indices and fixed members, but not `length`. `Array.from` preserves element identity and interleaves mapping with reads. Noncanonical and out-of-range indices never call `get`; fixed members cannot reuse `length` or canonical index names. Enumeration and traversal consume execution budgets, without eagerly allocating virtual properties.

For a live set of named properties, add `named` to the same definition:

```js
const named = {
  keys: () => [...attributes.keys()],
  get: name => attributes.get(name),
  maxKeys: 256,
  maxKeyCodeUnits: 8192,
  enumerable: false
};
const attributesObject = context.createHostObject({ named });
```

| Named option | Contract |
| --- | --- |
| `keys()` | Synchronous dense own-data array of distinct strings. Proxies, accessors, sparse arrays and reserved `constructor`/`prototype`/`__proto__` names reject. |
| `get(name)` | Synchronous value provider, called only for a currently present name. Existing host conversion and identity rules apply. |
| `set(name, value)` | Optional synchronous setter, including new names. Receives the normally converted host value; assignment returns the original guest RHS. Omit to keep named writes disabled. |
| `delete(name)` | Optional synchronous deleter returning a boolean. Absent names return `true` without calling it; existing names return its result. Omit to keep deletion disabled. |
| `maxKeys` | Required positive integer, at most 65,536. |
| `maxKeyCodeUnits` | Required positive aggregate key-length cap, at most 1,048,576 UTF-16 code units. Execution, array, string and data budgets also apply. |
| `enumerable` | Defaults to `true`. Set `false` to keep names readable and visible to `in`/`Object.hasOwn`, but omit them from keys/values/entries, object spread and `for...in`. |

Fixed properties/methods take precedence over names. With `indexed`, numeric indices and `length` remain indexed members. Enumeration deduplicates collisions; names removed by an earlier getter are skipped. Named-only objects are not iterable—combine `named` with `indexed` when you need numeric collection access and `for...of`.

To opt into dynamic writes and deletion, supply the hooks explicitly:

```js
const storage = context.createHostObject({
  named: {
    keys: () => [...values.keys()],
    get: name => values.get(name),
    set: (name, value) => { values.set(name, value); },
    delete: name => values.delete(name),
    maxKeys: 256,
    maxKeyCodeUnits: 8192
  }
});
```

Guest code can now use `storage.theme = "dark"` and `delete storage.theme`.

Both hooks must be synchronous; async/generator functions and proxies reject, and promises returned by ordinary functions are rejected and observed. Fixed members still use only their declared setters. Named hooks cannot overwrite or delete fixed members, indexed slots (including out-of-range indices), indexed `length`, or reserved prototype names. Saved objects remain live across native changes and are revoked on realm close.

SafeJS validates current keys and prospective new-key count/UTF-16/data limits before calling a mutator, then validates keys again afterward. Work, conversion and cancellation budgets still apply. Providers must enforce atomic storage quotas themselves: a post-write failure cannot roll back native side effects. Values are normally copied or passed as explicit realm-owned capabilities, not retained as arbitrary guest objects. Browser Storage coercion, persistence, origin policy and events belong in the consumer.

Named properties are read-only unless opted in; indexed members and indexed `length` remain read-only. Live objects reject other deletion, freezing, native prototype access, property-descriptor manipulation and portable serialization. Realm state is not a checkpoint: snapshot/replay and live-capability error-data conversion are rejected. Extensions are trusted native code; grants are a registration contract, not OS isolation. Native work still needs host timeouts and external process supervision for hard limits. No DOM, timers or browser engine are bundled.

For one-shot use, `run(source, { extensions, grants, ... })` accepts the same realm options plus `filename`, returns data only, and closes resources before settling. Run-only features such as snapshots, `entryPointArgs`, `importMeta`, custom random generators and telemetry are rejected in this mode rather than silently ignored.

</details>

## Options

### Execution

`run(source, options?)` accepts:

| Option | Purpose / default |
| --- | --- |
| `bindings` | Global input values and host functions; none by default. |
| `modules` | Module names mapped to export records or Maps; none by default. |
| `extensions`, `grants`, `builtinOverrides`, `limits` | Opt into a one-shot extension realm; see the supported options and lifetime rules above. |
| `budget` | A `Budget` instance. Without one, only the default call-depth limit of 1,000 is configured. |
| `signal` | Host `AbortSignal` for cancellation. |
| `filename` | Diagnostic filename; defaults to `<input>`. |
| `entryPointArgs` | Arguments for invoking the default-exported function. Omit for top-level execution only. |
| `importMeta` | Host-supplied fields exposed through `import.meta`. |
| `sink` | Console destination with `log(...args)` and `error(...args)`; defaults to the host console. |
| `otelSink` | Telemetry with `startSpan` and `recordException`; spans implement `setAttribute`, `addEvent`, and `end`. Optional; `noopOtelSink` is available. |
| `randomSeed`, `random` | Seed for built-in `Math.random`, or a custom `{ next, seed, snapshot }` generator. `random` takes precedence. |
| `clock` | Optional `now()` supplies Date current-time reads; defaults to wall time. `snapshot()` returns `{ next }` or `undefined`; optional `restore({ next })` advances state on replayed reads. Snapshot-only providers remain valid. |
| `snapshot` | Previously captured state to resume. |
| `snapshotPath`, `snapshotBackend` | Checkpoint output file or custom backend (`read`, `write`, `remove`); backend takes precedence. Neither automatically loads state into `snapshot`. |
| `snapshotIntervalMs` | Periodic checkpoint interval when persistence is configured: 30,000 ms; `0` disables periodic writes. Capture happens at interpreter yield points. |
| `hostCallResumeProvider` | Reconciles pending external operations on restore; returns a matching `HostCallResumeProof`. |

`new Budget(options?)` accepts optional limits. A custom budget replaces the default, so include `maxCallDepth` if you want that guard.

| Option | Limit |
| --- | --- |
| `maxSteps` | Interpreter work counter. |
| `deadline` | Absolute epoch milliseconds or a `Date`, not a duration. |
| `maxCallDepth` | Nested interpreter calls. |
| `stringLength`, `arrayLength` | Individual string and array lengths. |
| `dataSize` | Retained sandbox data units, not bytes of process memory. |

There are no runtime environment variables to set. `makeEnvModule({ allow, values? })` grants reads of names in `allow`; `values` supplies an explicit string map instead of reading the host's `process.env`. Disallowed reads throw `EnvAccessError`; allowed but unset names return `undefined`. Agent and MCP integrations may require their own credentials.

<details>
<summary>Linting, parsing, and value conversion</summary>

`lint(source, options?)` returns diagnostics with severity, code, message, filename, line, column, span, and optional fix/hint. With `fix: true`, it returns `{ diagnostics, fixed, fixes }` instead.

| Option | Purpose |
| --- | --- |
| `filename`, `allowedGlobals` | Diagnostic filename and additional permitted global names. |
| `modules` | Export-name lists, or `{ exports, filename?, source? }` descriptions. Typed `exports` map names to type strings or `{ type?, async? }`; source descriptions enable import-cycle checks. |
| `allowedExportNames` | Permitted named exports. |
| `defaultExport` | Expected entry point: `{ parameters?: string[], required?: boolean }`. |
| `frontmatterFields` | Fields to check for unused harness configuration. |
| `largeLiteralThreshold` | Threshold for large-literal diagnostics. |
| `fix`, `fixRanges` | Apply available fixes, optionally restricted to source ranges. |

`parse(source, filename?)` parses a single statement/expression; `parseModule(source, filename?)` parses a module. `formatInterpreterError(error, { source?, filename?, hostCallName?, maxMessageLength? })` formats an error; `(source, diagnostic)` is also supported.

`deepCopyToSandbox(value)` and `deepCopyFromSandbox(value, { wrapClosure? })` convert supported values. `wrapClosure` lets the host choose how to represent an exported sandbox function. Not every native JavaScript object is convertible.

</details>

<details>
<summary>Optional host modules</summary>

Factories return exports to register in `modules`; calling a factory alone does not grant access.

| Factory | Configuration and capabilities |
| --- | --- |
| `makeAgentModule(spawnAgent, options?)` | Inject the agent runner. Options: `defaultRetry`, `onEvent`, `otelSink`. Exposes `spawn`, `spawn.retry`, and `spawn.parallel`; call options follow this table. |
| `makeMcpModule(options)` | Required `servers` map: stdio `{ command, args?, cwd?, env? }` or HTTP `{ url, headers? }`. Options: `requestTimeoutMs` (30,000), `closeTimeoutMs` (1,000), `maxToolPages` (100), `signal`, and injected `fetch`/`spawn`. Named clients expose `tools`, `tool`, `toolBatch`, and `close`; close managed clients when finished. A custom connector function is also accepted. |
| `makeFsModule(options?)` | Node-backed `{ root?, fs? }`, or shared-filesystem `{ adapter, root?, cwd?, signal? }`; do not combine `fs` and `adapter`. Node access without `root` is unconfined. With an adapter, `root` confines access and `cwd` selects the virtual relative-path base; without `root`, explicit `cwd` also confines access. Omitting both uses virtual `/`. Read text with `readFile(path, "utf8")`; see the [module methods](src/modules/fs.ts) and [filesystem package](../safe-fs/README.md). |
| `makeEnvModule(namesOrOptions)` | Allowed-name array or `{ allow, values? }`; exposes `get(name)`. `parseEnvConfig(json)` accepts the object form. |
| `makeTimeModule(options?)` | `now`, `random`, `seed`, `signal`; exposes `now`, `random`, `sleep`, `uuid`. Defaults to host time/randomness; `seed` makes the random generator deterministic, and explicit `random` takes precedence. |
| `makeLogModule(sink)` | Sends timestamped `info`, `error`, and `event` entries to your callback. |
| `makeMetricModule(npmRunner)` | Runs `metric:<name>` through your callback; reads the final nonempty stdout line as a finite numeric score. |
| `makeHarnessModule(frontmatter, meta)` | `meta` is `{ kind, version, filepath }`. Exposes `tasks`, `agents`, `meta`, and `applyConstraints`; prompt constraints come from frontmatter `principles` and `constraints`. |
| `makeFailModule()` | Exposes a default function that throws a harness failure. No options. |

**Agent calls.** A definition is a name or `{ agent, prompt?, model?, mode?, cwd?, mcp? }`. `spawn(definition, options)` requires `prompt` and accepts `check` (default `false`), `label`, `model`, `mode`, `cwd`, `mcp`, `otelSink`, `timeoutMs`, and `signal`. Modes are `read`, `edit`, `auto`, and `yolo`, subject to provider support. `mcp` maps server names to `{ command, args?, env?, timeout? }`.

`spawn.retry(definition, options, retryOptions)` and `defaultRetry` use `{ maxAttempts, backoffMs, isErrorRetryable?, isRetryable? }`. `spawn.parallel(calls, options?)` accepts definition/options tuples or spawn-handle factories; options are `check`, `maxConcurrent`, `failFast`, and `signal`. Usage helpers are `createSpawnUsageAccumulator()` and `runWithSpawnUsageAccumulator(accumulator, operation)`.

**Config files.** `parseMcpConfig(json, directory)` accepts `servers` and the three numeric MCP limits, resolving stdio paths against `directory`. `parseFsConfig(json)` accepts `{ adapter: { type, options }, root?, cwd? }`; `resolveFsConfig(config, { registry? })` constructs the adapter for `makeFsModule`. Built-in types are `memory` and `real`; `real` requires an absolute host `options.root`. Outer `root`/`cwd` are absolute virtual paths. Custom registry descriptors supply `validateOptions` and `create`. Signals and injected functions are SDK options, not JSON fields.

</details>

<details>
<summary>Checkpoints and recovery</summary>

Guest functions with materialized own-property state, prototype-linked objects, and custom data descriptors are not portable checkpoint data. Dump, restore, and replay serialization reject these values instead of silently discarding their state. Data-copy boundaries also reject prototype-linked objects and custom descriptors; pass a plain projection such as `{ value: counter.value }` to host operations. Bridged callbacks retain their function identity and properties while the run is alive.

- `dump(resultOrRunningPromise, { mode?, onFailure? })` returns checkpoint JSON. `mode` is `capture` or `replay`; `onFailure` is `throw` or `checkpoint`.
- `restore(snapshot, { source })` validates state for compatible source; pass it as `run`'s `snapshot` option. It does not run the program.
- `new FileSnapshotBackend(path, { writeMaxAttempts?, writeRetryDelayMs? })` defaults to 3 write attempts and a 100 ms retry delay.
- `createReplayableRandom({ seed?, snapshot? })` supplies `next`, `seed`, `snapshot`, and `restore` for reproducible random sequences.
- `declareHostOperation(fn, policy, { onReplay? })` declares `re-issue` or `read-side-effect` recovery policy. `registerPendingHostCallPolicy({ moduleId, operation, policy })` registers it by name. Only mark operations re-issuable when repeating them is acceptable; a declaration does not implement deduplication or external recovery.
- `inspectSnapshotMigration(snapshot, { source })` inspects outstanding work. `migrateSnapshot(snapshot, { source, targetSource, state, reconciliation })` creates a continuation checkpoint. Reconciliation supplies `checkpointDigest`, `quiescent`, and `calls`; each call has `callId` and disposition `not-performed`, `fulfilled` with `value`, or `rejected` with `reason`.
- `migrateSnapshotFile(options)` accepts `snapshotPath`, `sourcePath`, `targetSourcePath`, `planPath`, `outputPath`, `inspect`, `dryRun`, and `cwd`. Inspect mode needs the checkpoint and original source; migration also needs the target, plan, and new output path. See [continuation migration](MIGRATION.md) before changing a checkpointed program.

</details>

<details>
<summary>Harness files and command line</summary>

`runHarness(filepath, options)` reads `.safejs`, `.ajs`, or Markdown executable blocks. Required `modulesFor(frontmatter, { filepath, kind, version })` supplies capabilities. Optional fields: `budget`, `otelSink`, `signal`, `snapshotBackend`, `snapshotIntervalMs`, `snapshotPath`.

`runHarnessPair(filepath, options)` uses the same options for a Markdown/`.ajs` pair. The script exports a default arrow function accepting `frontmatter`; Markdown body and metadata are available through `import.meta`. Loader helpers are `splitFrontmatter(markdown)`, `extractBlock(markdown, startLine?)`, and `findExportedConstInitializer(module, name)`.

The bundled runner is `npx poe-safe-js <script.md|script.safejs|script.ajs>` (`poe-safejs` is an alias). It lints before execution and uses **stub agents and metrics**, not real agent runs. Try the [pipeline](examples/pipeline.md), [superintendent](examples/superintendent.md), or [experiment](examples/experiment.md) shapes; use your own host modules or `poe-code harness run` for real integrations.

| Flag | Purpose |
| --- | --- |
| `--fix` | Write available lint fixes before running. |
| `--fs`, `--fs-root <path>` | Enable real filesystem access, rooted at the script directory by default. `--fs-root` requires `--fs`. |
| `--fs-config <path>` | Filesystem JSON config; cannot be repeated or combined with `--fs`/`--fs-root`. |
| `--env-config <path>`, `--mcp-config <path>` | Explicit environment/MCP JSON grants. These integrations are real, not stubs. |
| `--snapshot <path>`, `--restore <path>` | Save state or load a checkpoint; interrupt capture is best-effort. |
| `--max-steps <n>`, `--data-size <n>` | Interpreter budget limits. |
| `-h`, `--help` | Usage and exit codes. |

`migrate` takes a checkpoint path plus `--from`, and either `--inspect` or `--to`, `--plan`, `--output`, with optional `--dry-run`.

For embedding, `runCli(argv, options?)` comes from `@poe-platform/safe-js/cli`. Options: `cwd`, `env`, `mcp`, `modulesFor`, `process`, `readFile`, `stat`, `stdout`, `stderr`, `writeFile`. Its `modulesFor` callback also receives `{ stdout, stderr }`. Do not combine SDK `env`/`mcp` options with their config-file flags.

</details>

## Development status

### Latest local changes — September 9, 2026

`npm run typecheck:fs --workspace=@poe-code/safe-js` checks the filesystem option
contract in NodeNext and Bundler modes, each with and without DOM types. Both
package `npm test` and `npm run test:unit` run it automatically in their pretest
steps, alongside Intl data generation. It reports 25 structural cases per mode
separately from runtime unit-test totals; no compiler diagnostics are cached.

These fixes are committed locally, not verified on remote main or released:

- Public dumps preserve supported buffer subclass instances, custom prototypes
  and accessors for replay. Native accessor execution remains rejected.
- `DataView.prototype` and `SharedArrayBuffer.prototype` constructor bindings are
  nonwritable; their prototype objects remain mutable.
- `Number.parseInt` and `Number.parseFloat` initially reference the same functions
  as their global counterparts. Each realm gets fresh parser functions, including
  when a budget is reused. Parser lengths and 32 other audited built-in function
  lengths now match native controls, including bound-function lengths.

The parser fix passed 1,896 isolated tests; the subsequent function-length fix
passed 179 focused tests. Both passed the maintained workspace build and scoped
lint. These checks exclude pending weak-reference and cross-realm prototype
work and do not establish a green full-worktree gate. Host-Promise property
admission and workload-test timeouts remain unresolved. See the
[current gap inventory](../../docs/plans/safejs-current-gap-inventory-2026-09-09.md)
and [metadata validation record](../../docs/plans/safejs-standard-builtin-metadata.md).

Pushes and releases remain on hold. The historical results below apply only to
their stated candidates, not to the complete current checkout.

### Earlier changes and validation

The current local work adds guest-only `Function`, `AsyncFunction`,
`GeneratorFunction`, and `AsyncGeneratorFunction` constructors. They parse and
execute code inside SafeJS, retain execution budgets, and use the granted global
environment rather than capturing caller-local variables or invoking host eval.

```js
// Current source checkout; not yet a released-package guarantee.
const result = await run("return Function('a', 'b', 'return a + b')(2, 3)");
// result.returnValue: 5
```

Related local changes cover non-strict `this`, mapped `arguments`, `with`
environments and `Symbol.unscopables`, strict assignment checks, named-function
self-bindings, escaped/contextual identifiers, and loop grammar. Dynamic source,
captured bindings, and suspended generators have focused checkpoint coverage.
Identifier calls again pass through replay bookkeeping, fixing a reproduced
compatibility regression in historical Promise checkpoints.

Recent compatibility fixes also cover Array prototype unscopables, restricted
function and strict-arguments accessors, the Promise prototype tag, and
`Object.prototype.toString` after collection or typed-array tags are deleted.
These have focused native-comparison and checkpoint tests.

Guest `eval` remains in progress locally. Focused coverage now includes direct
and indirect calls; block, branch, try, loop, switch and `with` completion values;
lexical declaration conflicts; function hoisting and global declaration rules;
and class-initializer restrictions on `arguments`. Retained eval source is
budgeted, with recovery coverage for closures, classes, generators, tagged
templates and captured declaration environments. This is not complete eval
conformance; further declaration edge cases and integration still need validation.

Later local fixes cover deletion of eval-created bindings, assignment and numeric
updates after conversion deletes a binding, and separate environments for eval
inside default parameters versus function-body declarations. Focused checks cover
captured closures, destructuring and suspended assignments through recovery.
Some edge-case expectations follow the specification where Node 22 differs;
these are not claims of exact native-engine equivalence.

The local CLI lint gate now accepts guest `Function` and `eval` without lint
suppression. Direct eval no longer marks the bindings it can access as unused;
indirect and optional eval retain ordinary unused-binding checks. Focused CLI
tests confirm nested dynamic execution and unavailable Node host globals.

Exception-flow work adds function hoisting and class temporal-dead-zone handling
inside try/catch/finally blocks, including restored generators. Unresolved reads,
calls and updates inside these blocks now reach guest catch handlers as
`ReferenceError` values. The locally committed Promise repair preserves guest
`ReferenceError` instances and shared rejection identity through handlers and
checkpoint recovery, with coverage for executors, async functions, thenables and
pass-through reactions. Bare unhandled missing names still return the public
diagnostic envelope. Catch/finally normalization is also locally committed.
The source-stack repair preserves the offending guest location through catch
and Promise checkpoint recovery without copying private native host stacks.
These checks do not establish that every error path is JavaScript-equivalent.

A separate local performance fix avoids allocating empty intrinsic-retention
arrays when no changed values need retaining. Required descriptor scans,
callback order and execution budgets are unchanged. Focused allocation and
workload checks pass; this is not a guarantee that deadline-sensitive tests
always pass under load.

Dynamic functions/eval and the CLI lint follow-ups are now locally committed.
Their isolated candidate passed all 23 maintained builds, four fresh-process
import checks, and 22,765 unit tests with 37 skips across 839 files on September
8, 2026. This candidate excludes experimental weak collections and unresolved
host-Promise property-import work; it does not establish complete JavaScript
conformance or a passing integrated main worktree.

An earlier integrated main run passed 22,788 tests, failed two and
skipped 37 across 840 files. It includes the later eval numeric-update and
parameter-environment fixes, but predates the CLI lint follow-ups.

Both failures concern host-Promise property imports. Their policy remains
unresolved because native properties can contain private Node.js context data.
Earlier workload deadlines and historical checkpoint expectation failures did
not recur in this run. See the
[validation record](../../docs/plans/safejs-dynamic-validation-result-2026-09-08.md)
for the exact snapshot and scope.

The restricted function-prototype accessor repair is independently committed
locally, with 101 focused tests plus TypeScript and lint passing. The related
strict-arguments descriptor bridge is also locally committed, with 237 focused
tests plus TypeScript and lint passing; neither status implies
remote delivery or complete function compatibility.

`Proxy` and `Proxy.revocable` are available in the locally committed runtime.
Lint recognizes the Proxy global, including the CLI's default lint gate, and
warns when a local declaration shadows it.
Proxy support remains incomplete. Checkpoint graphs now preserve Proxy targets,
handlers, aliases, cycles, callable/constructible identity, and revocation state.
Revokers retain their own properties and release their target after use. Focused
tests cover restore across an await, bound calls, private fields, and suspended
`for-in` generators; this is not proof of every checkpoint/trap interaction.
Internal tests inject proxies to exercise
property reads/writes, membership/deletion, own descriptors, key enumeration,
prototype/extensibility operations, and their invariants. Object reflection,
ownership predicates, `isPrototypeOf`, legacy accessor lookup and `__proto__`,
`Object.assign`, descriptor maps for `Object.create` and
`Object.defineProperties`, and object spread/rest now dispatch those operations.
Ordinary enumeration also handles existing string/symbol properties made
enumerable by an earlier getter.
Ordinary `for-in` includes enumerable non-index string properties on arrays and
array ancestors, including when a generator resumes from a checkpoint.
Internal Proxy `for-in` now uses own-key, prototype, and descriptor operations,
including virtual keys, inherited properties, deletion, and early loop exits.
The saved key-list format is unchanged.
Array methods now await Proxy membership and deletion traps on array-like
receivers, with ordered writes and tested partial failures. Their internal view
no longer reads a guest `then` property. Species selection recognizes wrapped
arrays, including nested Proxies and array subclasses. Proxy-valued species
results receive element definitions through `defineProperty` traps, with failures
stopping further writes. Concat spreads wrapped arrays by default and honors
`Symbol.isConcatSpreadable` overrides. `flat` and `flatMap` traverse wrapped nested
arrays, snapshot each nested length, and honor depth limits while skipping holes.
Internal callable Proxies support direct, bound, callback, and Reflect.apply
invocation, including apply traps and target forwarding. Revocation preserves
callable identity but rejects calls. Constructible Proxies support construct traps,
target forwarding, and explicit `new.target`, including subclass construction.
Exported SDK `Reflect.construct` also preserves explicit constructor identity
through ordinary, bound, and Proxy targets, including accessor-backed traps.
SDK-created bound functions also retain explicit `newTarget` through nested
bindings while preserving the normal default-constructor substitution.
SDK ArrayBuffer and typed-array construction reads Proxy `newTarget.prototype`
through guest operations, including nested Proxies, accessor-backed traps, and
revocation checks.
SDK buffer `slice` species lookup also follows Proxy holders and ancestors,
preserving the receiver and invoking Proxy-valued species constructors.
Direct SDK typed-array `slice`, `subarray`, `map`, `filter`, `toReversed`,
`toSorted`, and `with` calls preserve intrinsic prototypes on default results,
including calls made after the originating run has completed.
SDK typed-array construction also retains its intrinsic prototype fallback when
`newTarget.prototype` is a primitive, after the originating run has completed.
Constructed typed arrays preserve their originating guest prototype after run
cleanup, including later mutations to that prototype. Data-only copying and
replay accept pristine default chains but reject modified chains that would
otherwise lose guest behavior.
Array literals also retain their originating prototype, including literals
created by exported closures after run cleanup. Their later prototype mutations
remain visible to SDK iteration.
Arrays created by `Array` or `new Array` also preserve their originating
prototype when inspected through another realm's SDK methods.
Array `toReversed`, `toSorted`, `toSpliced`, and `with` results retain their
originating prototype after SDK cleanup, including borrowed array-like calls.
They continue to ignore species constructors and copy holes as undefined.
Default results of species-aware array methods also preserve their originating
prototype for borrowed array-like calls, undefined constructors, and null
species. Explicit custom species results retain their own identity/prototype.
Built-in string and RegExp splitting preserve the result array's originating
prototype after SDK cleanup, including empty results and limits. Custom
`Symbol.split` hooks retain their returned value and receive the original
receiver before fallback string coercion.
Built-in `exec`, `match`, and `matchAll` match arrays retain their originating
prototype, including indices arrays and capture-index pairs. Named capture
metadata stays null-prototype and preserves index aliases. Custom match hooks
and custom non-global `exec` results retain their own identity.
Object reflection lists and `Reflect.ownKeys` preserve their originating array
prototype, including `Object.entries` pairs and synchronous SDK Object calls.
Existing values keep their identity and prototypes; Proxy reflection retains
its key filtering and descriptor behavior.
Exposed Object/Reflect property descriptors and the outer
`Object.getOwnPropertyDescriptors` result preserve their originating Object
prototype. Descriptor values and accessor functions retain identity, and
reflection does not invoke those getters.
JSON parsing retains the originating prototypes of parsed objects and arrays,
including nested containers, reviver holders, and reviver context objects.
Reviver replacements retain their own identity and prototypes; deletion and
special-key data properties keep their native behavior.
`Object.groupBy` and `Map.groupBy` bucket arrays retain their originating
Array prototype after SDK cleanup. Group keys and elements retain identity,
and the outer Object grouping result remains null-prototype.
Array, typed-array, Map, and Set entry iterators preserve the originating
Array prototype of each new entry pair. Keys and values inside those pairs
retain identity; values-only iteration does not re-prototype payload arrays.
`Iterator.prototype.toArray` retains the method's originating Array prototype
for empty and non-empty results, including SDK calls with foreign iterators.
It checks the `arrayLength` budget before appending each collected value,
including direct SDK calls.
Collected values keep their identity and prototypes.
Array, typed-array, Map, Set, and string iterator `next()` result objects
retain the method's originating Object prototype, including exhausted results
and borrowed SDK calls. Yielded values are not re-prototyped.
Lazy iterator helpers preserve the called next/return method's Object
prototype through yielding, early return, exhaustion and public replay.
Following the ECMAScript 2027 draft, `take` and `drop` reject finite limits
above `Number.MAX_SAFE_INTEGER` and close the input before reading `next`.
Positive `Infinity` remains accepted; fractional limits are truncated.
`Iterator.concat(...inputs)` captures each input's iterator method immediately,
then opens and consumes inputs sequentially on demand. Early return closes
only the active input. Unopened inputs and active cursors participate in data
accounting and snapshot recovery. Primitive inputs, including strings, are
rejected; pass an iterable object instead.
`Iterator.zip(inputs, options)` and `Iterator.zipKeyed(inputs, options)` support
`shortest` (default), `longest`, and `strict` modes from the ECMAScript 2027
draft. Longest mode accepts iterable padding for `zip` and keyed padding for
`zipKeyed`. Inputs are opened eagerly and advanced lazily; keyed rows have null
prototypes and include enumerable own string and symbol keys. Retained cursors,
padding, and keys participate in data accounting and snapshot recovery.
`Promise.any` rejection errors expose a writable, configurable, non-enumerable
`errors` property, including empty input and public replay. Rejection elements
retain their identity.
Error constructors called through exported closures after cleanup retain their
originating prototypes and non-enumerable fields. Error, Number, String,
Boolean, Object, Array, Date, RegExp, Map, and Set constructors select default
prototypes from a foreign newTarget's originating realm. Explicit custom
newTarget prototypes remain supported. Focused checks cover ordinary, bound,
bound-class and Proxy targets, plus replay and calls after cleanup.
Ordinary function and class construction also uses the newTarget realm's
Object prototype when its `prototype` property is not an object, including
derived classes and field initialization.
ArrayBuffer, DataView, and typed-array constructors likewise use foreign
newTarget realm defaults. Focused checks cover native typed-array types,
Float16Array, replaced global bindings, and target replay after cleanup.
Intl constructors use namespace-qualified defaults from the newTarget realm,
including after replacing the `Intl` global binding or replaying the target.
Revocation during prototype lookup is checked before locale/options processing.
Exported non-strict functions and eval calls retain access to their runtime
global and owning eval identity after cleanup, including public replay and a
replaced `globalThis` binding. Snapshot-resolution tables are still released.
Foreign eval executes in its owning realm: global writes and declarations stay
there, caller locals remain inaccessible, and errors use the owning prototypes.
Focused checks cover normal, indirect and optional calls and independent replay.
Dynamic Function, AsyncFunction, GeneratorFunction and AsyncGeneratorFunction
constructors use foreign newTarget prototype defaults without changing the
function body's originating global environment. Focused checks cover execution
and independent replay of the factory and target realms.
Borrowed dynamic constructors compile their bodies in the constructor owner's
global environment, not the caller's. Global writes stay in that owner realm;
neither the caller's locals nor the owner script's private locals are captured.
Ordinary, async, arrow, class and built-in functions retain their owning
Function/AsyncFunction prototype after cleanup. This also preserves inherited
properties and later binding operations; explicit null/custom prototypes win.
Reusing a budget for a new realm starts a fresh function-prototype table while
existing function objects retain their original prototype defaults.
Borrowed eval and dynamic constructors also select their saved execution context
by intrinsic realm identity, so a reused budget does not select an earlier run.
Foreign intrinsic calls receive their owner's compilation context. Borrowed
RegExp construction and recompilation therefore preserve ownership checks
without rejecting valid cross-realm calls, including bound/Proxy calls and replay.
Errors created by foreign intrinsics use the owner's error prototypes, including
asynchronously implemented calls. Already-captured caller errors retain their
identity and prototypes when propagated through those calls.
`AggregateError.errors` retains the constructor realm's Array prototype,
independently of a custom prototype supplied for the Error object.
Promise construction, async returns and `then` results retain their
originating Promise prototype after cleanup.
Promise construction honors foreign newTarget default prototypes, including
bound and Proxy targets and replay. Prototype lookup failures occur before
the executor is invoked; invalid executors are checked before prototype lookup.
Iterator subclass construction and both disposable-stack constructors use the
foreign newTarget realm's default prototype when its prototype is not an object.
This includes bound and Proxy targets after cleanup and replay; explicit custom
prototypes still win, and stack instances retain working disposal state.
Borrowed `then`, `resolve` and `reject` calls respect a foreign intrinsic
constructor instead of allocating in the method's realm.
Promise aggregate arrays, `allSettled` records and `withResolvers` capability
objects retain the method's originating prototypes, including public replay.
Their payload values retain identity and custom prototypes.
`finally` cleanup respects foreign Promise species and preserves observable
overridden `then` calls and cleanup Promise prototypes.
`Iterator.from` fallback return results retain the called method's Object
prototype when the underlying return method is absent or null. Custom next
and return results are forwarded unchanged.
Synchronous generators preserve delegated `yield*` result identity, including
Proxy results, without eagerly reading their `value` property. Ordinary yields
retain the generator realm's Object prototype; completed synchronous results
use the called method's realm. Async generators retain the execution realm for
body results and requests drained at completion, while later calls on a finished
generator use the called method's realm. Focused checks cover borrowed calls,
queued requests and public replay. The generator/snapshot validation run passed
1,944 tests; this is focused evidence, not a full JavaScript conformance claim.
RegExp iterator results follow the same rule for built-in and custom `exec`
paths, including non-global matching. Custom match results retain identity.
For `RegExp.prototype[Symbol.matchAll]` iterators, borrowed `next` calls
distinguish the outer result's method realm from the match array's `exec`
realm, including capture-index arrays.
Default constructed matchers retain their RegExp prototype after cleanup.
String `matchAll` also retains the internal matcher's realm for string,
omitted, and coercible-object patterns, including borrowed iterator calls.
Object literals retain their originating prototype after cleanup and when
created later by exported closures. Explicit null prototypes stay null;
modified prototype chains reject lossy data copying. `Object.fromEntries`
results also preserve their originating prototype, including synchronous SDK
adapter calls. `Object()` and `new Object()` with null or missing arguments
retain their creation realm, while existing object inputs keep their identity.
Object and array destructuring rest results also retain their originating
prototype, including assignment and parameter patterns used by exported
functions after run cleanup.
Function rest-parameter arrays retain the function's originating array
prototype as well, including calls made through exported SDK functions.
Number, String, and Boolean construction and primitive `Object(value)`
wrappers retain their originating prototypes after cleanup. Pristine wrappers
remain copyable as data; modified prototype chains reject lossy copying.
Boxed prototype mutation records are counted once when their owner is also
reachable through a wrapper, without raising cleanup-test budget limits.
Dates retain their originating prototype after run cleanup, including Dates
created later by exported closures. Pristine Dates remain copyable as data;
modified prototype chains reject copying rather than losing guest behavior.
Array member calls also accept guest-defined own and inherited methods; missing
or non-callable members fail the normal callability check.
Direct SDK `Iterator.from` accepts strings after run cleanup, using the
originating guest String prototype. Getter and Proxy-ancestor reads preserve
the primitive receiver, including later guest iterator overrides.
SDK typed-array input conversion follows Proxy reads and calls for array-like
inputs, iterator factories, iterator objects, and result objects. Iterator
acquisition also observes methods supplied by Proxy traps or Proxy ancestors,
including async iteration and its synchronous fallback.
Direct SDK `TypedArray.from` calls observe Proxy inputs, mapping callbacks, and
constructor receivers, preserving mapper `this` and index arguments.
Direct SDK `TypedArray.of` calls support Proxy constructor receivers and element
conversion hooks. Primitive conversion observes Proxy hooks and Proxy ancestors
instead of treating their private carriers as ordinary objects.
Direct SDK `Iterator.from` and its wrapper methods dispatch Proxy iterator
factories, iterator objects, and methods through guest operations. Wrappers cache
`next`, read `return` lazily, and preserve iterator receivers and revocation checks.
SDK Iterator subclass construction observes Proxy `newTarget.prototype` reads,
including nested/accessor-backed traps, and rejects revoked constructor targets.
SDK iterator disposal observes Proxy `return` lookup and invocation with the
original receiver, including inherited accessors and revoked methods.
SDK eager iterator consumers (`toArray`, `reduce`, `forEach`, `some`, `every`,
and `find`) observe Proxy receivers, methods, result objects, and callbacks,
including iterator closing on early return or callback failure.
SDK lazy iterator helpers (`map`, `filter`, `take`, `drop`, and `flatMap`) also
dispatch Proxy operations during creation, advancement, and closing. `flatMap`
closes active inner and outer Proxy iterators in the tested native order.
Public Proxy binding reads the prototype and own length descriptor through traps
before reading length and name, including null prototypes and nested Proxies.
Promise operations dispatch Proxy constructors, executors, reaction callbacks,
callable thenable hooks, and overridden `then` methods used by `catch`/`finally`.
Promise resolution also reads `then` through Proxy traps, preserving the receiver,
read/call ordering, and rejection on trap errors or revocation. Nested and
callable Proxies, callback/async returns, and checkpoint recovery have focused
coverage. Inherited `then` lookup also reaches Proxy ancestors with the original
receiver; an own `then` property stops lookup before a revoked Proxy ancestor.
Proxy-valued `then` getters retain guest call context, including inherited and
nested getters, thrown trap errors, and checkpoint recovery.
Promise adoption also leaves the intrinsic fast path when `then` lookup reaches
a Proxy ancestor of the shared Promise prototype.
Constructor and species reads follow Proxy ancestors with the original receiver,
including trap errors, custom species selection, and own-property shadowing.
Other host-boundary interactions still need auditing.

`Array.isArray` follows nested Proxy targets without invoking traps and rejects
revoked proxies. Other internal array-identity consumers still need integration.
`JSON.stringify` recognizes wrapped arrays and replacer arrays, enumerates Proxy
objects through key and descriptor traps, and invokes callable Proxy replacers
and `toJSON` hooks. Focused native comparisons cover trap ordering, length
coercion, mutation during enumeration, cycles, and revocation.
`structuredClone` rejects Proxy values with `DataCloneError`, including nested
and revoked Proxies, without invoking traps or detaching transfer buffers.
This follows native clone behavior; it is separate from Proxy checkpoint support.
Object.prototype.toString reads custom tags through non-callable Proxies and
preserves wrapped-array identity. Ordinary receivers also read inherited tags
through Proxy ancestors with the original receiver. Callable Proxies use the
`Function` fallback tag while honoring custom tags and rejecting revoked Proxies.
Ordinary-constructor `instanceof` checks follow Proxy prototype chains, including
bound constructors. Native comparisons also cover callable Proxy constructors,
custom `Symbol.hasInstance`, revocation, and wrapped Array, Map, Error, and
Uint8Array instances. These cases pass without further runtime changes; they do
not establish conformance for every built-in or host constructor.

The later internal freeze/seal implementation now prevents target extension and
updates properties through Proxy traps, with tested ordering and partial-failure
behavior. Integrity queries (`Object.isFrozen` and `Object.isSealed`) also use
Proxy extensibility and descriptor operations, with tested early exits.

At source commit `f71a86152`, the internal Proxy selection passed 388 tests across
24 files. This is not a full-package gate or evidence of public Proxy support.
The snapshot suite subsequently passed 1,692 tests across 127 files, including
28 Proxy graph tests. Host boundaries and
remaining array species/identity consumers still need integration.
See the [Proxy progress record](../../docs/plans/safejs-proxy-progress.md) for
the tested scope and remaining work.

The latest working-tree gate includes the generator result-realm and
synchronous yield-star forwarding fixes. It passed 24,368 tests, failed three,
and skipped 37 across 950 files. The discovered inputs retained their source/test
fingerprint; three later regression files were checked separately.
Two failures concern native Promise own-property imports, whose admission
policy remains unresolved. The third exposed unnecessary result-prototype
retention in internal async-function frames. Restricting that metadata to
actual async generators passes 1,955 generator, snapshot and accounting tests,
plus lint, TypeScript and build checks. This is not a green full-package
gate or an isolated committed-tree result.
See the [full gate record](../../docs/plans/safejs-realm-lifetime-full-gate.md).
The public data-copy boundary now rejects guest Proxy values explicitly instead
of silently producing empty objects. Use an owning realm's retained guest
references to preserve identity and trap behavior; explicit callable wrappers
remain available. Transparent Proxy export is not implemented.
Host and realm callback bridges now dispatch callable Proxies through guest
operations, including nested Proxies, accessor-backed traps, async targets,
revocation, and checkpoint recovery. Both callback routes preserve explicit
receivers. Raw host callback replay stores receivers and arguments in one graph
to preserve aliases. Receiver-bearing records use host replay version 2;
argument-only histories retain version 1, and both versions are accepted.
Re-issued callbacks reject changed receivers as well as changed arguments.

Experimental work remains uncommitted. Pushes and releases are paused; local
implementation, remote delivery, and successful publication are separate
milestones.

WeakMap/WeakSet work remains experimental. It was included in the historical
integrated main run described above, not the isolated dynamic/eval candidate.
Portable weak-symbol lifetime support on Node.js 18 remains unresolved. Do not
treat that work as complete weak-collection support.

Experimental, uncommitted `WeakRef` and `FinalizationRegistry` implementations now
have focused coverage for job-scoped target retention, held-value budgets,
owner-scheduled cleanup, cancellation, and heap snapshot restoration. Cleanup
errors are reported to the owning run or persistent realm. These changes are not
released or fully validated: unique-symbol weak references still fail on older
Node.js 18 runtimes, and low-level registry restoration requires an execution
owner with error reporting. The snapshot and selected weak-reference checks pass
1,806 tests across 138 files; this is not a full-package or conformance result.

## Meaningful limitations

Temporal support is partial and uncommitted. The local runtime provides owned
`Temporal.Instant` and `Temporal.Duration` values with focused snapshot,
replay and host-copy coverage. Instant differences (`until`/`since`) return
Durations. The remaining six Temporal classes and `Temporal.Now` are absent;
Instant locale/zoned conversion and Duration comparison, rounding and totals
are still missing. Host Temporal subclasses and arbitrary foreign-realm
instances are not generally supported. This is not complete Temporal support
or a claim about the released package.

The [September 9 gap inventory](../../docs/plans/safejs-current-gap-inventory-2026-09-09.md)
separates current API presence from behavioral, recovery and validation gaps.
It includes newer native APIs that are still proposals; matching a native
property list is not proof of JavaScript conformance.

The unreleased runtime also provides `Map.prototype.getOrInsert(key, value)`
and `getOrInsertComputed(key, callback)`. These newer compatibility methods
preserve existing values and use collection budgets for insertions; computed
defaults run only for missing keys. The corresponding WeakMap methods remain
unimplemented. See the [validation record](../../docs/plans/safejs-map-upsert.md).

The unreleased runtime supports `Atomics` integer operations on ordinary
ArrayBuffer-backed typed arrays, including BigInt views. Experimental,
shared-memory work adds fixed/growable `SharedArrayBuffer`, typed
array and DataView aliases, shared structured cloning, and `waitAsync`/`notify`.
Focused tests cover direct shared-buffer snapshot and replay-data round-trips,
including shared growth and distinct wrapper identities. Host-boundary transport
remains under review. Pending waits inside a run now use a per-run Node worker;
run completion or cancellation awaits worker termination, removing that run's
native wait registrations without notifying unrelated waiters. Standalone
intrinsic calls without a run lifecycle retain native waiter lifetime.
Focused async-wait tests cover
timeouts, notification order, await cancellation, and pending source replay.
The low-level heap restorer additionally preserves pending wait state and exposes
`await restored.activateAtomicWaits()` to register those waits before restored
guest closures are used. Focused tests cover FIFO order, BigInt offsets, remaining
timeouts, re-checkpointing before activation, and run-owned cleanup. This internal
activation API is distinct from the public SDK's source-replay restore path;
these checks do not establish deterministic timeout replay or arbitrary concurrent
shared-memory recovery;
do not treat this as complete shared-memory support. Synchronous `Atomics.wait`
cannot block the sandbox's host event-loop agent. Non-shared waits reject, and
`notify` returns zero for valid non-shared views.

The local `Atomics.pause()` implementation follows the current 2027 draft:
it returns `undefined` and ignores arguments and the receiver. It sends a native
CPU spin-wait hint when available and otherwise performs no timing operation;
both paths charge the step budget. It is not a sleep or an event-loop yield.

Managed shared-buffer host round-trips are being integrated. Focused checks now
cover isolated settlement-time bytes, replayed argument aliases, and host writes
and growth even when no shared buffer is returned. Experimental journal-wide
tracking now passes focused replay tests for later mutations through retained
arguments and host-returned buffers, including growth and synchronous or
asynchronous calls. Capture ordering prevents older buffer images from
overwriting newer effects. Further concurrency, callback, and budget-failure
audits remain; shared host-call history is not yet fully verified.
Async replay separates invocation-time shared writes from final settlement
effects. Focused tests cover two-stage growth, pending-call prefixes, and an
intermediate write observed through another host checkpoint. Arbitrary
intermediate async visibility is not yet fully verified.

- **Not a full JavaScript engine.** Complete `eval` conformance is unproven. `WeakRef` and `FinalizationRegistry` are experimental local work with the limitations above. Shared-memory and Proxy support are incomplete as described above; host-boundary integration remains incomplete. There is no ambient DOM or general Node API, nor automatic multi-file/npm resolution. See the unreleased and experimental features above; lint success is not a runtime compatibility guarantee.
- **Regular expressions are bounded.** The guest engine supports `d`, `g`, `i`, `m`, `s`, `u`, `v`, and `y`, including lookaround, backreferences, named groups, and Unicode property escapes. Compilation and matching still enforce limits; this is not an unbounded native-RegExp escape hatch or a claim of complete conformance.
- **Budgets are not hard resource isolation.** Limits govern interpreter work, not arbitrary host functions or total process memory. Deadlines are checked cooperatively; cancellation cannot forcibly stop a blocking host call or undo its effects. Add host-operation timeouts and external isolation where required.
- **Recovery is not exactly-once delivery.** Replay can repeat work and consumes budget again. Pending side effects need external reconciliation; opaque host handles and native iterator frames are not portable checkpoint state. Keep compatible source for ordinary restore or explicitly migrate. Checkpoints can contain input data and host results: store them as sensitive data.
- **Filesystem access is a grant, not an OS sandbox.** The helper is a subset of `node:fs/promises`, with text-oriented results and no file handles, streams, or Buffer API. Root checks do not isolate the process from concurrent filesystem changes. Prefer narrow host operations when a script only needs a few files.
