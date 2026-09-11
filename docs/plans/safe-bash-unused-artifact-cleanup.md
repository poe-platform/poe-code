# Safe-bash unused artifact cleanup

The user requested removal of unused material after measuring 4.37 GB of tracked
contents in `packages/safe-bash`. Almost all of that size is captured test and
benchmark output.

## Scope

- Remove historical generated data only when it is outside maintained build,
  test, typecheck, lint, and consumer input dependencies.
- Preserve runtime source, test source, required fixtures, authenticated input
  inventories and their dependencies, and existing local changes.
- Historical preservation guidance does not prevent this explicitly requested
  removal of unused captures. Git history retains the original committed files.
- Do not rewrite Git history or alter release configuration.

## Verification

1. Inspect current entrypoints, input inventories, and actual file references.
2. Record candidate files and byte counts before deletion; verify each file is
   unchanged from its committed version before removing it.
3. Check that test discovery and authenticated input validation remain intact.
4. Run maintained checks covering the removed inputs and affected consumers.
5. Report removed files and bytes, remaining size, and verification results.

Deleting tracked artifacts reduces checkout contents. It does not remove old
blobs from Git history or promise an equivalent reduction in clone size.

## Cleanup results

Removed 8,435 unchanged committed test-data files totaling 1,574,515,594 bytes,
plus one 25,956,442-byte historical benchmark archive. Total: 8,436 files and
1,600,472,036 bytes, reducing tracked contents from 4.37 GB to 2.77 GB (36.6%).
The selection excludes source, test code, configuration, authenticated inputs,
local changes, and conservatively resolved direct and indirect references.
Referenced historical artifacts are retained conservatively; this does not mean
every remaining artifact is required at runtime.

The final selection also removes descendants mentioned only by historical
inventory records that current lint checks authenticate as opaque bytes. Those
owner records are unchanged; their archived path lists are not current file-read
requirements. Direct current readers and selected input records remain protected.

After deletion, the exact list of 642 active test files is unchanged, all 1,804
lint input bindings authenticate, and full typecheck-input verification passes.
All 282 build/test-runner tests pass. Runtime validation also needs the root
bundle outputs used by the package's public filesystem imports.

The normal `npm run build` completed successfully once, including root bundle
outputs. An attempted 146-file filesystem runtime run was interrupted after
another build removed the shared generated filesystem bundle. A subsequent build
was blocked by concurrent safe-js edits: TS7053 and TS2339 in
`packages/safe-js/src/interp/arguments.ts`. No current full runtime-suite pass is
claimed, and the unrelated source edits were left untouched.

The final six-file retained-evidence and replay selection passed all 97 tests
with no failures or skips. Together with the 282 build/test-runner tests, this
provides 379 passing focused tests. The evidence selection uses the maintained
`scripts/test-reporting.mjs` entrypoint with `--import tsx --test-concurrency=1`.
The parent environment is preserved while repository-local Git variables are
cleared in the test child environment. Committed-archive release tests exercise
old Git trees, not this uncommitted cleanup, and are not claimed as its validation.

Historical replay tools may require restoring deleted captures from Git. No
current validation rule or source file was changed to accommodate the cleanup.
