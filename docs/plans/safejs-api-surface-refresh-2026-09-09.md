# SafeJS API surface refresh — September 9

Read-only comparison at local `b4613fcbc`, using the freshly built core SDK and
Node v22.23.2 VM. This compares names and presence, not descriptors, algorithms,
symbols, inherited methods, isolation or snapshot correctness.

The 40 inspected globals were Object, Function, Array, Number, BigInt, Boolean,
String, RegExp, Date, Math, JSON, Reflect, Promise, Map, Set, WeakMap, WeakSet,
ArrayBuffer, DataView, the 12 numeric typed arrays including Float16Array, Intl,
Atomics, SharedArrayBuffer, WeakRef, FinalizationRegistry, Iterator,
DisposableStack and AsyncDisposableStack.

Still absent in SafeJS while present in this native VM:

- Atomics, including load/store, integer updates, wait/waitAsync and notify.
- SharedArrayBuffer, including growable shared storage.
- WeakRef and FinalizationRegistry.

RegExp lacks the native VM's legacy static match-state properties (`input`,
`lastMatch`, captures and aliases). Their normative status and the scope of
required legacy compatibility must be checked before treating them as a repair
requirement. No change was made based on this name-only difference.

All other native string-keyed own constructor and direct prototype names in
this bounded set were present. This is not a conformance result. Experimental
WeakMap/WeakSet changes remain uncommitted and unqualified; presence does not
resolve their semantics or replay requirements.

SafeJS also exposes APIs absent from this older host VM: RegExp.escape,
Math.sumPrecise/f16round, Promise.try, DataView float16 accessors, Uint8Array
hex/base64 methods, Float16Array, Intl.DurationFormat and both disposable stacks.
Those require specification-derived expectations or a newer native oracle;
absence from Node 22 does not make them invalid SafeJS additions.

The confirmed error-prototype and RegExp compilation-owner defects are tracked
separately in safejs-foreign-intrinsic-error-audit.md. README already names the
four unavailable globals; no README change is needed for this refresh.

No new implementation, push or release is claimed.

## Standards check after the intrinsic-parent candidate

The inventory above describes its historical baseline; current global-presence
status is tracked in `safejs-current-gap-inventory-2026-09-09.md`. A new bounded
Node 22 comparison of 30 globals/namespaces and their direct prototypes
(b86197) reported legacy RegExp statics, Error stack helpers and old Locale
information getters as missing names. Their dispositions are:

- RegExp statics remain a compatibility gap, but the
  [TC39 legacy-features proposal](https://github.com/tc39/proposal-regexp-legacy-features)
  identifies them as stage 3, not part of published ECMA-262. Do not classify
  their absence as a demonstrated ECMAScript 2026 conformance defect.
- `Error.captureStackTrace` and `Error.stackTraceLimit` belong to the
  [V8 stack-trace API](https://v8.dev/docs/stack-trace-api), not the portable
  language surface targeted by this comparison.
- Published [ECMA-402 2026 Locale methods](https://402.ecma-international.org/#sec-Intl.Locale.prototype.getCalendars)
  use `getCalendars`, `getCollations`, `getHourCycles`, `getNumberingSystems`,
  `getTimeZones`, `getTextInfo` and `getWeekInfo`. SafeJS implements these;
  adding Node 22's older getter names is not required to repair a missing
  standard method.

These classifications resolve name-only suspicions, not algorithmic
conformance. No runtime changes were made for them.
