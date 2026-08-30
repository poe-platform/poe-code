# Transparent output accounting — author checkpoint

The user authorized this existing-policy bugfix after the independent env/core
reviews. It is not a new output-limit definition, lifecycle API or independent
acceptance. Historical double-accounting observations remain intact under
`tests/shell-stress/env-replacement/output-budget-evidence` and the separately
owned core-regression reports. No independent fixtures or core files change.

## Root cause and bounded fix

Before this patch, Runtime.invoke passed every explicitly supplied sink through
Budget.sink, even when it was the current already-budgeted stdout/stderr.
A four-byte printf therefore consumed eight budget units. The same issue
affected nested forwarding and signal-only pipeline sink wrappers. This was
already present before replaceEnv; no environment semantics change is needed.

A private WeakMap now recognizes runtime-created sinks by owning Budget and
their actual write function. Rewrapping a valid sink owned by the same Budget
adds only a cancellation wrapper; its original write performs the single charge.
The runtime's signal-only wrappers preserve that provenance and retain their
own signal checks. Verified writer functions are captured so later mutation
cannot invalidate a previously recognized forwarding chain. A changed write
method loses eligibility when used for a new wrapping operation.

New external sinks, unrecognized host wrappers/proxies and sinks from another
Budget are not exempted. No arbitrary wrapper is inspected or unwrapped. There
is no content, buffer-identity or write-history deduplication. A repeated write
of the same Uint8Array still consumes budget again. Distinct producer/consumer
pipeline output remains separate: four bytes through both stages require eight
budget bytes. Capturing output and delivering that same write to an external
observer remains one charged operation as before.

The original charging branch still checks cancellation/type/remaining budget,
reserves bytes synchronously before downstream effects, and observes downstream
failure. An oversized write fails before calling its sink. A downstream-failing
permitted write remains charged. Child and parent cancellation reasons retain
identity; late rejections are observed. Unknown host wrappers may conservatively
add a charge; this patch does not claim transparent recognition of arbitrary
trusted JavaScript adapters or forcibly cancel uncooperative host operations.

Only runtime.ts changes in production. Runtime.invoke, the replaceEnv branch,
contracts, root exports, manifests, dependencies, filesystem/core commands and
all existing limits are unchanged. No new public export names or Budget/Shell
instances are added by the implementation.

## Type fact: no new TS2412 fix

At entry, runtime.ts already contained `child.profile = state.profile ?? "bash"`
at line1120, committed by `0f5dbb3`. Fresh read-only preflight global/build
noEmit both exited0 with stable1066/302 input snapshots. No type patch, cast,
ignore, weakened compiler setting or invented fix was applied. The earlier
failure remains recorded in the expanded-gaps validation artifact.

## Tests and evidence

- Red control before the source patch:27 tests,13 pass/14 fail. Raw TAP remains
  in `output-accounting-validation.json`. New host sink methods were made async
  for the existing ByteSink type contract; assertions were not weakened.
- Final29/29:28 direct actual-Shell/agentCommands tests and one bounded child
  containing nine cancellation/ownership/error-precedence assertions. The
  private Budget checks supplement, not replace, real pipeline/registry tests.
- Includes the exact four-byte env/explicit-forwarder limit4 regression;
  limit3 denial; repeated same-buffer writes; stdout/stderr and cross aliases;
  nested omitted/false/true replaceEnv; new sinks; middleware replacement and
  write-method mutation; unknown proxies; concurrent reservations; pipeline
  limit7/8 distinction; typed parent/child cancellation and late failures.
- Existing three-gaps58/58, env31/31, current-shell43/43 leaves (44 TAP),
  source/eval86/86 and invocation72+132+211=415/415 all pass. The previously
  stale72 policy/guard review was a separate tests-only migration; this author
  did not modify it or erase its earlier414/415 observation.
- Final global/build/benchmark noEmit exit0 with1069/302/411 pre-enumerated
  actual inputs. All before/after source/dependency digests stable, actual TS
  import hashes match, no unguarded compiler paths. These are guarded worktree
  snapshots, not a clean whole-product acceptance claim during other work.

The author child has a five-second hard deadline and256KiB output cap; strict
unhandled-rejection mode is enabled. Validation children/groups are stopped.
No native Bash oracle was used for this custom accounting policy, and prior
native-gap evidence is untouched. Old9/custom5, env ordering, BOM/jq and broader
shell/backend gaps remain separate; none are rerun or waived here.

From the repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/output-accounting.test.ts tests/shell/output-accounting-bounds.test.ts
node tests/shell/output-accounting-verify.mjs /tmp/output-accounting-new-validation.json
```

Use a fresh output filename. Compact committed validation records include
red evidence, preflight/final compiler facts, guard digests and deduplicated
actual shell-import hashes. Root will route the frozen commit to Plato for
independent verification; author success does not preempt that review.
