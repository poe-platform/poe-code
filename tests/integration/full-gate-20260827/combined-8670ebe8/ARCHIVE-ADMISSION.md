# Explicit committed-archive admission handoff — 2026-08-27

Source/harness **6699804a**. Root's explicit authorization applies only to the
previously selected **8670ebe8f0d39966c2de2638780437398e5f8490**. No new product,
fixture, native profile or candidate is selected. Different Plato review is
**pending**; its85858fc3 pre-execution plan is not acceptance.

```sh
TREE_NATIVE_BIN=/tmp/safe-bash-tree-external-oracle-TbVJVK/tree \
node tests/integration/full-gate-20260827/combined-8670ebe8/run.mjs \
  --handoff 8670ebe8f0d39966c2de2638780437398e5f8490 \
  --execute /tmp/full-gate-8670ebe8-NEW-EXCLUSIVE-OUTPUT \
  --committed-archive
```

Omitting that final flag retains strict live-worktree admission. The global
`preflight-repair/preflight.mjs` and root release entrypoint are byte-unchanged.
The original live-dirty rejection86c63b39 stays preserved. The new mode does not
test HEAD, copy a dirty worktree, require other authors to stop, or include the
ongoing registered-rg source fix. Known frozen failures remain measurable.

## Exact additional checks

`assessCommittedRevision` verifies the full selected commit/tree,3246 scoped
code/configuration bindings and560 canonical paths directly from Git objects.
Every referenced blob must exist before extraction. Native49 still uses the
unchanged separate pins; missing/changed/nonexecutable assets refuse78 before
creating the output directory, archive, build or suite. No live product/test/
package/configuration file contents are admitted through this mode.

After fresh extraction and before copying tools or creating isolated Git metadata,
`verifyFreshCommittedArchive` checks the exact file **and directory** sets,
regular/symlink kinds, executable modes, sizes and Git blob hashes. Extras,
missing files, mutated source/package/build configuration, nonowned hardlinks
and escaping links reject. The complete archive receipt is saved independently
of the moving worktree; tracked input hashes are still verified after each phase.
Build outputs and native/tool staging remain separately recorded, not source
overlays. The unchanged220-input cleanup envelope is checked against the archive
and both variables remain bound to8670 with compact hashd9309d27…67b6.

In archive mode, the native prerequisite authority modules and their transitive
test/helper imports load from the authenticated archive rather than the live
checkout. Their explicitly pinned native payload locations remain external tool
inputs, not alternate product sources. The new local prerequisites helper is a
copy of the old preserved helper with five bounded source-location/primary-oracle
changes. Private SafeJS copying and identity checks are unchanged. The external
gate harness hashes are recorded separately from candidate source hashes.

## Author controls and scope

Both bounded attempts pass22/22. They create only an owned miniature Git repo,
archive and pinned test asset; no production runtime, compiler or whole gate runs.
The second attempt strengthens the actual CLI missing-native control to use a
valid `/tmp/full-gate-*` output name. The first attempt's raw evidence is retained;
its earlier output name would independently be invalid after admission, though
the observed rejection was already the requested78 before creation.

Coverage: committed bytes despite dirty staged/untracked live source; unchanged
live guard refusal; exact clean archive; nine dirty-archive variants; wrong tree,
wrong scoped blob, unknown commit, missing Git blob; changed/nonexecutable native;
actual8670 Git-object/native49 admission; actual mode missing-native78 before
output; unchanged global guard bytes. All owned children and scratch settle/clean.
These22 are preparation checks, not22 product passes or a substitute for the
different reviewer's18 planned cases and mutants.

Raw captures and source hashes are in `archive-admission-evidence.json`.
Reproduce with:

```sh
node tests/integration/full-gate-20260827/combined-8670ebe8/archive-controls.mjs /tmp/NEW-ARCHIVE-CONTROLS.json
```

The independent reviewer should check the actual explicit flag route, source/helper
locations, receipt equality, dirty archive/missing blob/overlay/symlink refusals,
preserved strict mode and meaningful guard mutants. No full gate launches until
that distinct review is relayed; root has already authorized launch afterward
without selecting another candidate or waiting for the unrelated rg fix.
