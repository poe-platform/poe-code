# Independent R3 repair/tool review v20 — preexecution freeze

2026-08-28. Delegated leaf reviewer; only this NEW directory is writable.
Timing: post-author, after handoff/source inspection, before independent controlled
execution. This is not a blind or pre-author review. No author control harness runs.

## Immutable subjects and authority

- Repair source `437778996f60109e212e20b1b242455866fda285`, evidence
  `2ae74702def6b06f1519c9a88c12d6f748611250`.
- Tool recipe `adcb1467caad7165361f035f110b40dd1bbdf07d`, evidence
  `26de751f7c1e2e39edfe38c976dc52ce9516fac3`.
- Historical product `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, expected pack
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
- R3 `c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5`, diagnosis
  `cd9d08be0918ddc5bd59c40b088e06be2b5b2f54`, independent diagnosis
  `682aad1292eac3dc82a2c15a48b9f0c6ec9c5628`.
- Protected committed trees: author repair `93a2c4ee9b9e5ea2524f227966dd1440097ed511`,
  tool `5debad61e8741dc892424ed238750e0dee37ee49`, independent diagnosis
  `5c531f639f66d3eecc8fd28e7d8a593d680e0b94`, author diagnosis
  `495c69e9dc0d3d73595b11c5ad8853aebb6b7547`, released R3
  `4b156253a988091d46fb4cee60e9e416c06ec0bc`.
- ROOT ratifies ONLY `/usr/bin/cut`, `/usr/bin/sort`, `/usr/bin/tee`,
  `/usr/bin/xargs`, `/bin/cat`, each paired with `/usr/lib/libSystem.B.dylib`
  ENOENT, as OS-METADATA QUALIFICATION. Missing image hash remains null.
  Readable dyld metadata is not runtime closure. No other image, GNU substitution,
  version execution, PATH/permission widening, release or next-gate GO.

## Cohort and executable boundary

ONE invocation, no retry: existing
`/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node --experimental-vm-modules --disable-warning=ExperimentalWarning tests/integration/full-gate-20260827/unified76-driver-independent/r3-repair-v20/review.mjs`
with repository cwd. Actual environment changes: none. Subject VM receives only
an explicit synthetic process object; no real process/fs/child-process handles.
No real child is created, including a child pretending to be a stub. Node builtin
syntax stripping is not a compiler/declaration check. No author runner, inspector,
product, oracle, build, gate, private setup, service, signal/socket probe executes.

Read set: exact paths in review.mjs, 15 SOURCE-CANDIDATE paths, 7 EVIDENCE-SEAL
members and 8 tool SEAL members, plus the two seal files themselves. Manifest
members must be within the exact corresponding evidence directory, unique and
bounded. Roots are authenticated first by committed Git blob or pinned SHA256.
No recursive live filesystem scan; no native image bytes read. Additional Git
metadata checks may inspect only the declared revisions/path sets and index.
Read caps: 4 MiB/file, 16 MiB total, 120 distinct files, 240 reads. Results at most
1 MiB. In-memory filesystem: 50,000 operations, 8 MiB retained, 1,024 paths per
scenario. At most 160 recording dispatches, 160 module evaluations, 140 checks,
15 seconds elapsed; VM evaluation timeout 1 second. Real output writes: exclusive
`RESULTS.json` and `RUN-CLAIM.json` only in this directory. Claim prevents rerun.
All unexpected exceptions/budget breaches persist as failure, never skip/pass.

Exact subject module paths/import allowlists and finite recording tool routes are
in sealed review.mjs. SourceTextModule loads complete unchanged hash-bound source,
not extracted functions. Every import is either a pure builtin or a SyntheticModule;
all unused exports throw. No dynamic import is allowed. Filesystem, crypto identity,
process and subprocess effects are synthetic; model identities are NOT OS identities.
Registration-only test modules never dispatch other tests. execute.mjs is inert
until benchmarkTypeInvocation; execute is forbidden. S3 and the tool inspector are
SOURCE only because they do top-level work. build-audit top-level work, if exercised,
uses synthetic filesystem/process only. Product exports are fail-closed stubs.

## Independent acceptance criteria

SOURCE: exact 15-file author delta, 13 fixture-only overlay proposal, unchanged
f5 shipping inputs by selection, original 632 bodies immutable, root compiler
path/cwd/argv and production-build distinction, both Git routes/core and npm
CLI/Node roles, TAP option placement, scratch separation without semantic filters,
cleanup scope/ordering and preserved environment/input/assertions. Source437's
whole tree is NOT f5 (unrelated commits exist); never use it as combined candidate.

DATA: seals/source bytes, five literal scripts/file inputs and aliases, five exact
OS pairs, dyld-only readable dependency, no unknown image admission; author45/17
and future20 remain separately labelled. Prior 928 captures/286 additions and
19425P/132F/7skip/6-of-14 stay historical, bound through committed metadata only:
no 114MB rehash, root-content revalidation, rerun or deletion.

STUB: 71 frozen table fixtures traverse actual helper native() with recording
spawn and in-memory FS, checking identical argv/input/env and owned cleanup;
not 71 native passes. Selected write/spawn/cleanup failures, awaited late cleanup,
ordinary foreign sibling and empty-parent refusal; preserve primary thrown identity
when cleanup also fails, and surface cleanup-only failures. Shell semantic canary
must remain visible with separate TMPDIR. Scratch success/throw/outside-root controls.
Git/npm positive and wrong-identity refusals; compiler selection with synthetic
receipt and corrupted/missing metadata; reporter exact success, wrong-format,
nonzero-with-pass-text and timeout/late-pass refusal. No actual compiler/CLI runs.

SYNTHETIC validator controls: exact finite own-data primitive keys/types/values,
array length/order, reject holes/accessors/extras/wrong roles without coercion;
cross-realm prototype identity is irrelevant. Original thrown objects are compared
by reference, not JSON/prototype equality. These validate this review's data/stub
roles only, not a shipping admission guard or hostile-host sandbox.

Any requirement failure is retained as FAIL, with observation and source/control
limitations; harness failures are separately marked and not retried. A primary
error lost to finally-cleanup is a source defect, not a passing negative control.
No skipped/unexecuted obligation counts as pass. Additional controls/repairs need
a separately sealed version, not post-hoc edits to this runner/results.

## Future ACTUAL preparation, not GO

After source defects repaired, select f5 + exactly declared new fixture overlay
in a NEW candidate and rebind all affected profile/driver/evidence hashes. Require
fresh explicit native/image/caller admission and one-attempt authority. Preserve
the author's 20 prospective controls as UNRUN ACTUAL. Initial future packet can
name the five original G08 scripts once each (3s/16MiB each), actual xargs-to-cat
argv/space preservation, 71 table rows once, two reporter wrappers once, and
separately admitted compiler/Git/npm holdouts. Do not launch this aggregate on this
review's authority; ROOT must freeze the exact smaller chosen packet first.
