# Independent frozen review

## Final source-bound result

Root confirmed fixer session exit and released the final replay in
`evidence/fixer-closed-gate.txt`. Source commit
335d2c3705b4892a56e807010cd7ca50145fefce has eight-file manifest
4c52a321778aafad0e41b5858d30746d728306e35e26a44554146a69a05c91a0.
Fixer regression and handoff commits are1ea140b50f0b4edcfa28a60e2f89351b97e509a5
andf4ab93bdf5b864fa9ed6310c6b31c0923c92cea7. Initial review commit970adf2 retains
the original failures before that replay.

| Final comparison | Selected semantics | Exact stdout/status/stderr |
| --- | --- | --- |
| Original literal85 | 84/85 | 67/85; five stderr fields originally unspecified |
| Native-backed85 | 85/85 | 68/85 |
| Corrected contract groups | 39/39 | Separate contract assertions, no skips/cancels |

Final native status and stdout each match85/85; stderr matches68/85. All17
diagnostic-negative differences remain raw and explicitly outside full-byte
parity. The four initial valid-input failures now pass with unchanged fixtures
and native expectations. The original-only lone-dash discrepancy remains an
observed failure, not skipped, relabeled green or called a source fix.

Actual final product executions ran2026-08-27T05:10:42.572Z through
05:10:44.349Z; scoped noEmit/isolated build completed05:10:45.610Z, both with
zero diagnostics. Snapshot `snapshot-2026-08-27T05-10-35-737Z` contains173 source
files and495 recorded entries, with current HEAD3e2b880 recorded rather than
misrepresented as the source-only commit. All eight command-source files match
the source commit. Independent full-source comparison finds only expand.ts,
fold.ts, strings.ts and added numeric-options.ts changed from initial source;
the API, shared helper, tac, README and other source files are unchanged.
Post-run copied bytes, Node binary hash and snapshot-bound loader resolution
pass. No mutable-root product run occurred during fixer ownership.

There were581 actual test invocations across8 runs: initial85+85+124+39+39,
then final85+85+39. These are repeated runs of85 frozen workloads and39
separate groups, not inflated case breadth. Author99 and fixer82 are reported
by those other workers and neither rerun nor added to independent totals.
All original JSON hashes remain unchanged. The original preparation harness
was reconstructed from the retained first-run harness and verified against its
preparation SHA256211b1df01ba84eb0c54da30dc5d4d95409db745027848b8d57e4ff232b783a32;
it is archived as `evidence/preparation-harness.ts.txt`, not executed as the
accepted profile. Final harness changes add a native report hash guard and
default native profile without changing any original/native input or outcome.

Only this reviewer's20 generated supplemental native fixture directories were
removed after checking their contents against recorded hashes. Raw oracles,
original preparation artifacts, source snapshots and external native providers
remain retained. No product/native/test server is intentionally left running.
All code/evidence publication is restricted to the owned stress subtree.

## Identity and chronology

The original preparation leaf froze85 cases at
2026-08-27T04:38:31.775Z, before source exposure, and closed with README-only
commit8877cc9 without executing the product. This fresh executor is a different
leaf, not a resumed worker, the author, or the subsequent source fixer. No
delegation occurred. The preparator later performed a limited source-safety
review; that does not change the earlier source-blind input freeze.

This executor first captured every one of the same20 strings inputs against
the provided GNU binutils2.44 executable, before inspecting product source or
executing it. The exact argv stayed unchanged, including no inserted `-a`.
The executable was configured `--enable-default-strings-all`; its before/after
SHA256 is90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f.
The all20 raw report hash is8082fe55e6f426d6ea76107abe27321aadd30046ad429c734c9123bc3c25e3ae.

The only original non-null expectation conflict was the lone-dash strings
case: original stdout `STDIN\nFILE\n`, GNU stdout `FILE\n`, both status0 and
empty stderr. It was reported to root before acceptance changes. Root then
authorized two separate85 comparisons. Original JSON bytes and annotations
were not edited; the two tentative expand negatives with native status0
remain native-success assertions. The native supplement is not20 new inputs.

## Initial author-source results

Source commit4af1b107d4b9449a2c4e7fed467d187448392fd5, manifest
57c6e29cc6fae6dce5946dddb211b0cc1bf94ef20badb4286546aeafe1e1d553:

