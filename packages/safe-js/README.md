# SafeJS

Run a JavaScript subset with explicit host capabilities, execution budgets, and resumable checkpoints.

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

- **JavaScript control flow:** functions and closures, async/await, loops, destructuring, spread, templates, exceptions, and synchronous generators.
- **Guest function objects:** own properties on functions and arrows; ordinary constructors with shared prototypes, inherited methods and `instanceof`. `Object.create`, `getPrototypeOf`, `setPrototypeOf`, own-property inspection, and data descriptors work on ordinary sandbox records.
- **Data processing:** arrays, objects, strings, numbers, JSON, Math, Date, Map, Set, Float32Array, promises, and a bounded regular-expression subset. These are selected APIs, not complete ECMAScript implementations.
- **Explicit capabilities:** named, default, and namespace imports resolve against host-supplied modules. Optional helpers cover agents, MCP tools, files, environment reads, time, logging, and metrics.
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

Properties stay inside the interpreter, not on native host functions. Arrows and object methods remain nonconstructible. Prototype links between callable or exotic objects (such as arrays) and accessor descriptors are unsupported; native `Function.prototype` is never exposed.

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

Inherited accessors, symbols and full Array/Function/exotic prototype graphs are unsupported. Use borrowed Object methods for inspecting those supported values. Explicit prototype links and mutated Object intrinsics are not portable checkpoint/copy data; project own data before crossing those boundaries. The conservative `AS011` lint rule still flags explicit `prototype`/`constructor` access; `run()` executes it without automatic linting.

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

Unsupported: locale formatting, legacy `getYear`/`setYear`/`toGMTString`, subclassing, custom argument coercion, Date-instance own properties and prototype modification. These are restrictions, not stubs; no native constructor or prototype is exposed to guest code.

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

## Meaningful limitations

- **Not a full JavaScript engine.** No async generators, dynamic imports, or automatic multi-file/npm resolution. No browser build, DOM, general Node API, `eval`, or `Function` constructor. Ordinary guest constructor prototypes are supported, but native and exotic prototype chains are not. Built-in coverage is selective; lint success is not a runtime compatibility guarantee.
- **Some familiar syntax differs.** Regex supports `g`, `i`, `m`, and `s`, but not lookaround, backreferences, named groups, Unicode property escapes, or other flags. Compilation and matching have fixed limits in addition to configured budgets.
- **Budgets are not hard resource isolation.** Limits govern interpreter work, not arbitrary host functions or total process memory. Deadlines are checked cooperatively; cancellation cannot forcibly stop a blocking host call or undo its effects. Add host-operation timeouts and external isolation where required.
- **Recovery is not exactly-once delivery.** Replay can repeat work and consumes budget again. Pending side effects need external reconciliation; opaque host handles and native iterator frames are not portable checkpoint state. Keep compatible source for ordinary restore or explicitly migrate. Checkpoints can contain input data and host results: store them as sensitive data.
- **Filesystem access is a grant, not an OS sandbox.** The helper is a subset of `node:fs/promises`, with text-oriented results and no file handles, streams, or Buffer API. Root checks do not isolate the process from concurrent filesystem changes. Prefer narrow host operations when a script only needs a few files.
