# Independent seal: one SafeJS sink-fixture migration

**Verdict: accept only the single fixture migration in
`656ee2b04aa91b1cc40da865173be1b472a2c4ce`.** Independent reviewer
`surfaceauditor01a04292-5421-7363-8bcb-a70b97fae4e9` is not migration author
`01a04292-c8dd-7331-9dac-619c9861b11b`. No delegation occurred.

This review executes the revised whole 19-case cohort and immutable original
whole 19-case cohort **once each**. It does not run the previous 13-case surface
audit, architecture cohorts, a full gate, extra native cases, or environment work.
It makes no all-SafeJS, raw-engine, or project-completion claim.

## Existing behavior comes first

On public product `f44958bf48778737a58535e2bc9b37c292ac28c4`:

- `src/commands/grep.ts:77` rechecks cancellation, catches ordinary output errors,
  diagnoses them, and selects exit status 2 at line 84.
- `src/commands/internal.ts:101` formats the diagnostic as command name, colon,
  Error message and LF.
- `src/contracts/command.md:99` preserves the execution path's selected outcome
  after draining cooperative cleanup. It does not turn an ordinary error already
  handled by grep into a new Shell rejection. Caller abort and cleanup rejection
  remain separate, unchanged paths.

Therefore the existing ordinary caller-stdout-sink error is expected to produce
this **complete result with no rejection**:

```json
{"exitCode":2,"stdout":"","stderr":"grep: sink:literal-grep-caller-sink-error\n"}
```

No native Bash guest-exception experiment is required or claimed. This is an
assertion correction to existing selected utility behavior, not a product fix.

## Exact scope proof

`PROVENANCE.json` and `FIXTURE.patch` authenticate the original
`5009ba8146c73bd5628147707e733384e5cd4aee` and migration candidate. Among files
already tracked in the original **integration owner's subtree**, only
`integration/child.mjs` changes. All other **572** original files retain their Git
blob identity, including the original runner and every old evidence capture.
Unrelated changes elsewhere between those two commits are not part of this claim.

Replacing exactly the original two lines (`caught === true`, exact sink Error
rejection identity) with exactly four lines yields the entire candidate child:
explicit case-ID guard, `caught === false`, and the exact result above. Whole-file
equality proves no other child text changes. Guest code, public argv, input file
bytes, Error construction/message, throw point, runtime injection, budgets,
cleanup/native-worker probes and the other 18 expectations remain identical.
This is neither a blanket diagnostic relaxation nor a no-op assertion.

Original child SHA-256:
`70708a7d07fd61595933b08f5ec852f6b8cc5d60f15724239023775318b71ee7`.
Revised child SHA-256:
`528234e9127066607a87ffde499e462189fd092513c9e08f6770f29536ecb7b9`.

## Independent executions

All times are August 27, 2026, UTC. Both executions use Node 22.22.2, Darwin arm64.

| Whole cohort | Capture start–finish | Accepted | Failed | Runner exit |
| --- | --- | ---: | ---: | ---: |
| Revised | 10:38:12.746–10:38:49.697 | 19 | 0 | 0 |
| Immutable original | 10:38:51.459–10:39:26.885 | 18 | 1 | 1 |

Both retain 18 actual guest executions and one intentional pre-abort/no-admission
control; zero skips. The original's **only** assertion failure remains
`literal-grep-caller-sink-error`, with `false !== true` at the original
`assert.equal(caught, true)`. It is an expected historical test failure, not a new
product bug or an infrastructure failure. There were no independent infrastructure
failures and no retry runs.

For all 19 cases, selected guest metadata, public argv, actual result, actual
error and settlement state match between original and revised. Only native
thread identifiers are omitted from the normalized settlement comparison; raw
identifiers and complete captures remain recorded. The original sink's input,
argv, result, error and assertion message also match immutable attempt-08 evidence.

### Sink case: actual observation, not just counts

In **both** replays:

- Actual result is exactly status 2, empty stdout and the diagnostic above;
  `error` is `null`, so the sink Error is not a public rejection.
- Exactly one real runner entry and one companion host call occur.
- The same input is `alpha 1\nbeta\nalpha 2\n`; the guest invokes literal
  `grep` argv `["-E", "^alpha", "/work/input"]` and sets the returned status.
- The caller sink throws the same constructed `Error` at the same write point.
- Product cleanup registers at event 6, before native worker creation at 7.
  Sink failure is event 10; worker exit is 12; native termination fulfills at 13;
  host cleanup completes at 16; public exec settles at 17.
- At settlement, `cleanupDone:true`; worker `exited:true`,
  `terminationSettled:true`, one terminate call and two posts.

The revised case then reaches its existing explicit public-dispose checkpoint.
The original fails its old assertion first, records `failure-before-rescue`, and
executes the existing finally disposal/tool cleanup. That event label alone is
not rescue: `containment:false`, no watchdog or rescue branch, and normal tooling
closure are independently checked. We do not claim an original checkpoint after
the assertion failure was executed.

