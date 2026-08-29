# STATIC-DIGEST-TOJSON

## Scope and prerequisite identity

This bounded author task repairs functional implicit guest callback execution during host-call argument digesting. It is not a security probe or a general graph fingerprint redesign. The isolated main clone was pulled first at 62253552b11b92e473fd94e1d491e914d5289502. Exact ARG final5 manifest d7ec391880fd9a291b1baa28c085215a7a6875a47760648267aa63853b70ca1a supplies H5/Map/HOST/ARG prerequisites; the separately reviewed callback-arity delta is absent.

The 108-path prerequisite set includes ARG's unchanged independent report. Published PPR1 memoization overlaps an adjacent H5 promise-proof guard: a three-way conflict with an empty current side was resolved by retaining the incoming two-line guard; existing memoization remains unchanged. Current and post-prerequisite preimages are captured separately. No prior capsule is changed.

## Genuine reproduction and causality

A finite guest record with a source-function own toJSON increments a counter before host issuance even though the pure host stub never calls it. Native counter zero becomes one; the host still runs once. The same named own function on an array stays inert. Source before ARG and source/public-built after ARG reproduce the object failure. This is inherited, not a newly established ARG array regression; root retains publication decisions.

The first minimal test also asserted native versus null-prototype record identity with toStrictEqual. That unrelated assertion artifact was corrected to data equality, retaining the original receipt; the object callback discrepancy remains a genuine failure and the direct array control passes.

## Repair and validation plan

- Capture unchanged native/source/public-built assertions before production repair.
- Normalize function values to their existing inert JSON omission/null-slot representation, without executing callbacks or reading function properties.
- Construct internal digest records and arrays with null prototypes, and traverse selected own data descriptors only. Never mutate actual host arguments or delete their callable toJSON properties.
- Preserve hook-free digest bytes and replay version. Do not rewrite historical markers or silently broaden graph fingerprint, getter, native-function, or provenance contracts.
- Prove host-explicit invocation, counter/order, aliases, sparse controls, replay, and baseline digest identities; run default workspace and clean publication gates.

## Status

Implementation and validation are complete. Bounded reproduction receipts are in the separate ignored static-digest-tojson capture. No commits, pushes, README changes, original audit reads, or prior-capture mutations are authorized.

## Implemented representation repair

Only packages/safejs/src/interp/host-call.ts changes in production. Its post-ARG preimage is cb7a921e2bd1b32a545683e5a42a9df2643eea2e83cac5942a35c46b7db2cae2. The existing normalize function now returns an inert undefined representation for callable values, preserving their ordinary JSON omission from records and null array slots. Explicit undefined remains the established tagged value, distinct from functions and holes.

Every internal record, array, and undefined/non-finite-number marker has a null prototype. Thus the JSON encoder cannot discover a callable own or inherited toJSON on the representation. Record traversal uses selected enumerable own data descriptors, sorted keys, and the existing defineOwnDataProperty helper. Array traversal preserves the ARG numeric-own-data policy, length, holes, hidden numeric data, and intentional exclusion of named metadata from the fingerprint. Actual host argument graphs are never changed by normalization: toJSON, map shadows, metadata, raw cycles, and function aliases stay available to an explicitly invoking host.

Unsupported bigint is rejected before JSON encoding with the existing native error text. This retains rejection rather than allowing the JSON encoder to consult a primitive serialization hook. It does not admit bigint or arbitrary native functions into GenericInput. No input accessor or shadowed input method is evaluated, no callback wrapper/provenance/cache code changes, and no general graph fingerprint is added.

## Regression evidence

Two package-local files provide 19 cases: nine public-API runtime cases and ten internal digest-representation cases. The final exact files produce **12 failing / 7 passing before the production delta, then 19 passing**. A separate unsupported-bigint pre-encoding regression was also observed RED before its one-line rejection guard. Strict owned test typing passes without suppressions.

The runtime matrix covers plain records, named-array hooks, indexed records, and nested records, each with an explicit host invocation disabled or enabled. Native callbacks, actual host call counts, own keys, callable aliases, counter-at-host, and complete event arrays are compared. The host deliberately invokes an observer callback, then invokes toJSON only in explicit cases. Correct counts are zero during digest and one only when explicitly requested. Two in-process completed replays per matrix case do not reissue the host. A sparse control retains holes, explicit undefined, own metadata/raw/map, shared aliases, and a named self-cycle.

The internal cases pin hook-free digest bytes including sorted keys, callable omission, null slots, explicit undefined markers, non-finite numbers, repeated aliases and sparse presence. They reject selected record accessors without invoking them, retain hidden/inherited-property exclusion and cycle rejection, and inspect the normalized JSON input to establish that all intermediate containers are noncallable and null-prototype. Benign own data keys remain data through the existing safe definition helper; no prototype is modified on a supplied input.

