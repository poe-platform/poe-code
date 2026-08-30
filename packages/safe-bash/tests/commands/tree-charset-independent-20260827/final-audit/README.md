# Final packaging reconciliation and evidence audit

This post-inspection audit is bound to candidate
`f1a90436c45208ca248e058a039893233c608daa` (tree
`c5cdfff66e64bb4d68926c4f93a7620eb89e7dcd`, 70 default commands), not
mutable HEAD. Its executed reconciliation evidence is commit
`b76613226767d0e79995b643ebfa278b6e932780` (tree
`15e0c80e732a0fa2af356b111cfe4c16bfc94ea6`).

## Packaging reconciliation

The successful `attempt-001` proves the exact 761-to-762 difference. The
predecessor package inventory was read from blob
`ccebad7f309d810999ae89bdc7a1af3229a31921` in validation commit
`71cce3b10e7d1cdb6a122dc90c917d04555ac860`; the 762-file main inventory was
read from blob `adc0f273fd2e11b38f903f40b97ead6ec074b8d1` in independent
commit `92d1dacd041d90f58fee81922815bbd606cceb8e`. All 761 common
paths have the same SHA-256 and byte length. There are no predecessor-only or
changed paths. The sole additional path is root `README.md`:

- candidate Git blob: `b282b7a2b8748d3c6f77e249a26ed45958f81931`;
- SHA-256: `3efb55d50b1003148b83f49096cc0ed61b41ed26a6db976e02f7b9a19ac22c39`;
- length: 26,938 bytes.

The predecessor's 761-file proof remains correct for its deliberately narrower
archive; this audit does not rewrite it as 762. The omission was a source
snapshot/packaging harness omission, not an identified product defect.

The derivative authenticated 234 selected files from the fixed candidate Git
object, including every selected Git blob and mode. It used the authenticated
live-copy branch for all 314 pinned tool files; the isolated `npm ci` fallback
was not executed and is not claimed tested here. The isolated build emitted 760
files. npm then packed, installed, and moved 762 files. Tar and installed
content matched each other, the build's complete `dist/`, and every path/hash
in the immutable main inventory. The tarball SHA-256
`2713175a12912952999c6e0e8d81cef2638692b573081bc281ba0e785d099bab`
also equals the native-replay tarball, while its SHA-512 integrity
`sha512-cdOC3wL+yGOzuAbaEEzcUUBg6iiWAXfIKaAhpDslVl9j4SdZxLml4K4iDYi6bUe6xH8zCJBWasbWESuSB0afCA==`
equals the main package record. The main record does not contain its tarball
SHA-256, so no unsupported main-SHA-256 claim is made.

The guarded moved-package probe hashed 176 uniquely loaded package modules,
observed exactly 70 default commands and one tree command, and executed the
UTF-8 tree case. The strict NodeNext consumer used `skipLibCheck: false` and
listed the installed root and tree declarations. A test-only package copy
changed only `dist/index.d.ts`; that invalid declaration failed with
`skipLibCheck: false` and passed with `true`. Wrong-package, archived-source
fallback, wrong-hash, exact nonsignal failure, output-overrun, and timeout
controls all produced their expected results. All 26 children reached close and
were absent afterward; no workers were created and the owned temporary runtime
was removed.

## Driver provenance

The derivative copies the four harness files from validation commit
`71cce3b10e7d1cdb6a122dc90c917d04555ac860` (tree
`142273be8056e667b3a25d18cf5a0ecf509a7f1e`). Three copies remain byte
identical:

- `consumer-types.mts.data`:
  `f9c3f829c7d3737b48a864d03de147f03ffa4a1563070a5949bc9d1bc52a421a`;
- `guard-loader.mjs`:
  `a3ac675d146b6fe871d567d678d3ba1bc49b8145adf5d6cf715b081c071fe218`;
- `runtime-probe.mjs`:
  `4282c9d20dd330eb94677704664736d355be476b0ba6791ea965dce56cc9ce05`.

The predecessor `run.mjs` SHA-256 is
`0d1a8451e8f368c9a4dc0694dff6dfe286a52ec426573d090ed84a4af132652a`;
the derivative is
`ce39bbc92ceecec438026aa7e8d94e94d6376c806bb4d7438353d9a550bc1c2c`.
Its scoped changes add `README.md` to the fixed Git archive, authenticate the
immutable predecessor and main package JSON blobs, assert the exact inventory
diff and main tarball integrity, and rename only task-local paths/messages.

Reproduce into a new, nonexisting attempt:

