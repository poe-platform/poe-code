# Independent HOST-ARRAY-METADATA validation

Date: August 29, 2026. Role: independent delegated worker, direct execution.

## Disposition

**READY for root review of the five-file HOST-only publication delta**, conditional
on separately approved prerequisites and exact ordered preimages. This is not
publication authorization, a CI smoke repair, or final published all-stack approval.

The unchanged 15-test fixture independently gives **10 failures / 5 passes** before
the fix and **15 passes** afterward through both source and public built entry
points. The default clean-projection full suite passes **25,873 tests / 41 skipped**
with 996 passing files and three skipped files. No test-timeout override, test
filter, private bundle instrumentation, or altered default configuration is used
for that full gate. This is one independent full run, separate from the author's
two full runs.

No production changes, additional tests, or assertion edits were authored by this
reviewer. The author test is already in the proper package test directory and uses
finite pure mocks, without unit disk writes or LLM calls. The only new publication
file is this report.

## Frozen inputs and projection

- Author manifest SHA-256: `002a32167def93d48b84117ff2f47b34c8cf1f99faccca9524c00542e5d5e9eb`.
- Frozen author base: `518def9bc43198efcd1da5a927e086fecd33a574`.
- New clone, pulled before review: `b06e79ab841765f06d0a577230f10db28f98c457`.
- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-host-array-metadata-independent`.
- Evidence: `out/safejs-remediation/host-array-metadata-independent`.
- Mutable projections/cache: `out/safejs-remediation/host-array-metadata-independent-cache`.

All **511 author artifacts** were checked by exact bytes and SHA-256. All **102
prerequisite base identities**, including absent paths, were checked against the
author base. Clean baseline and GREEN projections were constructed with
`git archive` of that base and the exact contextual prerequisite patches applied
through `apply_patch`. Every prerequisite postimage was checked. GREEN then applies
the exact four-file HOST delta; every one of its **104 distinct composite paths**
was checked. Baseline adds only the unchanged final HOST test to its prerequisite
source. Neither projection replaces production in the ordinary pulled checkout.

Both projections have owned copy-on-write dependency installations, with relative
workspace links resolving locally. No other clone is used for writable caches.
Source and built baselines are independently built before their RED checks.

The only prerequisite source difference from the older Map composite is the
already-published receiver change in `packages/safejs/src/interp/interpreter.ts`.
Its SHA `d3e317129835f99d75e6607f97fa49805504de3c6c003fe800c3684416bb8d8f`
equals both the author base and pulled main. It was not replaced by the older Map
interpreter. Relevant CTX controls pass within the 413 adjacent tests.

## Exact five-file publication delta

1. `packages/safejs/src/interp/host-bridge.ts`
2. `packages/safejs/src/interp/values.ts`
3. `packages/safejs/src/interp/host-array-metadata.test.ts`
4. `docs/plans/safejs-fix-host-array-metadata.md`
5. `docs/plans/safejs-validate-host-array-metadata.md`

Only the first two are production. The latter three have absent ordered preimages.
No Map, H5, PPR, or other prerequisite file belongs to this publication delta.

`host-bridge.ts` identities:

- Main preimage, 34,551 bytes: `e2c9519a3b4fb3ae4405fdf5aa5cf7fb29335c2236c0de2b995a6e4b5f149c5d`.
- Ordered preimage, 35,998 bytes: `4ee1fad8e50568478ab5cb0bc6923aa77c40a3811ba53c8d14c23c633bbfb1b4`.
- Postimage, 36,229 bytes: `4425eb05a4cfd552d640943ad99c5e92bddb606938718ea7a83cea969c9b13b1`.

`values.ts` identities:

- Main preimage, 26,444 bytes: `a453757823a826a5c533a5b13e44cdb2021783889e90601608bac932f5f3db86`.
- Ordered preimage, 26,580 bytes: `394b4b1d60d8cf54c100930dde1ae1b058961e86c524e11eee1de56ec2c2a84e`.
- Postimage, 26,594 bytes: `cb26ac566eaed9ade10ff5bafdd5454104bae2b62b8f76792dc4f4936313ced5`.

The unchanged test SHA is
`66cad71de25dc8ca1ed216f2581e581600981592bc054c8328fe17ad2b349d7d`
in author capture, baseline, and GREEN. All five final postimage identities,
both main preimages, both ordered preimages, and absent identities are explicit
in the delta-only manifest. Do not apply main preimages as if they were ordered
post-prerequisite preimages or overwrite newer publisher source wholesale.

## Boundary inspection

The original inbound array loop copied numeric indices only. The patch traverses
own property descriptors, preserving enumerable string-keyed own data as well as
the existing hidden-index behavior. It registers the destination in the existing
graph memo before recursion and continues charging array length.

- `Object.getOwnPropertyDescriptors` and descriptor values avoid reading array
  accessors. Array accessors are not invoked: enumerable accessor entries are
  rejected, and hidden named entries remain skipped.
- `defineOwnDataProperty` defines data directly, without assigning through an
  inherited setter or calling a shadowed array method.
- `isArrayIndexKey` preserves canonical-index classification; `01`, `-1`, `1.5`,
  and `4294967295` remain named properties. Named key strings are budgeted, while
  synthesized numeric index strings are not newly charged.
- Existing graph memoization preserves aliases, cycles, Map keys/values, Set
  membership, sparse presence, explicit undefined, and custom array metadata.
- Existing native-function/proof-function provenance branches are unchanged.
  The `values.ts` change is exactly two `export` keywords on existing helpers;
  both helper bodies, generic function guards, G01 measurement, and PPR1 promise
  memoization are byte-identical.

These are source inspection and bounded benign regression checks, **not a general
security certification or new security investigation**. Symbols, hidden named
properties, arbitrary descriptors, array subclasses, and previously unsupported
cyclic direct host-argument digests are not newly supported by this change.

The unchanged fixture also exercises four ordinary accessor controls with zero
getter calls; generic native-function rejection; hidden-index/hidden-name policy;
key budgeting; source closure alias/arity preservation; and active checkpoint
proof conversion using genuine source provenance. No probe was added.

## Native initial boundary and fresh replay

The exact previously reported minimal source is preserved in
`inputs/exact-original-summary.json`, not reconstructed; formatted here for reading:

```js
const values = await host(() => {
  const values = [1];
  values.metadata = 7;
  return values;
});
return [Object.keys(values), Object.hasOwn(values, "metadata"), values.metadata === 7];
```

Source SHA: `3fb9ddd0dd77a7459797af4ab8dc9479159083ef609700b33207c19d417e82bc`.
The finite host is `async callback => callback()`.

- Native: `[["0", "metadata"], true, true]`.
- Baseline source and built, before checkpoint: `[["0"], false, false]`.
- GREEN source and built, before checkpoint: `[["0", "metadata"], true, true]`.
- Two successive fresh completed restores per GREEN entry retain the entire
  native result without reissuing host or requesting a provider.

Three additional unchanged author graph constructions cover guest callback
returns, host callback arguments, and host returns. Every native/current/restored
comparison checks all **22 fields**, including the complete own-key sequence,
holes versus explicit undefined, aliases/cycles, metadata/raw, own `map` and
`forEach` shadows, non-index names, Map key/value identities, and Set membership.
The direct acyclic guest-argument and generic-copy controls remain in the unchanged
15-test fixture; this review does not pretend the separate argument-digest defect
is covered by the passing inbound graph cases.

The independent ad hoc sequence uses **37 distinct processes**:

- Four native anchors.
- Eight baseline initial-boundary observations: four cases through source/built;
  all disagree with the unchanged native oracles.
- Eight GREEN initial-boundary observations, all matching native before `dump`.
- Sixteen fresh completed restores, all matching native, producing **24 GREEN
  completed captures** in total with the initial captures.
- One GREEN restore of a newly generated pre-fix minimal capture still loses
  metadata. Historical lost data is not retroactively repaired.

The exact inline argv and JSON transport contract are in
`portable-graph-command.json`; individual `commands/graph-*.json` receipts retain
stdin, complete stdout/stderr, status, cwd, and timestamps. `graphs/*.json` retains
full observations and complete serialized public dump strings with bytes and SHA.
These are newly executed commands, not invented historical argv or a standalone
QA runner. No guest filesystem, network, LLM, or external provider is supplied.

Public entry points are `packages/safejs/src/index.ts` and `poe-code/safejs`, the
latter resolving to this projection's `packages/safejs/dist/index.js`. The result
record's null prototype is recorded separately; every ordered observation field
remains exact. No Map or array identity is normalized away.

`graphs/raw-reference-audit.json` independently checks **all 24 GREEN typed replay
graphs**, not just test labels or observation booleans. Callback-argument graphs
are checked in the callback argument data; the other graphs are checked in host
outcome data. Reference IDs, sparse length/keys, data descriptor flags, self/raw
cycles, metadata aliases, collection edges, and complete replay records remain
exact across each current-to-fresh chain. Fresh restores issue zero host calls and
request zero resume providers.

## Independent gates

Commands use clone-local npm/XDG caches, TERM unset, skill sync and Husky disabled,
telemetry disabled, snapshot playback and snapshot-miss error. Complete receipts
are retained under `commands/`.

| Gate                                           | Result                                |
| ---------------------------------------------- | ------------------------------------- |
| Unchanged HOST tests, source baseline          | 10 failed / 5 passed                  |
| Unchanged HOST tests, public built baseline    | 10 failed / 5 passed                  |
| Same HOST tests, source GREEN                  | 15 passed                             |
| Same HOST tests, public built GREEN            | 15 passed                             |
| Combined H5/Nash/Map/HOST, source config       | 42 passed                             |
| Combined H5/Nash/Map/HOST, public-built config | 42 passed                             |
| Fifteen adjacent files, including CTX          | 413 passed                            |
| Forced baseline build                          | 67 successful / 0 cached              |
| Forced GREEN build                             | 67 successful / 0 cached              |
| Default GREEN full suite                       | 25,873 passed / 41 skipped            |
| Configured root and SafeJS types               | Exit 0 each                           |
| Owned strict supplemental test types           | Exit 0                                |
| All 24 introduced roots                        | Exit 0                                |
| Configured plus introduced, 149 roots          | Zero diagnostics                      |
| H5 public type config                          | Exit 0                                |
| Default ESLint, package lint, workflow lint    | Exit 0; package lint 17 rules         |
| Formatter-eligible composite files             | Exit 0                                |
| All five HOST publication files                | Format and strict whitespace pass     |
| Legacy expanded 42-root types                  | Exit 2: 56 unchanged diagnostics      |
| Default root formatting                        | Exit 1: 1,434 base-identical warnings |

The built HOST-only check runs all 15 tests against the built public export via
the existing H5 config alias. In the combined built-config run, the six Map tests
retain their existing relative source imports; they are not falsely counted as
six built-only tests. The 15 HOST tests do use the built public entry.

The default commands are `TURBO_FORCE=true npm run build` and
`TURBO_FORCE=true npm test` with the recorded environment and clean projection cwd.
The full test command has no filter or timeout override. Package scripts, root
Vitest/Turbo config, and configured SafeJS type config match the pinned base.

The last two table rows remain **unresolved RED**, not waived or labeled passing.
The legacy diagnostic JSON is identical before/after and has no owned diagnostic.
All 1,434 formatter warning files were compared byte-for-byte with the base; none
belongs to the HOST or changed composite paths. The approved `.prettierignore`
preserves exactly two historical PPR2 JSON fixtures. Those files are hash-checked,
not counted as formatted. `.prettierignore` itself has no inferred formatter
parser and is checked by identity and patch whitespace. The 101 other composite
paths and all five owned publication paths are formatter-checked.

## Approved prerequisites and retained findings

Approved Map six-file manifest:
`f8a0135eed166bd67f932b7bdff967f84fdba5ea4aa8465c51af4a9f52d0ad4b`.
Approved H5 seventeen-file manifest:
`7f35f5565452ca9985b6f7eca3a05f0c0475cbc0e2e0d5e4afe26c023b226d67`.
Both were independently hash-verified and compared against the tested prerequisite
identities. H5's two files superseded by Map match Map's exact ordered preimages;
the approved Map postimages remain unchanged. The Map and H5 final review documents
are approved metadata supplements, not HOST source overlays or publication files.
Frozen author/prior reviewer capsules were not modified.

**HOST-ARGUMENT-ARRAY-MAP-SHADOW remains a real, separate open finding assigned to
Boyle by root.** Its preserved benign case is:

```js
const values = [1];
values.map = 0;
return host(values);
```

With pure `host = () => 1`, native is `1`; the preserved author evidence reports
`TypeError: value.map is not a function` before any host invocation. Its source SHA
is `88594bc2837f8daccb1f10ee63e0b975404e27b1e95c2c187acb1493c2e97af6`.
`separate-findings/host-argument-map-shadow.json` is captured unchanged. The relevant
`host-call.ts` SHA remains
`dea680fb83c7210af24b2d5a8574714b2d37451ce63bcfd53a8789eb611bb4c5`.
This review verifies that unchanged identity and preserves the finding; it does
not duplicate Boyle's source investigation, author a fix, or claim the inbound
metadata patch fixes direct argument normalization.

The author's exploratory fixture failures remain captured with their original
receipts. Their documented corrections distinguish result-record prototypes,
fatal budget rejection shape, and unsupported cyclic direct arguments from the
separate supported acyclic map-shadow bug. The final fixture's exact same bytes
were independently run RED and GREEN; no reviewer assertion was relaxed.

Already-lost metadata, old split Map snapshots, hidden named properties, symbols,
and all other array/host-boundary defects are not declared repaired. The original
47-case cohort membership of this later finding remains unconfirmed; no original
audit payload was read to reclassify it.

The publisher's stale jobs-v6 PPR2 CI smoke failure is separately assigned to
Pascal/Curie and the publication queue remains root-controlled. No smoke workaround
or subsequent digest fix was included here. Final published all-stack validation
and actual-main preimage checks remain required after that work and composition.

H3 provenance stays qualified: 443 reported initial reads, 73 surviving envelopes,
369 durable recovery records; the lost initial individual chronology is not
certified. Exact exclusion metadata and the entire security-tree exclusion remain
in the captured approved H5 provenance. This review reads no original audit
payload, adds no security probes, and makes no historical stack-identity claim.

No production authorship edits, README changes, commits, pushes, nested agents,
new unit disk writes, LLM calls, or guest real IO were used. Only the authorized
initial clone/pull changed Git state. Existing builds generate four font assets
inside the owned projections; they are not publication candidates. No guarantee
is invented about historical author ambient home-cache writes; this review directs
its own commands to clone-local caches. No CLI visual behavior changes or
screenshot claims are involved.