The first matrix run also exposed a test-only array-prefix toMatchObject misuse in the sparse native oracle. It was corrected to assert all ten fields before the final RED run; both original and corrected receipts remain captured. No final RED assertions were weakened or changed for GREEN. The initial object-prototype comparison artifact is separately recorded above.

Public-built validation uses the unmodified package dist entry after a forced build. The nine new runtime cases plus five unchanged Nash controls pass (14 total). Internal digest tests intentionally import their source module rather than claiming a public export that does not exist. Adjacent source validation passes 274 cases in 18 files. Combined H5/Map/HOST/ARG/TOJSON validation passes 78 cases in 12 files in both source and clean-public-built configuration; inherited internal journal/normalization tests retain direct source imports in that configuration.

## Runtime order and fresh replay

The wrapper is dispatched by JSON.stringify before hostCalls.issue. That does not imply completion of the entire asynchronous guest callback body before the host: baseline execution can increment the counter before the host observer while a later events.push interleaves after the host observer event. Exact native and guest arrays, not a simplified ordering claim, are preserved in evidence/native-before-after-summary.json.

Sixteen new initial captures (eight source and eight public-built) match native outcomes and full observations. Sixteen fresh-process completed restores match those new captures, with zero host reissues and zero provider calls. Explicit=true cases preserve one actual callback invocation; explicit=false cases have none. These complement the in-process regressions and do not misrepresent completed result replay as a new host call.

## Compatibility decision and root hold

Snapshot/replay versions, source hashes, proof identity rules, and historical markers are unchanged. Hook-free digest bytes remain pinned by explicit canonical tests and existing published history/replay tests. The old ordinary-record callable omission and numeric-only array fingerprint policies remain; named metadata and graph alias topology are not newly fingerprinted.

Previously hook-bearing object captures are different: their erroneous digest was computed by executing a callback. The corrected inert digest cannot preserve arbitrary callback-dependent old output without re-executing the defect. Three captured old object/nested-object completed workflows now fail the existing identity check with “does not match the next restored invocation; reset is required.” All reject before host reissue. The old direct named-array control retains its digest and replays without reissue. These are recorded compatibility consequences, not silently repaired snapshots. The initial qualification attempt expected old completed result reuse and failed; the exact failure is retained, followed by an explicit per-case disposition capture. No migration, historical marker rewrite, or version bump is implemented.

Root was informed of this reset consequence before any broader migration; none is proposed here. Root's ARG hold remains in force pending TOJSON companion review. The inherited-object causality result does not lift that hold or authorize publication. Separately approved arity final4 b377c639b1a8f81848f4ae1dab918ac781a1cd91312f75ed53cde6a821718a74 is status metadata only and is absent from every tested source projection.

## Types, lint, formatting and build

- Configured root, SafeJS, and H5 types pass.
- All 28 introduced type roots pass, including both new tests; configured source plus those roots totals 153 roots and zero diagnostics.
- The 42-root legacy expanded program still reports 56 diagnostics. Exact prerequisite and candidate diagnostics, and the frozen ARG diagnostics, are identical: zero new or owned diagnostics. This is a qualified failing legacy gate, not a claimed pass.
- Workspace ESLint (excluding only the new ignored capture/cache), clean default ESLint, package lint, and workflow lint pass.
- Owned and 111-path composite formatting pass. Default repository formatting reports 1,433 warnings; each warning file is byte-identical to its current-main Git blob, with zero owned or changed warnings. No unrelated formatting repair is bundled.
- Workspace and clean projection forced builds pass all 67 tasks with zero cached tasks.
- Both original default full runs report 25,909 passed and 41 skipped, but a capture-tool timeout reset the Node REPL before their exit receipts persisted. Their complete logs remain. Both unchanged repeated default full gates pass with shell-persisted exit code zero: **25,909 passed / 41 skipped each**, 1,000 test files passed / 3 skipped each, zero cached tasks. No test timeout, selection, configuration, or oracle override is introduced.

## Publication scope and remaining gate

The owned delta is exactly host-call.ts, host-digest-tojson.test.ts, host-digest-representation.test.ts, and this plan/report. The 108 exact prerequisite paths are separate; the combined clean projection has 111 paths. Only the newly owned ignored static-digest-tojson capture will be sealed. All prior ARG/HOST/Map/arity/static-review capsules remain immutable and unchanged. No README or inline comment is added, no original audit payload is opened, and no real provider, guest IO, security probe, commit, push, or live skill sync is used.

Author validation is complete and the four-file candidate is ready to freeze after final byte/patch checks. Independent functional/static review and root publication approval remain separate. No blanket claim closes other array, reflection, graph fingerprint, or checkpoint issues.
