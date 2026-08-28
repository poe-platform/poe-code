# Directory-stack precode checkpoint — no implementation

## Execution and immutable history

- Original freeze `71215d3d`: **34 native +34 virtual script observations**,
  including one explicitly deferred DIRSTACK/tilde-stack case. No expectations
  changed after execution. Two additional native identity invocations: **70
  directly awaited child processes**, all closed without timeout/signal.
- Original raw compressed SHA-256:
  `fe150ca75f031031acc8e3591ed6add03ea24d669e7bcc63d97d2990d7452211`.
- Initial snapshot instrumentation assumed `dirs -lp` was a valid bundle. The
  actual pinned Bash rejects it. D17 intentionally tested bundles; other cases
  unintentionally had missing explicit snapshots. All original script/output
  bytes and those diagnostics remain in `observations-01`, not rebaselined.
- `63cd195e` preserved that run and sealed **four new native-only topology
  questions** using separate flags before executing them. These are not a
  corrected original34 score or virtual replay. Four direct children closed.
  Supplemental SHA-256:
  `4400c5f78510f39a8882480f2789caaff0e697b6b1569408f1f8f0f0d95b8d66`.
- Total: 38 native scenario observations,34 virtual baseline observations,
  two native identities, **74 directly awaited children**, two owned temporary
  roots removed. Indirect native subshell/pipeline PIDs are not separately counted.

All34 virtual stdout/status comparisons differ from native: **0/34 matches**,
not34 independent product bugs or an implementation test score. pushd/dirs/popd
are missing; D32 additionally hits deferred array syntax. The erroneous native
snapshot assumptions also prevent treating this denominator as clean acceptance.
Native nonzero command results are observations of error paths, not harness
failures. All virtual workers completed/disposed, with no worker rejection.

## Authentication and environment

GNU Bash 5.3.0(1)-release, aarch64-apple-darwin25.4.0, binary SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
This is the already-pinned local binary, not a new download/build. Versions,
MACHTYPE/OSTYPE, Darwin release and full literal argv/env are captured. No Linux
or Bash3.2 execution/qualification is claimed.

Primary GNU manual: local `bashref.texi` from the same already-present 5.3
distribution, sections6.8/6.8.1, DIRSTACK and tilde expansion; exact file hash,
metadata and path are in `FREEZE.json`. Online web retrieval returned no content;
an independent curl HEAD timed out at15s. Local primary documentation remained
available. No GNU implementation source was copied into this repository.

All native cases use `--noprofile --norc`, closed stdin, explicit empty PATH,
C locale and exact minimal environment without startup hooks. Test data is
task-owned under loopback-free temporary roots, with synthetic directories,
file sentinel and relative symlink. No host private code, HOME, user settings,
network services, system configuration, dependency installation or global writes.
The D29 cat function uses Bash/read/printf builtins, not an external executable.

The virtual side runs the complete **accepted fd1 selected-reconstruction
package**, SHA-256
`87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af`, from sealed
independent Stage2 evidence at `7ca45f2d`. Not live dist, whole fd1 HEAD, or the
queued combined77 candidate. 834 package files hash-match, including832 emitted
files; every one of34 workers loads **204 authenticated packed product modules**.
The loader denies unlisted files/source fallback. Package inventories remain
unchanged. Six inspected current shell-source hashes and native/Node binary
hashes/metadata also remain unchanged. Product files were read only.

Raw native stdout/stderr bytes are preserved. Comparison normalizes only exact
fixture-root occurrences to `/fixture`; no whitespace/diagnostic/category/exit
status normalization. stdout/status and stderr comparisons are separate.

## Main findings / root decisions

`PROPOSAL.md` gives the exact prospective three-source-file write set, state
ownership map, helper profile, budgets and policy questions. Important observations:

- Tail-only state avoids a stale duplicate of cwd. Plain cd updates the visible
  top; functions share state; clones/invoke must isolate tails.
- Failed direct pushes/pops and failed swaps/rotations have **different** tail
  effects. S02 freezes exact state snapshots; no generic rollback semantics.
- `-n` stores raw nonexistent/relative strings. No-argument `pushd -n` is a
  silent no-op; -n rotation drops the selected top while keeping cwd, also silent.
- GNU5.3 rejects bundled dirs flags. Separate `-l -p` works; -v dominates -p.
- Existing checked OLDPWD protection is stronger than native's failure path.
  Keep it; disclose the difference. Native closed-output push/pop returns0
  despite a write diagnostic; do not silently ignore virtual sink failures.
- CDPATH is an existing cd dependency gap, exposed by D22, not solved by this
  proposal. VFS directory execute-access policy likewise needs explicit approval.
- DIRSTACK/tilde-stack expansion remains additional/deferred, not implied by
  adding the three builtins. Builtins do not change default plugin counts.

No production implementation, new public API, feature completion, native parity,
or whole-gate claim. Different-verifier acceptance remains future work after root
approves the bounded implementation policy. The coherent77 review is queued
separately and was not inspected or executed as part of this checkpoint.