```sh
node tests/commands/tree-charset-independent-20260827/final-audit/harness/run.mjs \
  --output tests/commands/tree-charset-independent-20260827/final-audit/attempt-002
```

The driver refuses to overwrite an attempt. `attempt-001/SHA256SUMS`
authenticated all 67 files present before the manifest itself was written; a
separate completeness check found exactly those 67 files and no later
unlisted entry.

## Mutation-controls cross-audit

The final mutation evidence is commit
`2748e2abbc2dc838e02b1d75ee7d967f0749e8ad` (tree
`2e0838b8e92ff88583e4e9651fe5a4549742ada6`). Its installed baseline passed
11/11 unchanged checks. Eight fresh installed-package copies each received one
exact replacement; every before hash differs from its reread after hash. All
eight mapped target checks failed with `AssertionError`/`ERR_ASSERTION`,
not a syntax error or load-guard rejection, while each package-provenance check
continued to pass. The delayed-write mutant recorded two late completions and
then zero outstanding writes before worker closure.

The separate positive guard loaded the genuine installed root after matching
its path, manifest hash, and entry hash. A separately packed/installed wrong
package and a same-byte package copy outside the expected root both resolved,
were denied with status 77, and recorded `loaded: false`. Across all 51 child
commands there were no timeouts or output overflows; every child and POSIX
process group was absent after close. The only nonzero exits were those two
expected denials.

One requested field remains absent: the mutation worker does not record a
load-time hash of the specific mutated target module. It records the exact
pre-mutation hash and reread post-mutation hash before spawning the worker, and
the unchanged semantic assertion observes each fault, but this audit does not
promote that into an unrecorded loaded-module hash. Therefore the actual
mutation gap is substantively narrowed but not fully closed under that exact
evidence requirement. The older five expectation-only controls remain
preserved and are supplemented, not rewritten, by these actual mutants.

## Four-gap verdict

1. **Actual mutation:** partial. Actual execution kills 8/8 mapped mutants,
   proves the real denied-load controls, drains late writes, and closes all
   children/groups; specific mutated-module load-time hashes are not recorded.
2. **Strict reproduction/declaration control:** closed for this scope by the
   predecessor and repeated here, including the false-fails/true-passes
   declaration fault control.
3. **Full authentication/source fallback:** the 761 packaging omission is
   closed by this 762-file run; fixed Git sources, tools, build, tar, moved
   install, main inventory, 176 actual module loads, and source-fallback denial
   are authenticated. The loaded-module claim remains the bounded root/tree
   probe, not every export workflow.
4. **Bounded subprocesses:** closed for these runs: 26/26 reconciliation
   children and 51/51 mutation children closed and were absent; mutation
   process groups were also absent.

## Preserved history and limits

Primary author evidence is
`0d8623634995549d8e717d310c28db83a02a9532`. The main independent result
`92d1dacd041d90f58fee81922815bbd606cceb8e` remains 139/139 candidate,
77/77 baseline, 21 installed holdout groups, 31/34 native comparisons with
exactly five connector fixes, and 15/15 matching count totals. This audit did
not rerun those suites.

Native freeze `55bd112804564605e397d3ee9948226d89efd457` and replay
`259d983a16f3f419fab3a33ec539ceb4a72ebd2a` remain post-source evidence:
11/11 literal cases per boundary, nine observations per boundary with six
matches and three documented divergences, and 40 closed children. Initial
freeze `a0445f4d5cff1c8451957ce684273e1225279588` and supplemental freeze
`633fc0c7d582b9f997ca42be75461b78e03dccb9` are also post-source-commit;
no independent pre-source-commit freeze exists. The unauthorized scoped
`AGENTS.md` was added and removed in
`d12de6eca8fff2a7389746ee67e1f99185b968f7`; that procedural violation is
not concealed.

Validation attempts 001-005 preserve their successive tool ancestry, npm
config, path canonicalization, probe-expectation, and compiler-path failures;
attempts 006-007 passed. Mutation attempts 001-002 preserve the original pass
and later drain/group evidence, attempt 003 preserves its launcher-only path
failure, attempt 004 passed the normalized verifier, and attempt 005 added the
two actual denied loads. Earlier fixture/oracle errors and v2/v3 corrections
remain versioned in the main evidence.

The old strict recipe remains unchanged and failing with its recorded ASCII
versus UTF-8/directory-profile difference. The three retained native
differences remain: mixed-root file-operand annotation, and the two Darwin
collation/filename-escaping cases. No scoped product bug was found. This is not
a pre-source freeze, whole-gate rescore, traversal/count expansion, full native
parity, superiority proof, or claim about mutable HEAD/current 73+ commands.
