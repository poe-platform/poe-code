# Independent GNU patch editflow verification

Owned scope: this new directory only. No product source, filesystem source,
backend tests, existing tests, root documentation, or Apple evidence was changed.

## Oracle and boundary

The executable is `/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`.
Its first version line is `GNU patch 2.8`; its SHA-256 is
`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
`native-evidence.json` records the full version output, fixture digest, literal
arguments, status, diagnostics, and namespace after every native invocation.
Missing executable, wrong hash/version, missing evidence, changed fixtures,
native timeout, output overflow, or native evidence drift fail closed. No skips.

Each host invocation uses literal argv, `shell: false`, a three-second timeout,
a 65,536-byte per-output-stream cap, and bounded fixture input. Every working
directory is a unique `.native-*` fixture inside this owned directory. Only
predeclared benign fixture paths are used; absolute operands substitute that
fixture's root. `/dev/null` appears only as a patch header sentinel. Host fixtures
contain no symlinks, hardlinks, traversal, or escape probes. Host fixtures are
removed in `finally`; no shared oracle installation is modified.

Native argv adds `--batch` solely to avoid interactive prompts. The environment
fixes C locale, UTC, `PATCH_GET=0`, and simple backup naming, and does not inherit
`POSIXLY_CORRECT`. Crucially, it does **not** add `--no-backup-if-mismatch`:
default GNU `.orig` publication remains in the comparison. Product execution
uses public `Shell`, `MemoryFileSystem`, and `diffPatchCommands` APIs, not patch
internals. Every GNU parity test reruns its native vector, verifies the pinned
observation, then compares product status and namespace. Product diagnostic text
is diagnostic only, not a required byte match. Namespace includes directory
existence and every file's bytes, including `.rej`, `.orig`, and boundary sentinel;
timestamps, permissions, and inode identity are outside this bounded corpus.

## Requirements handed to the source worker

- Default operation publishes valid hunks despite other rejected hunks, preserves
  earlier successful files, and continues to later applicable file sections.
- The 48 native vectors cover normal/context/unified rejects and naming, stale
  reject replacement, within-invocation reject concatenation, next-invocation
  replacement, old/new candidate choice, default stripping versus `-p0`/`-p1`,
  explicit absolute targets, null/epoch creation/deletion/reversal, sequential
  targets, parent creation/pruning boundaries, `-E`, and dry-run.
- The pinned native output shows normal rejects in context-style syntax, unified
  rejects in unified syntax, mismatch `.orig` files, replacement of an existing
  reject on the first rejected section, and append for another rejected section
  targeting the same file in that invocation. All bytes remain in evidence.
- Six explicit `--atomic` controls require conflict preflight with no early
  target/reject/backup/directory writes, plus successful publication and dry-run.
  Missing `--atomic` fails explicitly, not as an accepted safety rejection.
- Twelve product-only alias controls cover reject symlinks/hardlinks/ancestor
  symlinks, hardlink targets, ancestor-alias targets, and a reject name colliding
  with a later explicit patch target. Normalized repeated targets remain covered
  as legitimate sequential operations, rather than blanket duplicate rejection.
- Eight resource controls cover both modes: initial input budget, later target
  read budget, stalled stdin cancellation, and stalled later target cancellation.
  Default mode retains already completed earlier-file publication. Atomic mode
  publishes nothing when the failure occurs during preflight. `readStream`
  interception synchronously returns an `AsyncIterable`; the supplied Shell
  signal is checked for cancellation propagation, not caller-signal identity.
- This is conflict-preflight atomicity, **not backend-failure transactionality**.
  No test requires rollback after a backend write has failed or had side effects.

## Initial actual result

Run started `2026-08-26T21:23:09.700Z`, before source-worker handoff:

| Group | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Native proof | 1 | 0 | 1 |
| GNU default status/namespace parity | 19 | 29 | 48 |
| Explicit atomic controls | 0 | 6 | 6 |
| Product alias safety | 6 | 6 | 12 |
| Budget/cancellation | 2 | 6 | 8 |
| Total | 28 | 47 | 75 |

Zero skipped, cancelled, or TODO tests. Scoped strict TypeScript passed.
All 48 live native observations matched their independently captured evidence.
`baseline-tap.json` preserves exact TAP lines, including input and arguments for each
native parity failure. `validation.json` records commands, complete before/after
source-file hashes, test status/counts/names, TAP digest, and typecheck output.
Joining the JSON `lines` with `\n` reconstructs the exact TAP bytes and digest,
including whitespace emitted by Node's assertion reporter.
No source file changed across tests and typechecking. Aggregate source SHA-256:
`86e8a36b0dd076071e3452a0fdce2ac7e62c22e6ea07b00c7b08a4f82b963ea3`.
The baseline `src/commands/diff-patch/patch.ts` SHA-256 was
`e9019ebb41bd68b85a1022d23cabdaec421eacf6cd04b8a005202b87cd4f8aed`.

Sixteen failures expose missing `--atomic`. The other failures are 29 native
status/namespace mismatches and two default later-resource publication failures.
The current all-or-nothing default was not used to weaken GNU expectations.
These results are not whole-repository validation, full GNU compatibility,
backend interoperability, or superiority evidence.

## Reproduce after source handoff

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/diff-patch-stress/gnu-editflows/parity.test.ts tests/commands/diff-patch-stress/gnu-editflows/controls.test.ts
node_modules/.bin/tsc --noEmit -p tests/commands/diff-patch-stress/gnu-editflows/tsconfig.json
```

Focused partial-publication repro:

```sh
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='GNU default: unified/first-hunk-success-later-reject' tests/commands/diff-patch-stress/gnu-editflows/parity.test.ts
```

Focused missing-option repro:

```sh
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='atomic preflight: successful sequential' tests/commands/diff-patch-stress/gnu-editflows/controls.test.ts
```

`capture.ts` emits an `apply_patch` document for native evidence; `validate.ts`
emits an `apply_patch` document for the TAP and validation report. Those scripts
were used to create the initial artifacts. Do not apply their output over pinned
evidence or this initial baseline during a diagnostic rerun; preserve later
reports separately. No test automatically rewrites expectations.

## Primary documentation consulted

Official GNU documentation was located with `web.run` on August 26, 2026. Native
2.8 observations, not prose or product output, determine the exact expectations.

- Merging with patch: https://www.gnu.org/software/diffutils/manual/diffutils.html
- Backups: https://www.gnu.org/software/diffutils/manual/html_node/Backups.html
- Reject naming: https://www.gnu.org/s/diffutils/manual/html_node/Reject-Names.html
- Creation/removal: https://www.gnu.org/software/diffutils/manual/html_node/Creating-and-Removing.html
- Filename inference: https://www.gnu.org/software/diffutils/manual/html_node/Multiple-Patches.html

The GNU documentation corroborates continued processing after a rejected hunk,
default mismatch backups, `.rej` naming, candidate-name preference, and `-E`.
Reject concatenation and pruning details here are independently captured native
observations; they are not invented extensions of those documentation claims.
