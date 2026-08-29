# HOST-ARG-MAP-SHADOW

## Scope and immutable prerequisites

Direct author work is confined to the new main clone `/Users/kjopek/Workspace/poe-code-safejs-host-arg-map-shadow`, cloned and pulled first on August 29, 2026 at `b06e79ab841765f06d0a577230f10db28f98c457`. The HOST metadata4 capsule `002a32167def93d48b84117ff2f47b34c8cf1f99faccca9524c00542e5d5e9eb` provides the exact 104-path H5/Map/HOST prerequisite chain and the captured benign finding. It remains immutable. Root has accepted HOST for Aquinas independent review, not publication. H5 final17 is independently READY/root-approved; this does not authorize this new repair or the combined stack.

Current main contains 75 identical prerequisite paths. Three production deltas and 26 missing prerequisite files apply contextually with no three-way conflicts. All current-main preimages and exact prerequisite postimages are captured separately under ignored `out/safejs-remediation/host-arg-map-shadow/`. No source file in a prior clone or capsule is modified.

## Exact failure and plan

Captured source:

```js
const values = [1];
values.map = 0;
return host(values);
```

With pure host `() => 1`, native returns `1` after one host call. Initial SafeJS throws `TypeError: value.map is not a function` before any host invocation. The array is ordinary and acyclic. `normalize` in `host-call.ts` calls the input array's own `map` while computing its argument digest.

1. Record the exact minimal case RED with unchanged native-correct host-count and value assertions before changing production.
2. Add bounded method-neutral normalization, sparse-presence, own-data, aliases, supported cycle-route, provenance, and completed replay controls; do not weaken unsupported-input or accessor policies.
3. Make the smallest array-normalization repair using existing own-data construction and index classification. Do not remove or mutate input shadow data; preserve established digest bytes for supported unshadowed inputs.
4. Run source/public-built regressions, adjacent controls, configured and owned types, lint, publication formatting, strict whitespace, forced builds, and both default full gates including a clean projection.
5. Freeze only the new owned source/tests/report delta with exact post-prerequisite preimages and separately indexed prerequisites for independent review.

No README edits, inline comments, original audit payload reads, security probes, real LLM calls, guest IO, live skill synchronization, commits, pushes, branches, or other-clone writes are permitted. New tests use pure finite mocks and create no files. Any additional functional finding is recorded separately rather than silently expanding this repair.

## Minimal production repair

Only `packages/safejs/src/interp/host-call.ts` changes in production. The array branch constructs a fresh array of the same length, inspects own descriptors, and normalizes only canonical numeric data entries using existing `isArrayIndexKey` and `defineOwnDataProperty` helpers. It never calls the input array's methods or evaluates its accessors. An indexed accessor is rejected without invocation; named descriptors remain outside the established digest traversal. No input property is deleted, changed, or copied back into the original argument.

This deliberately preserves existing dense, sparse, explicit-undefined, hidden-index, and non-finite-number digest representations rather than changing the journal identity format. Holes remain holes in the normalized array; explicit undefined retains its existing marker. Repeated aliases remain supported by the existing traversal stack; numeric-entry cycles remain rejected. Existing named-only cycles, including raw pointing to the array, remain outside digest traversal and are preserved by supported host conversion and replay. The actual host receives its full own metadata/raw/shadow data and aliases, not the digest's normalized representation. Named data is still not incorporated into argument fingerprints; this repair does not broaden that existing identity contract or claim a general graph fingerprint.

The recorded main production preimage is `1f8bec1f24ddd58f343b6a314f8deff05ef4c67dd879ca82ce523186ca84a6cc`. The exact post-H5/Map/HOST ordered preimage is `dea680fb83c7210af24b2d5a8574714b2d37451ce63bcfd53a8789eb611bb4c5`; the repaired postimage is `cb7a921e2bd1b32a545683e5a42a9df2643eea2e83cac5942a35c46b7db2cae2`. All 103 other prerequisite paths remain exact, including all four HOST metadata publishables, H5 provenance controls, PPR1 memoization, G01 measurement, and the Map-owned fresh-completed-capture oracle. No generic converter or native-function/provenance policy changes.

## TDD and exact observations

The unchanged captured minimal synchronous case fails before production changes, with native result 1 and one native host call versus SafeJS TypeError and zero host calls. Both source and built API observations reproduce that exact baseline. The final identical 17-test source fixture is 12 failures/five passes against prerequisite-only source, then 17/17 green after repair. The public API subset is eight failures/one pass before repair and 9/9 green afterward; its built invocation also includes five unchanged Nash controls, for 14 total green.