## Provenance correction reviewed

The original `run.mjs` is unchanged. The new `migrations/sink-v2/run.mjs` is copied
**byte-for-byte from the pinned candidate** into this new reviewer-owned subtree,
along with its six explicit helper inputs. `PROVENANCE.json` maps every copy to
its original commit, blob and SHA-256; no runner edit or import weakening is used
to make this review run. The original profile copies all six immutable
attempt-08 `.fixture` files, not a reverse-patched or reconstructed old assertion.

The versioned runner authenticates the **entire archived 15,798-blob Git tree**
before build, after build, before execution and after execution. Each phase checks
all blob IDs, executable mode bits, the complete file-set inventory and tar hash;
post-build phases also preserve the emitted product. Compiled output and packed
package equal the original accepted artifact. Runtime import guards, copied
runtime-file inventory, private-source guards, tool-source guards and negative
public-boundary import controls remain enforced. Independent byte comparisons
also verify the unchanged private-state helper, public-boundary control block and
child execution/acceptance loop.

The live product source/config is **recorded separately**, not required to equal
the historical archive and never substituted into it. Both independent replays
record drift in `package.json`, `src/commands/internal.ts`,
`src/commands/streams.ts`, `src/index.ts` and `src/plugins/index.ts`, with no
additional during-capture drift. These are external live state observations, not
authorship attribution. No live file is reverted, overlaid or changed here.

The historical v1 preflight failure remains preserved with **zero guest cases**;
its old live-equality rejection is not relabeled as a pass. The old original audit
remains 18/19. This seal does not rewrite either historical result.

## Product, engine and containment

- Public product: `f44958bf48778737a58535e2bc9b37c292ac28c4`.
- Full tree: `b56256393025d5f0cf0d2b33c05bd5d5f39ac608`.
- Full archive SHA-256:
  `d942398b277a621b82b98dbaab267291ac4dc7b613f884b617650357964989bd`.
- Public package SHA-256:
  `1a757856aff57daa1fd3e5c40f4e011b1bb1ec43877f2fd5c8b6fae7f8e3ff5e`.
- Actual private source HEAD:
  `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`.

The engine is legitimate explicit **current-source hook injection**, not a private
package-import claim. All 264 copied regular source files match the historical
accepted engine inventory and private before/after state. Each replay independently
matches HEAD, index, status, source bytes/modes and private metadata before/after;
no private install, build, cache, config, AGENTS, source, worktree or symlink write
occurs. No private engine source bytes are committed. Existing public cached
TypeScript/tsx/esbuild tooling is identified, copied and hash-guarded. Only the
zero-runtime-dependency public tarball is installed offline in the owned temporary
consumer; no dependencies are added to any package.

Each cohort verifies **9,866 import-record hashes**, including 63 actual engine
source files, actual public package imports and the native regex worker imports.
Both complete all four archive phases with 216 source/config hashes unchanged.

Each cohort retires **18 native regex workers before public exec settlement** and
normally closes **19 copied esbuild services**, including loader-owned services.
All case children close; no signal, timeout, watchdog or failure-rescue cleanup is
accepted. The unchanged 9-second child and 13-second parent-child deadlines remain;
the independent driver adds a 180-second owned-process-group boundary per replay.
Both outer groups disappear naturally, both parents remain alive, and both full
archive/engine/consumer/tool scratch trees are removed. No foreign process is killed.

## Evidence and reproduction

`SEAL.json` is the independent verdict; `verify.mjs` checks the assertion delta,
immutable inputs, exact outcomes, both whole cohorts, source/package/private
identity, native cleanup ordering, import hashes and service closure. It does not
execute guests or modify the seal by default. `ARTIFACTS.json` fixes the owned
source/evidence bytes. Captured `.fixture`, JSON, NDJSON and `.txt` files are
evidence/input data, not additional test-discovery sources. Raw captures retain
their original blank lines; no byte normalization is applied.

Verify without rerunning either cohort:

```sh
node tests/integration/safejs-cleanup-regression/sink-migration-review/verify.mjs
```

Exact commands used for the two product/engine executions are recorded in
`evidence/independent-replays.json`; `replay.mjs` supplies their outer containment.
It refuses to overwrite those captures. The immutable versioned runner accepts
fresh owned destinations for a separately authorized reproduction:

```sh
node tests/integration/safejs-cleanup-regression/sink-migration-review/migrations/sink-v2/run.mjs tests/integration/safejs-cleanup-regression/sink-migration-review/evidence/NEW_REVISED
node tests/integration/safejs-cleanup-regression/sink-migration-review/migrations/sink-v2/run.mjs tests/integration/safejs-cleanup-regression/sink-migration-review/evidence/NEW_ORIGINAL --original
```

**Scope ends at this single fixture migration acceptance.** No environment feature
work, additional cohorts, source fixes or upstream changes are performed.
