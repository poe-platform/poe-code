# Split dangling-output implementation follow-up

Bounded leaf ownership: `src/commands/split/**`, `tests/commands/split/**` and
requested `/tmp` coordination records only. No delegation. Root/public/default,
package, filesystem, contracts and all other source remain untouched. No independent
reviewer corpus was opened. No additional root failure record was available at
the initial, post-fix or final coherent checkpoints.

## Commits and source identity

- Historical author source freeze: `1836795aed012ad734fedbd0ed56c2c98ab57f56`.
- Historical final author handoff: `4244e9a`.
- Expectation correction / preserved initial failures only:
  `16d884c01e66d7cea3939a2a401cc06623bc4e72`.
- Source fix and added contract coverage:
  `09ae82b3ee422038f21c26619788bf47de4888f7`.
- Final six-file TS source digest:
  `8e4f559d779dead7205a56e75286642980ed2930d4629f5c13a6beefac88206d`.
  Algorithm: SHA256 of sorted `path + NUL + SHA256(file bytes) + newline`.
  `evidence/dangling/final-manifest.json` retains per-file, fixture, imported-source
  and generated-build hashes. Concurrent repository state is disclosed, not frozen.

## Defect and behavior

Previously `Outputs.prepare` handled ENOENT from `lstat(output)` and from
`stat(dangling-output-link)` alike, opening the link name with `wx`. That rejected
the stable dangling link with EEXIST. The fix separates these observations and
resolves the latter through supplied `readlink` and parent `realpath`, preserving
target components for VFS traversal, then exclusively creates a missing target.
Known existing input/earlier-output aliases still fail before destructive writes.
Existing opaque identities still fail with ENOTSUP unless truthful capabilities
establish distinctness. Ordinary existing symlink overwrite remains supported.
Missing `readlink` is a narrow dangling-resolution capability gap, not a global
symlink ban. No FS changes, new runtime dependency or product host fallback.

## Results

- Original author tests: retained original 43 count and evidence; rerun 43/43.
- Corrected expectation plus native regression before source fix: 29/31 tests
  passed, two failed. Native observations: 6/22 passed, 16/22 failed.
- Same 11 GNU inputs on MemoryFS and explicitly rooted RealFS after fix:
  22/22 match exact status/stdout/recursive namespace/file bytes/link targets;
  positive stderr exact, negative diagnostic profiles explicitly asserted.
  Initial and final native fixtures, argv and both native profiles compare exactly.
- Apple is separate: six successful target-creation inputs agree; negative status
  74 and destructive nested input-alias behavior are recorded, not adopted.
- Added contracts: 16/16; full scoped author suite: **60 passed, 0 failed, 0 skipped**.
- Scoped noEmit: pass; isolated owned build: pass; coherent compiled host/plugin
  under plain Node: pass, including binary reassembly and dangling relative target
  beneath a symlinked prefix. No package subpath/public integration claim.
- `git diff --check -- src/commands/split tests/commands/split`: pass.

Additional contracts cover stdin/writeFile fallback, exclusive flags, file/symlink/
hardlink insertion preserving raced data and input, alias insertion during target
resolution before input acquisition, earlier-output alias refusal, exact partial
outputs on limits/cancellation, metadata failures, absent readlink, opaque existing
identity versus absent-target success, and exact cancellation with late rejection
observation. Native controls cover relative/absolute/chained/nested paths, symlink
before `..`, symlinked prefix, missing parent, loop, non-directory, nested input
alias and completed outputs before later failure.

Two fixture corrections are separate from the unchanged native regression:
RealFS reconstructs an EFBIG syscall/path diagnostic, so the new budget fixture
now asserts that exact RealFS string rather than assuming MemoryFS wording;
optional method omission uses a forwarding Proxy to satisfy exactOptionalPropertyTypes.
Raw initial contract failure and noEmit errors remain, with full explanation in
`evidence/dangling/README.md`. No oracle changes or diagnostic blanket waivers.

## Limits and cleanup

Point-in-time identity is not a lease, transaction, ABA defense or protection from
arbitrary hostile external path mutations. The tested insertion windows use `wx`
and preserve raced content; no broader race-proofness claim follows. Completed
effects cannot be rolled back; no product deletion or fake cleanup is added. Input
redirected as raw stdin has no pathname identity. Existing unsupported adapters
and opaque identity gaps stay honest; no remote provider support is invented.

The module stays source-only opt-in; actual defaults remain 60 with split absent.
GNU evidence is pinned GNU9.7 on Darwin, not GNU/Linux. This is bounded author
validation, not independent acceptance, a full project gate, universal parity,
superiority or a duration-completion claim. No root dist emission or native install.
Owned generated `.build` was removed after hashes/consumer results were captured;
no owned `.native-*` scratch remains. Other workers' edits/index/native artifacts
are preserved. No watcher, child worker or lingering native test process remains.
