# Independent empty-file delta verification

## Frozen scope

Verified on 2026-08-26, Node v22.22.2, Darwin arm64.

- Exact source commit: `6e1240ef82679996c2a6ba9a3566ec6a38f6e5a9`.
- Source tree: `72d66a91d7fd8cab320685b79469b2e31e6c2edb`.
- Previous checkpoint: `b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed`.
- Snapshot: `/tmp/safe-bash-diff-empty-Fghod8`, created with `git archive` of
  the exact commit, not a copy of the changing working tree.
- Root dependency link: snapshot `node_modules` points to
  `/Users/kjopek/Workspace/safe-bash/node_modules`.
- The only test overlay is this new `emptyfile-delta` directory. All 545
  committed blobs were rehashed against the frozen Git tree after validation;
  all matched. No source, existing tests, filesystem code, or manifests changed.
- Frozen `patch.ts` SHA-256:
  `e9019ebb41bd68b85a1022d23cabdaec421eacf6cd04b8a005202b87cd4f8aed`.

This supplements the separate b92841a checkpoint with the 6e1240e delta. It is
not a verification of later global HEAD, the dirty working tree, every adapter,
all Bash behavior, or superiority over another shell.

## Independent inspection and denominator

The delta adds short/long remove-empty option parsing, stages empty results as
removals, and moves the existing-target creation rejection until current staged
contents are available. Creation accepts only empty regular files, not arbitrary
existing content. Existing path, link, original-content, and commit checks remain.

All **89/89 independent test cases pass**, using only the public root exports
`Shell`, `diffPatchCommands`, and `MemoryFileSystem`. Literal arguments are quoted
for the real virtual Shell parser; no native process substitutes for the product.

| Independent cases | Count |
| --- | ---: |
| Three formats: no-E retention, both E spellings, apply/dry/reverse, explicit absolute target with decoy headers | 21 |
| Context/unified null creation and reverse deletion; inferred/absolute target; missing/empty/occupied; apply/dry | 48 |
| Mixed delete/recreate, three starting formats, forward/reverse, one final write | 6 |
| Later hunk conflict or occupied creation, no early writes | 2 |
| Final symlink, hardlink, ancestor symlink, creation/removal rejection | 6 |
| Pre-cancellation preserves exact reason and performs no filesystem calls | 2 |
| Injected write/rm failure before/after effects, earlier commit retained | 4 |

The primary 69 vectors compare the whole remaining virtual namespace after
excluding the authorized target, detecting decoy, backup, reject, and unrelated
path changes. Failure tests verify the third file is untouched, the first remains
committed, and the failing second operation can already have changed its target.
The diagnostic honestly reports `1/3 files committed` and possible side effects.
No rollback or cross-file transaction guarantee is asserted.

The instrumentation preserves synchronous stream-returning methods. Shell passes
a composed cancellation signal, so tests check a real consistent command signal,
not identity with the caller's signal. Those two harness assumptions were corrected
before the recorded final run; neither required a product change.

## Native controls and explicit differences

`native.ts` is an opt-in bounded control runner, not another broad comparison
framework. It refuses a changed or unavailable pinned executable:

- GNU patch 2.8: `/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`.
- SHA-256: `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
- Literal argv, `shell: false`, isolated temporary working directory per vector,
  3-second timeout with SIGKILL, 65,536-byte input/output bounds, C locale, UTC,
  `PATCH_GET=0`, `--batch`, and `--no-backup-if-mismatch`.

**27/27 independently selected native vectors match exit status and exact target
bytes/existence**, and GNU independently matches all 27 predefined expectations.
These are a subset of the 89 cases, not 27 additional independent tests. They
cover no-E controls, both E spellings, short-E dry/reverse, and context/unified
forward/reverse null creation into missing, empty, and occupied absolute targets.
All three native decoys remain unchanged. Full input, argv, diagnostics, status,
target contents, and auxiliary directory entries are in `native-evidence.json`.

**This is not full filesystem-effect parity:**

- Six native E removals also prune the now-empty authorized parent directory;
  virtual patch preserves that directory.
- Four occupied-creation native controls attempt automatic direction switching
  and leave `target.rej`; virtual patch rejects before writes and creates no
  reject file. Both retain occupied target bytes and return status 1.
- Diagnostic wording is recorded, not equated. These differences are not silently
  removed from the denominator or presented as universal GNU compatibility.

No new product defect was found within this delta's contract. The observations
above and the nontransactional failure behavior remain explicit limitations.

## Existing suites and reproducibility

All commands below run inside the frozen snapshot, never against later HEAD:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts
node --unhandled-rejections=strict --import tsx tests/commands/diff-patch-stress/emptyfile-delta/native.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch/*.test.ts
DIFF_WHITESPACE_ORACLE=/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/safety/*.test.ts
GNU_PATCH_BINARY=/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch node --unhandled-rejections=strict --import tsx tests/commands/diff-patch/patch-gnu-reference.ts
node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --target ES2023 --lib ES2023 --types node --module NodeNext --moduleResolution NodeNext --skipLibCheck tests/commands/diff-patch-stress/emptyfile-delta/*.ts tests/commands/diff-patch/*.ts tests/commands/diff-patch-stress/safety/*.ts
npm run build
```

| Validation | Result |
| --- | --- |
| Author suite with default Apple native whitespace oracle | **825/829**, four failures retained |
| Same author suite with its existing GNU-whitespace oracle option | **829/829** |
| Existing independent safety suite | **151/151** |
| Existing author GNU patch reference driver | **156/156**, not independent |
| Strict TypeScript, all three selected test scopes and transitive source | Pass |
| Build, output only in snapshot | Pass |
| Built `virtual-bash` public-root import, E removal, creation into empty file | Pass |

The four default-oracle failures are two all-C-locale-whitespace cases (normal
and unified), `-b` unified original-context bytes, and context incomplete-line
markers. They are in unchanged `diff-formats.test.ts`, not the empty-file delta.
Their names and raw-log hashes remain in `validation.json`. Selecting the existing
GNU control is a separate run, not a rewrite of those expectations or a claim
that the default-native matrix passes.

GNU diffutils 3.12 control SHA-256 is
`f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`;
Apple `/usr/bin/diff` SHA-256 is
`214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede`.

The author reference driver requires a `.git` directory. The archive has none;
an initial run failed after GNU pruned that empty directory. The successful rerun
used snapshot-only `.git/keep -> ../package.json` to keep the harness parent
nonempty. No Git repository was initialized and no driver source was changed.

Raw TAP, reference JSON, type/build logs, and public-API smoke output are retained
in the snapshot. `validation.json` pins their SHA-256 hashes and test-overlay
hashes. A future rerun should write separate evidence rather than replace these
recorded observations. No broad benchmarks were rerun.