| Comparison | Selected semantics | Exact stdout/status/stderr |
| --- | --- | --- |
| Original literal85 | 80/85 | 63/85; five stderr fields originally unspecified |
| Native-backed85 | 81/85 | 64/85 |
| Corrected contract groups | 39/39 | Not a native-parity denominator |

The four medium-severity native-compatible input failures are:

| Frozen ID | Literal argv | Expected GNU stdout hex | Actual |
| --- | --- | --- | --- |
| expand-legacy-stops | `-2,5` | `20205820205920` | status1, empty stdout, invalid option2 |
| fold-legacy-width | `-3` | `6162630a6465660a67` | status1, empty stdout, invalid option3 |
| expand-invalid-54 | `-t 2,+0` | `616263206465660a` | status1, empty stdout, invalid number0 |
| strings-minimum-legacy | `-5` | `66697665730a656e64696e670a` | status1, empty stdout, invalid option5 |

All four native references succeed with status0 and empty stderr. They were
reported to root with exact input bytes, source hashes and raw outputs; no
source was changed by this reviewer. They are not waived as unsupported to
produce a passing score. The fifth original-only failure is the independently
established oracle conflict, not a GNU product defect. Initial evidence was
committed970adf2 before a separately assigned fixer completed its changes.

## Coverage and boundaries

The85 independent workloads comprise tac18, expand24, fold23 and strings20.
The native oracle denominator is65 actual GNU coreutils9.7 captures plus20
GNU binutils2.44 captures on Darwin arm64, not GNU/Linux. Separate48 Apple
captures are controls, not additional product passes. No author test was read
as an oracle or executed by this reviewer; author tests are not independent
review results. No new corpus inputs or mutation controls were added.

All85 assertions compare byte stdout and exact status. Successful cases also
require empty stderr. The17 diagnostic-negative cases require command-named
diagnostics and, for missing operands, path and missing-file meaning. Their
native raw stderr is preserved and separately compared strictly. Matching
these selected semantics does not mean byte-identical GNU diagnostic prose.

The39 separate groups include8 chunk/reused-buffer replays, per-command VFS
error continuation, local budgets across operands, exact errno-shaped abort
reason propagation, blocked stdin/sink/VFS cancellation, late rejection
observation, sink ownership/backpressure, literal invoke through middleware,
factory preflight/replacement, shared shell limits, record/configuration
bounds, raw-object profile honesty and internal binary pipe/file preservation.
Complex pipelines exercise printf/expand/fold/tac/tee/head, strings/sort/tac,
redirects, cat and wc. Independent VFS execution here is memory-backed; no
deployed provider or real-filesystem interoperability claim follows.

Original frozen intents are preserved separately from their executable
harness. The preparator's unapproved eager dash correction was removed before
the first product run. Later diagnostic assertions were corrected only to
exact existing FsError text, with status, stdout, path and namespace effects
retained. The reviewer then fixed its own mistaken DirEntry[] expected shape.
Every initial failure, harness version and repeated execution remains durable.
See `evidence/HELPER-FAULTS.md` and `evidence/attempts.json`; repeated calls are
not additional workload breadth.

## Execution isolation

Each run uses a copied full172-file source tree with the real Shell and VFS,
copied installed loader/dependencies, and package/config metadata. Before,
copied and after hashes must agree; source symlinks are rejected and dependency
symlinks must remain internal and relative. The seven product files must match
the closed source manifest. Actual args/environment are in each `attempt.json`;
the older snapshot's `testArgv` field is a template, not an execution claim.
The runner uses isolated cwd, explicit TSXconfig, disabled cache and a minimal
environment with LC_ALL=C/TZ=UTC. No root dist or current JS output is loaded.
Runtime executable hashes are checked before/after; host system dylibs are not
copied, and atomic OS immutability is not claimed. Post-run audits verify
copied bytes and actual TSX/TypeScript/esbuild resolution into the snapshot.

Scoped strict noEmit and isolated source-factory ESM/declaration emission pass.
Neither is a root/package-public build or full-suite gate. Native executables
remain external reference-only tools; product source uses no host process/FS
fallback. Root exports/default registration, runtime dependencies, contracts,
shared FS, grep, Arch, SGID and historical diagnostics were untouched.

Public/default integration, full GNU parity, full user goal, superiority,
deployed-provider proof and the72-hour target remain outside this result.
