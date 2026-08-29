# O05/H5: public conversion of reconstructed function-bearing proofs

## Scope and ordered baseline

Author workspace: `/Users/kjopek/Workspace/poe-code-safejs-function-proof-conversion`.
Date: August 29, 2026. Independent Nash review and publisher approval remain required.

The new single-branch main clone successfully ran
`git -c pull.rebase=false pull --ff-only` before any changes. Its base is
`6e3733a0df3b764a5d87d5f19fe6142bfed905f1`.

Verified immutable inputs, separate from this fix:

- Final PPR2: `8aa982da2dab9b01da8f80c2035397143e1693c17ed64ab6a8f9247f37061826`.
- Nash H5/H6 handoff: `c603eafb5f8d100087e81510ebe453ac41b99b3f71c8724c6e559d4f9e40188f`.
- Published G01: `0750012360eaaac4c87b6f45bc5133e6a2ece5aedf3c3834f5b7c5df7be4820b`.
- Provisional PPR1: `e2374833611703aa57149f384969ba83dedb36c38901c0fe6c89b9a3694973ed`.

Of the 67 final PPR2 composite paths, 32 already matched main, 34 needed exact
preimage-checked application, and `values.ts` contained the newer published G01
bookkeeping change. All five G01 publication paths already matched exactly. No
upstream bookkeeping change was overwritten. PPR1's six memoization lines were
applied as their own prerequisite: three in `values.ts` alongside G01 and three
in `host-bridge.ts`. This fix starts from the resulting ordered preimages.

PPR2's fixture-packaging hold and PPR1's final refreshed capture are coordinated
separately. Their provisional production sources are not independent approval.
Old Curie failures and frozen Nash failure evidence remain unchanged. No other
clone is edited, no live source from another worker is an integration input, and
there are no Git commits, pushes, branches, README changes, or home configuration
changes in this lane.

The copied archive guard records all 38 excluded paths and the entire original
audit `security/` directory. Its payload allowlist is empty. This work reads no
original audit payloads and performs no security research.

## Reproduced boundary and TDD

The unchanged Nash package tests run against both the exact frozen PPR2 runtime
and the current ordered sources before the fix: **8 pass, 2 fail** in each run.
Native source anchors and data/disposition controls pass. The two genuine failures
are:

1. `final-async-proof-representation.test.ts`: returned source-function aliases
   fail at `Unsupported sandbox value at <root>.compute: function`.
2. `final-async-proof-adapter.test.ts`: the original callbackFunction workflow
   fails at `Unsupported sandbox value at <root>[0].compute: function`.

Reconstructed callbacks and their IDs were already correct. The provider received
genuine host adapters for sandbox closures, but `HostCallOutcome` requires
`SandboxValue`. The generic converter deliberately cannot recognize those native
functions. Invoking the callback again, replacing its returned function with a
number, or inventing an outcome capability would not implement this contract.

After adding calls to the proposed public method and focused controls, the
pre-implementation API test run is **7 pass, 8 fail**. The missing
`context.toSandboxValue` causes those expected failures. The implementation then
passes all **16** focused tests. The original three Nash test files are byte
unchanged; only their two reusable host fixtures use the new public conversion
method. Their test and TypeScript configurations now resolve the actual local
public source entry instead of a non-publishable frozen-runtime path.

## Public contract and implementation

`HostCallResumeContext.toSandboxValue(value: unknown): SandboxValue` copies a
settled graph supported by the existing host-data copier into a value suitable for the `value` or `reason`
member of `HostCallOutcome`.

- A private per-host-call WeakMap recognizes only the genuine adapters produced
  by that call's sandbox callback wrapping. It maps each adapter back to the
  existing sandbox closure; it does not create or invoke a replacement function.
- The existing host-data copier retains one graph traversal memo for each call,
  preserving object aliases, cycles, Map/Set membership, and repeated function
  identities. The returned closure keeps its original lexical environment.
- Arbitrary native functions, bound copies of adapters, functions from another
  active call or run, and old-run adapters are rejected. Already-converted
  sandbox capabilities and unresolved promises are not accepted by this method.
  A provider must await the reconstructed result before converting it.
- The converter expires when reconciliation settles or rejects and respects an
  aborted execution signal. Holding the context does not grant a reusable
  conversion API for a future run.
- Conversion does not supply proof identity or callback disposition. Existing
  request/proof validation and joined/detached handling remain authoritative.
- `deepCopyToSandbox` retains its existing native-function rejection, including
  for the same genuine adapters accepted by the scoped method. Nothing is
  inferred from a caller-controlled marker, name, shape, or cast.

Only `interp/host-call.ts` and `interp/host-bridge.ts` change in production for H5.
The existing public type export exposes the new method through the SafeJS SDK;
no additional export, CLI option, snapshot format, migration, `run.ts`, or PPR
memoization change belongs to this fix.

## Original full-value and metadata evidence

The minimal original source has identical native, original, and resumed values:
`{ same: true, calls: 1, value: 7 }`. Its actual outer callback invocation count
is one, replayed callback IDs are `[1]`, and its proof is consumed.

