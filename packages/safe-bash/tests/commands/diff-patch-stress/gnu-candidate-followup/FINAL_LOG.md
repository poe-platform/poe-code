# Independent candidate follow-up handoff

Only new files in `tests/commands/diff-patch-stress/gnu-candidate-followup/`
were authored. No delegation, source edits, existing test edits, root/config
changes, runtime dependencies, or writes to the private upstream checkout.
Native fixtures were isolated under the owned subtree and removed; inspection
after the runs found no remaining owned `.native-*` directories.

## Exact run outcomes

All captures are retained as `evidence-2026-08-26T<TIME>.json` and matching
`-validation.json`. Times below are UTC; validation embeds the complete TAP,
typecheck stdout/stderr/status, and before/after SHA-256 maps.

| Start, August 26, 2026 | Tests | Typecheck | Source hashes | Runner exit |
| --- | --- | --- | --- | --- |
| 22:08:16.201 | 12 pass / 8 fail / 20 total | 0 | changed | 1 |
| 22:09:24.800 | 21 pass / 0 fail / 21 total | 0 | equal | 0 |
| 22:10:22.097 | 21 pass / 0 fail / 21 total | 0 | equal | 0 |

Commands for each run:

```sh
node tests/commands/diff-patch-stress/gnu-candidate-followup/run.mjs
```

The runner executes exactly these operations, with absolute test/config paths
and the actual Node executable also recorded in validation:

```sh
node --import tsx --test tests/commands/diff-patch-stress/gnu-candidate-followup/candidates.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/commands/diff-patch-stress/gnu-candidate-followup/tsconfig.json
```

No skipped/cancelled/todo cases. No whole-repository test or build claims.

## Preserved failures and verifier corrections

The first capture independently reproduced six create-then-select failures:
GNU exit 0, `a=new`, unused links/sentinel unchanged; VFS exit 2 rejected the
unused symlink, hardlink, or symlink parent in both normal and atomic modes.
The unused-loop fix was already present in this process: all four loop parity
cases passed. This run changed `patch-gnu-paths.ts` and `patch.ts` during the
observation window; it is not a single-revision verdict.

Two first-run failures were verifier assumptions, not product defects: GNU
selected-loop refusal emits a `.rej` in non-dry-run mode. The corrected tests
assert that exact native reject namespace and preserve the project's separate
unchanged-state safety requirement. The first draft's additional creation
atomic-dry-run refusal expectation was removed: it must not impose native
dry-run target selection on the project's staged atomic extension. Two real
offset/backup-hardlink controls were added, yielding the final 21-case suite.
No old capture was overwritten or reclassified as passing.

After concurrent author changes, both bounded reruns passed all 21 cases.
The last rerun also strengthens native unused-file/link identity assertions
and guarantees fixture cleanup when the sentinel check itself fails.

## Last observed source identity

At 22:10:22.097Z, the before/after hashes agree:

| Source | SHA-256 |
| --- | --- |
| `src/commands/diff-patch/patch-gnu-paths.ts` | `360031e365873ae814fe8033a2ca59437e326374681d1c6716b78c9aa3af4f03` |
| `src/commands/diff-patch/patch.ts` | `1d1c3325c0fc065af1bb25bd1e1c19abf494abb017a6c20dac595ba5c8cc50f6` |
| `src/commands/diff-patch/unified.ts` | `a8659f40aeb9d1cac3548ffd24950e652eeace92cef1339de9e3a5e5ed7e10fb` |

HEAD observed after that run was
`b797f43bb28eae609f5ff7f079ba636187240f13`; uncommitted source changes existed,
so HEAD alone does not identify the tested product. Full source/fixture/helper
hash maps are in the validation records. Equal endpoint hashes are not a frozen
snapshot or proof that no transient edit occurred between reads.

## Gaps for root

No remaining product failure was observed in these 21 cases. Root still needs
the full frozen independent checkpoint; this worker deliberately did not
duplicate it. Creation with atomic dry-run is not covered by a GNU-success
claim. Remote adapters, broader utility compatibility, crash/rollback behavior,
and superiority remain outside this focused follow-up. The README documents
the exact default-GNU versus atomic/dry-run/safety distinctions.

This log is the handoff to root, not a product completion declaration. The
owned-files-only commit identifier is supplied in the final response.
