# Independent env split holdout baseline — August 27, 2026

**Preparation / red baseline only. No implementation acceptance.** The unchanged
48 row slots and seven planned hosts were each attempted once on the full source
archive requested by ROOT. The original20 files at `199038f` are byte-immutable;
no cases, native observations, helper, expected status or assertion were edited.
No author proposal, new fixtures or patch was inspected. No new cases were added.

## Exact counts and limitations

| Group | Original slots | Observed result |
| --- | ---: | --- |
| Command argv rows | 42 | 1 exact GNU tuple;41 strict mismatches |
| Single-optional shebang rows | 6 | 6 fixture setup errors; no product tuple |
| **Whole frozen row denominator** | **48** | **1 exact;41 mismatched;6 unavailable** |
| Planned host controls | 7 | 0pass;7fail before their complete contracts can be verified |

All55 child processes terminate naturally with code0 or1, no timeout, signal,
output overflow or surviving process group. All55 actual-import/source guards
pass. Source-guard validity is not an assertion pass or proof that setup finished.
The13 missing structured results are six fixture errors plus seven host failures;
they are not skipped, supported-characterization passes or removed denominator.

The42 captured product command statuses are one0,forty2,one127. The only exact
positive is the existing plain-argv control. Existing `-S`/long split invocations
are rejected by the baseline option parser; diagnostics/status mismatches remain
exact raw losses against the GNU reference. No coercion to GNU125 or127 occurs.
Seven host controls remain red: split rejection prevents intended observers from
being reached, and the small output-budget control can fail on diagnostic bytes
before its intended sink behavior. These outcomes do not demonstrate new cancel,
budget, stdin-origin or lifecycle regressions; their deeper checks remain pending.

### Frozen shebang fixture setup defect

The original `product-row.mjs` passes `row.fixture.virtualSource` (a JavaScript
string) directly to `MemoryFileSystem.writeFile`. The existing FS byte API requires
`Uint8Array`; all six fixture writes throw `TypeError: Memory files require
Uint8Array data` before shell execution. The source check is at committed
`src/fs/memory/index.ts:242`; the frozen helper call is retained unchanged.

This is **a verifier setup defect, not an env source bug or proof of unsupported
shebang behavior**. The original six native references/programs remain intact.
No FS relaxation, string-accepting product wrapper, fixture deletion or implicit
helper correction was made. A separately authorized, versioned byte-encoding
helper repair is required before these six can provide acceptance evidence.
Preserve this initial failing run beside that future correction. A shebang
implementation status cannot be inferred from these six setup failures.

## Source, input and import provenance

Committed baseline: `e7f4f2e3753184415f8098445c2009cb4cd9a6e9`.

```text
src/commands/execution.ts
1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700
src/shell/runtime.ts
2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b
src/contracts/command.ts
9c2f8ecf50def7250b01152a31a45c449109c3ae4d30878252cffe985c6e9df8
```

The archive contains all212 source files and four unchanged package/TypeScript
manifests from that commit, each verified against its Git blob. All20 frozen
holdout files plus the existing guarded loader from reviewer commit303d184 are
copied with exact hash proof. Only the installed dev `node_modules` directory is
symlinked; its318 file/link identities remain stable. No install, build, new
dependency, narrowed export wrapper or live-source overlay occurs.

The source payloads are imported through the unchanged broad public `src/index.ts`
and real `Shell`/`agentCommands()`, not an author-internal test wrapper. Before,
actual load and after hashes cover every loaded module; out-of-policy/live-source
aliases are rejected. The run records10,560 actual module loads, including55
natural public-index loads. All source/input/tool endpoints are stable. JSON/C
native captures remain data; this task performs no canonical TypeScript inventory
change or broad test discovery. Only the explicit frozen probe is executed.

Execution window:2026-08-27T10:14:25.207Z–10:14:39.689Z. Live HEAD before/after is
`630bf76f2a90a72ad447694e3b188e7437858820`; the live tree includes unrelated dirty
work, whose names/hashes are recorded without importing it. This is a committed
baseline, not a clean current aggregate claim. Endpoint guards do not exclude a
transient write/revert; immutable archive construction and actual-load policy
are recorded separately.

## Reused native authority and coverage

Actual executable bytes were checked again before/after. They match the complete
frozen GNU env9.7/Darwin primary and Apple env/Bash3.2 historical profiles; GNU
Bash5.3 also remains exactly pinned. Version strings are the existing captured
strings authenticated by these unchanged binary hashes, not fresh version calls.

```text
GNU env9.7 Darwin
1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0
GNU Bash5.3
8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
Apple /usr/bin/env
9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776
Apple Bash3.2
35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3
```

No native fixture was rerun. Both whole native profiles and both historical
preparation captures remain untouched. This baseline uses the frozen primary
48 coordinates/environment exactly. It does not replace native paths, reorder
environment, normalize bytes/modes, mix in historical expectations or rebind the
product to different historical cwd/env coordinates. There is no fresh historical
product denominator in this run. Primary matches are not historical parity.

The explicit code/documentation authority remains the already pinned GNU9.7
`src/env.c` and versioned manual: split parsing and incoming-environment expansion
are distinct from shell grammar and child-env modification. Local source/manual
hashes recorded in `provenance.json` were rechecked. Online manual edition labels
are not upgraded binary versions or substituted oracles. The full frozen corpus
already covers quote/escape/variable/empty-argument combinations, reinsertion,
unset/clear-env boundaries, literal injection, bounded recursion/growth and
protocol controls; the seven hosts cover the declared invocation/stream contracts.
No missing-case expansion was justified before the author patch.

Virtual non-S shebang optional text stays one literal argument under the declared
profile. The actual Darwin kernel's different splitting remains separate raw
evidence, never a per-case replacement oracle or forced native pass. GNU9.7 is a
Darwin/gnulib build, not GNU/Linux; raw env order remains profile-specific. Old40
mode differences do not authorize creation-mask/FS changes. Explicit-bash-c
parameter status1vs127 is wholly separate.

## Handoff and reproduction

`baseline-e7f4f2e.json` contains all55 raw outcomes, requests, native tuples,
effects/modes, full source/input proofs and before/load/after maps. Cleanup receipt
binds that artifact. The archive and every owned child group are removed after
durable proof; no foreign process or native temporary artifact is touched.

```sh
node --test tests/shell-stress/env-split-holdout/resume-integrity.test.mjs
```

The integrity command checks existing evidence, not product/native behavior.
`resume-baseline.mjs` rejects an existing output instead of silently rerunning.
The earlier199038f phase had zero product executions; these55 are the first
holdout product/host attempts, not a replay of old6e counts.

No source/API/contracts/root-package/private dependency edit, SafeJS run,
OLD9/custom-first-read/accounting/errexit/kernel/fullgate or benchmark rerun.
The optional cleanup callback is a cooperative host hook, not a new guest
capability; no hidden lifecycle requirement was invented or deemed verified.
ROOT may use the frozen inputs for the author's independent implementation phase,
but must retain the fixture-setup limitation before any acceptance claim. Stop
after committing this preparation/baseline and reporting counts/provenance only;
do not relay concrete hidden cases to the author before candidate freeze.