The original callbackFunction workflow preserves the complete value:

```json
{
  "result": [
    [
      [2, 21],
      [3, 31]
    ],
    [
      [5, 52],
      [7, 72]
    ],
    [
      [11, 113],
      [13, 133]
    ]
  ],
  "counters": { "callbacks": 6, "total": 410 },
  "trace": [
    [0, 0, 2, 20],
    [0, 1, 3, 30],
    [1, 0, 5, 50],
    [1, 1, 7, 70],
    [2, 0, 11, 110],
    [2, 1, 13, 130]
  ]
}
```

The candidate evidence records true comparisons for complete persisted native
values, exact remaining native call suffix, proof/request identity, callback IDs,
and consumed lifecycle. One provider request receives one joined proof. Its two
recorded callback invocations retain ID `1` and steps `38` and `67`. No ID, source,
argument digest, counter, version marker, or historical fixture is rewritten.

The raw prototype-sensitive native comparison is separately **false** because
guest records have null prototypes. The persisted full-value comparison is
**true**; this is explicitly not raw prototype parity or scalar-only parity.
Independent captures have different UUIDs; comparison of proof and request IDs
is within each genuine capture, never UUID normalization across runs.

## Separate completed-Map observation

An additional completed-replay control initially failed an overly broad new
native-parity expectation. Its source returns a cyclic record shared with a Map
value, together with a source closure used as the Map key and in a Set. First
execution and H5 pending restoration both preserve all six result fields:
`value: 7`, `closureAlias: true`, `objectAlias: true`, `cycle: true`, `map: true`,
`set: true`.

Replaying the **completed** result changes only `map` to `false`. The exact frozen
PPR2 runtime reproduces that same failure with **zero provider calls and no H5
converter**. Current original completed replay also reproduces it. The failed
control and both full baseline observations remain captured. The package test
explicitly checks this inherited baseline and compares H5 completed replay to it;
it does not claim completed-Map alias parity is repaired. No snapshot or generic
conversion change is included for this separate issue.

## Validation and qualifications

The dependency install uses `SKIP_SYNC_SKILLS=1 npm ci` with a clone-local npm
cache. Needed dependency builds and full root build pass. Configured root and
SafeJS types and the H5 public-type configuration pass. All 26 introduced test
roots in the combined clean gate have zero diagnostics.

Expanded matching baseline/candidate type commands include all 26 prerequisite
test roots, including the agent-harness loader test. They report **56 → 56**
identical diagnostic signatures, zero additions/removals, with exact source
anchors recorded. This expanded legacy gate remains qualified RED, not a passing
gate. The four inherited diagnostic files are unchanged. H5's own typed public
usage is clean.

The first root ESLint run found ten errors only in copied frozen generated
runtime artifacts under `out`. Those byte-verified artifacts were moved beneath
an existing `dist` exclusion; no lint rule, source file, or exclusion config was
changed. The initial failure and hash-verified relocation receipt are retained.
The subsequent unchanged root ESLint command passes. Package lint also passes.
Full root passes **24,579 tests**, with **41 skipped** and zero failures across
987 files. No test or hook timeout override and no additional test exclusion was
used. A separately listed 38-file combined selection passes **982 tests**,
including PPR2, PPR1, CBI, AR, G01, shadow-array, and the new H5 controls.

The full run includes all 23 shadow-array controls, 24 PPR2 author controls,
19 PPR1 author controls, six genuine working v6 restores, the historically
broken raw-v6 outcomes, and all 36 v6-generation cases. Those historical
TypeErrors remain explicit expected observations, not claims of repair.

Both modified test configurations needed only formatting after the first
publication-format check. All 90 composite publication paths then pass Prettier
and strict whitespace checks. No production or test assertion changed for this
format pass. H5's focused tests and public-type configuration are rerun after
formatting. The root's pending final prerequisite refresh remains a separate
handoff qualification, not a relaxation of these executed gates.

## Reproduction procedure

Run commands from the author clone. Use the installed pinned dependencies and
clone-local caches; do not sync skills, call real providers, or use original
audit payloads. The tests use bounded benign host callbacks and do not perform
guest filesystem or network operations.

```sh
env -u TERM ./node_modules/.bin/vitest run --config packages/safejs/test/final-async-proof.vitest.config.ts
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/test/final-async-proof.tsconfig.json
env -u TERM SKIP_SYNC_SKILLS=1 npm run build
env -u TERM npm run lint:types
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM npm run lint:eslint
env -u TERM npm run lint:packages
env -u TERM ./node_modules/.bin/vitest run
git diff --check
```

For exact historical RED, use the handoff's original Nash fixture bytes and
the SHA-verified frozen PPR2 public entry, not the candidate adapters. The
captured frozen entry is verification-only, not a package runtime dependency.
Compare the two original failures and complete event graphs with the candidate
evidence, then rerun the unchanged original package assertions against the local
public API. No standalone executable QA runner is added.
