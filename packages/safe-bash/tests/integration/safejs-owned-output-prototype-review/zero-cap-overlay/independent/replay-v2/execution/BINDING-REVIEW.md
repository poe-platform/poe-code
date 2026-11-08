# Independent input-binding repair v2 — 2026-08-27

Reviewer: Codex Independent Leaf Verifier, thread
`01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4`, different from the overlay author.

ROOT explicitly authorizes this narrow acquisition/location/Git-identity repair
and one new attempt. Prior refusal8e950bd8, its25 blocked rows/private0, original
inspection50897e9e, admission88367f70, old execution326ca8e7 and all signatures
remain immutable. This is not a source/security/runtime defect correction.

## Exact inputs, not a live evidence subtree

prepare-inputs.py obtains the exact88 paths from the previously admitted manifest
and verifies that a61e63bc46e8389e59c0d8fdc1d424003f62c769's complete author Git tree
contains exactly those paths. Each regular input is written from that exact Git
blob and checked against its already-bound size/SHA-256, then made read-only.
Files are0400, directories0500; this is cooperative regular-copy immutability,
not an OS isolation guarantee. No symlinks/worktrees/private reads/builds/install.

The new snapshot is
`/private/tmp/safe-bash-zero-overlay-independent-v2-vikcxq_y/input-snapshot`.
The new output root is its parent, not the consumed attempt1 root. Input snapshot
and output directories are disjoint. Authentication checks exactly88 files plus
the explicit directory shape: an unknown file OR directory in the snapshot is
refused. Nothing is pruned, no unknown path is broadly ignored, and expected
hashes are never derived from the live author worktree.

The live author tree was enumerated once for names only;28 non-input file paths
at that observation are recorded in INPUT-PROVENANCE.json. Their contents were
not read for preparation, semantically inspected, copied or executed. This is a
point-in-time non-input inventory, not a claim to inventory future author work.
No waiting, polling, deletion or control of the productive author occurs.

## Why a location binding is necessary

The frozen admission.mjs sets `author` from its import.meta.url and computes the
Git path of FREEZE.json and each input relative to the fixed public repository.
On a regular TMP copy those filesystem-relative paths are not repository Git
paths. Everything else in that module can remain byte-identical: it still checks
the actual copied tree, exact freeze manifest and Git bytes, admission fields,
Node identity, candidate/package inventories and reference files.

Rather than rewrite admission.mjs or another author input, the new independent
parent-only `--import git-location-binding.mjs` supplies this binding at the
public Git invocation boundary. It translates only:

1. The exact `git -C REPOSITORY -c core.fsmonitor=false log -1 --format=%H --`
   lookup for copied FREEZE.json, to the admitted original Git path.
2. The exact corresponding `show a61:<snapshot-relative>/<listed-entry>` lookup,
   to `show a61:<original-author-Git-path>/<same-listed-entry>`.

Only the pinned author commit and one of the88 fixed entry names are accepted.
Unexpected snapshot-path uses fail closed. All non-snapshot Git requests and
non-Git subprocess calls pass through unchanged, including private metadata
queries; there is no private path translation. Every actual translation is
journaled under the fresh independent cohort output. It changes no Git/config
state, environment file, product source, author source, return value, byte stream,
case order, budget, signal or cleanup behavior. The4096 bound is on parent-only
metadata lookup translations, not a changed guest/transport budget.

All88 source files in the runnable snapshot, including admission/run/child/common/
guard/profile/scorer/cases/guests, are **exact original Git bytes**. Effective
author control flow/assertions remain identical; only the filesystem-to-Git
identity mapping at the allowed host lookup boundary changes. No source transform
or module-loader code substitution is used. The child argv/environment are still
created by the exact author parents; they do NOT inherit this parent --import.
Actual engine/product imports remain under the existing child loader/guard.

## Current-repository reads and independent predicates

Historical public references that the frozen drivers still read from their
original repository paths are explicitly bound: the77 author REFERENCES entries,
plus complete original lifecycle/proposal trees, yield155 commit/path bindings.
Each is checked against the exact Git SHA and actual file bytes; none is live
author execution evidence. Original private/source/copy prerequisite receipts
retain their qualification. Current public live-source inventories collected by
the unchanged lifecycle parent are diagnostic, not inputs to the940 candidate.

assess.py is byte-identical to326ca8e7; no public outcome, error, body/header/stderr,
counter, order, source or timing assertion is changed. orchestration-delta.patch-data
contains the complete independent run.py delta: use snapshot instead of live tree;
authenticate its fixed shape/public references; use admitted original Git path
for blob identity; include snapshot metadata in before/after guards; supply the
parent preload/log path. There is no author-driver semantic adaptation.

The independent source213/full940/compiled708/package709 identities remain
2dc95c3a/a7333f19/65dda12b/e207a231 as fully bound in BINDINGS.json. No new build or
overlay occurs. Static Python parsing,155 reference-byte checks and one pinned
Node parser-only check succeeded; no product/private/guest/native probe ran.

## Released scope and closure

ROOT-RELEASE.json binds the actual88367f70 admission and exact a61 freeze, and only
surface8/lifecycle11/controls6 for this new attempt. Surface retains unconditional
bounded continuation; first-nonpass stopping remains within lifecycle/controls,
with all open-positive gates. The independent outer wrapper stops later cohorts
on a nonpass. First attempts remain immutable; no automatic retry or rescue.

Each entered cohort has fresh independent and frozen-parent private before/after
HEAD/tree/index/status/staging/6metadata/264-file guards, including failure. All
private bytes remain read-only; pre-existing dirty state is preserved. Actual
copied source hooks, not an installed private package, are the intended runtime.
Pinned Node/tools/candidate/snapshot/import hashes and metadata/directory guards
remain mandatory. No ambient credentials, implicit external/native transport,
private install/build/worktree/symlink/CLI/barrel/upstream edits are authorized.

The same seven predeclared data-only mutants may run only after independently
passing actual baselines; they are not guest passes. No extra host/guest breadth.
NO-PROMOTION; actual audit must precede later ROOT rebase/proposal work.
