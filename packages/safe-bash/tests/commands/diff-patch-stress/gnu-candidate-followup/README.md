# GNU candidate-selection follow-up

Focused independent regressions for the two concrete findings in
`/tmp/safe-bash-diff-auth-review.log`, not another broad auxiliary-path corpus.
Only this new subtree is owned; no product, existing test, or dependency edits.

Run from the repository root:

```sh
node tests/commands/diff-patch-stress/gnu-candidate-followup/run.mjs
node --import tsx --test tests/commands/diff-patch-stress/gnu-candidate-followup/candidates.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/commands/diff-patch-stress/gnu-candidate-followup/tsconfig.json
```

The runner creates timestamped, exclusive-write observations and validation logs;
it never overwrites earlier captures. It records all source hashes before/after,
exact commands/status/stdout/stderr, and fails if those hashes change. Its source
JS contamination guard prevents accidentally testing generated JS instead of TS.
Typechecking always uses `--noEmit`. No full snapshot harness is included.

## Coverage: 21 tests

- Six create-then-replace cases: unused long symlink, hardlink, or symlink-parent
  header; normal and explicit project `--atomic` must select newly created `a`.
- Four existing-`a`/unused-loop cases: normal, atomic, dry-run, atomic dry-run.
- One creation dry-run link control: native GNU refuses, and the project must
  refuse without effects. There is **no invented dry-run success parity**.
- Four explicitly selected-loop controls: normal/atomic, with/without dry-run.
- Two actual reject-alias cases: default refuses output to selected `a`; atomic
  refuses the hunk conflict before any output. These are distinct safety rules.
- Two successful-offset cases that would actually write a hardlinked backup:
  normal and atomic must reject the output alias and preserve the sentinel.
- Two public `Shell.use(diffPatchCommands())` heredoc flows: an authorized
  absolute VFS positional target outside cwd overrides the decoy header target
  and unused loop, in normal and atomic modes.

## Oracle and interpretation

Every case calls the mandatory `../gnu-target/oracle.ts` verifier: GNU patch 2.8,
SHA-256 `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
The exact executable and version are recorded, without fallback or skips.
Native patch runs only in disposable `.native-*` fixtures under this subtree;
cleanup runs even if the sentinel assertion fails. Product commands execute
actual TypeScript implementations against MemoryFileSystem, never host exec.

Captures include literal native argv, cwd, environment, stdin, stdout, stderr,
status, and complete before/after namespaces (directories, bytes as hex, link
targets, mode, inode/device, link count). Cross-backend comparisons normalize
inode numbers and directory metadata but compare file hardlink equivalence
classes; safety and dry-run checks retain exact within-backend identities.
Native unused files/links also retain identity on successful target edits.

GNU never receives `--atomic`; that flag is a project extension. GNU selected
loops exit 1 and normally emit `.rej`; GNU dry-run emits none. Project safety
refusals preserve the entire namespace rather than duplicating native rejects.
GNU permits reject output to overwrite `a` and safely replaces the hardlinked
backup; the project intentionally rejects those actual output aliases. These
controls do not authorize rejecting unused candidate headers. Status/output
differences for safety controls are explicit, not ordinary GNU parity claims.

## Limits

This is bounded MemoryFS coverage, not universal GNU compatibility, remote
adapter validation, atomic crash guarantees, superiority evidence, or a frozen
independent checkpoint. Creation plus `--atomic --dry-run` is not assigned a GNU
success-parity requirement here; only the existing-target atomic dry-run and
selected-loop atomic dry-run are covered. Root must run the later full frozen
checkpoint. See `FINAL_LOG.md` for the preserved failures and exact observations.