The 17 owned cases cover the original numeric shadow; null, undefined, false, string, and callable source-function shadows; zero method invocation; source-function arity; full sparse/named graph fidelity; two completed replay generations; a fresh pending capture with one finite external result proof and no host reissue; native-function rejection; fixed legacy digest encodings; ignored named accessors; indexed accessor rejection; hidden numeric data; aliases; and unchanged cycle exclusions.

The pending fixture initially returned the unawaited host promise and correctly received a SandboxPromise rather than a numeric result. That additional fixture now explicitly uses `return await host(values)` and retains native result 1, one initial host call, zero replay calls, and one proof-provider call. The original captured synchronous minimal case and its assertions are unchanged. Both final RED suites were rerun after this fixture correction; no production complexity was added for it. Earlier receipts and fixture versions remain captured.

Inline validation commands additionally capture the exact minimal case, the 18-field sparse/alias/cycle graph, and callable-shadow arity case through source and built APIs: six initial captures, 12 in-process completed replays, and six fresh-process completed replays. Every observation equals native. Initial executions invoke the host once; completed replays invoke neither host nor provider. Snapshots are newly generated after this repair. No legacy snapshot or prior capsule is altered.

## Final gates

On August 29, 2026, both default `npm test` gates pass: 25,890 tests passed and 41 skipped, with 998 test files passed and three skipped. Workspace duration is 262.78 seconds; clean publication projection duration is 262.80 seconds. Both use TERM unset and forced Turbo execution, with no timeout, selection, or Vitest configuration override. Prerequisite, final workspace, and clean projection forced builds each pass all 67 tasks with zero cached tasks.

Adjacent controls pass 430/430. Combined H5/Nash/Map/HOST/new controls pass 59/59 in source and projection-built configurations. Public API tests in the latter resolve to the projection's built entry; internal normalization and journal tests continue to import source internals. It is not a claim that every internal test executes built code. The four relevant runtime build artifacts are byte-identical between workspace and projection.

Owned strict explicit types pass for both new test files. All 26 introduced roots pass in workspace and clean projection; the configured SafeJS source program plus those roots checks 151 roots with zero diagnostics. Configured root, SafeJS, and H5 type gates pass. The legacy 42-root expansion retains exactly 56 identical diagnostics before and after the repair, identical to the frozen HOST baseline, zero new or owned diagnostics. That legacy scope remains qualified red, not waived. The preimage comparison substitutes only captured prerequisite source through the compiler host, without editing any live source.

An early expanded type invocation overlapped a forced build's removal of generated declarations, producing 123 cascading diagnostics starting with missing `@poe-code/safejs` declarations. The identical scope passes after the builds complete, with no source changes or suppression. An earlier ad-hoc Node observation similarly ran before dependency artifacts were built and failed to resolve an agent-spawn module; the exact source/built observations were rerun successfully after build. All failed receipts remain indexed with these diagnoses.

Workspace ESLint, clean-projection default ESLint, package lint, and workflow lint pass. Workspace ESLint excludes only this ignored capture and cache. All owned and composite publication files pass formatting. Clean-projection default formatting reports 1,434 warnings on files whose Git blobs equal current main, with zero changed or owned warnings. Workspace default formatting also traverses ignored generated output, reporting 2,877 warnings and four ENOENT errors for rotating local npm logs. The clean projection has no out directory and isolates the unchanged source warnings. No unrelated formatting is fixed. Final production, owned, prerequisite, composite strict patch whitespace and tracked diff checks are captured separately.

## Projection and handoff

The clean projection consists of an archive of recorded main plus the exact 104 prerequisite paths and four-file owned delta, for 107 distinct resolved publication paths. It has no Git metadata or out directory; only installed dependencies are shared by a node_modules symlink. Tests and fixtures are package-local and do not import frozen captures. Existing builds generate four untracked terminal-pilot font files equal to terminal-png source assets; those are not publication files and are recorded separately.

The independent-review capsule is `out/safejs-remediation/host-arg-map-shadow/manifest.json`. Its four publishables are this report, the single production file, `host-arg-map-shadow.test.ts`, and `host-argument-normalization.test.ts`. It separately indexes current-main and post-prerequisite preimages, prerequisite postimages, owned delta, composite projection, RED/GREEN evidence, and all command receipts.

This scoped method-shadowing defect is repaired for independent review, not publication-approved. No further functional defect was confirmed in this bounded task; the unawaited-promise fixture and unavailable build declarations are diagnosed as validation setup issues, not new product findings. Named-data fingerprint exclusion and existing unsupported-input restrictions are unchanged qualifications. Already-lost metadata or already-split historical snapshots are not reconstructed. No claim is made that all host-array or checkpoint issues are closed. Root coordinates independent validation and Kuhn remains the only publisher; no commits or pushes occur.
