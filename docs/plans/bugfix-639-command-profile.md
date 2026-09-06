# Issue 639: command implementation decisions

Root implementation decisions, September 6, 2026. These supersede conflicting
draft command-state proposals in `bugfix-639-bounded-tail-follow.md`; they do
not claim implementation, delivery, unrestricted native parity, or new user
requirements. Phase A has passed focused tests, normal build, public type
checks and independent review. Phase B and the command implementation may
proceed in disjoint files, followed by combined qualification.

## Evidence and compatibility

Use the observed GNU tail 8.30 forced-polling profile for follow transitions.
Preserve the earlier eight observations and differing default/inotify status
results. The additional evidence is:

- `tail639-sidecar-20260906.l0k38zq4/report.json`, SHA-256
  `961da1afebf2eaa2dd66679fa6bf342a508dc2961cf9d79354158e7436cce063`.
- `tail639-boundary-20260906.dcn1_by3/report.json`, SHA-256
  `d7d2827c8ad741cca782c1746a7e67522c5bbc1994940dd78918f74fd796bf3f`.

Both live under the existing external validation root. There were 28
observations, 27 completed intended protocols and one failed directory-recovery
protocol. Preserve the failed protocol and the later correction of its claimed
termination classification. Its observed natural early exit is evidence for
that exact input, not proof of successful directory recovery.

## Selected behavior

- Preserve the existing finite tail/head paths, flags, bytes, statuses and
  buffer limits. Add ordered `-f`/`-F` selection and optional `--max-idle` only
  for follow. The last follow flag wins, including combined short options.
  Count arguments and operands must not be mistaken for follow flags.
- `--max-idle` accepts nonnegative decimal seconds whose millisecond value is
  a nonnegative safe integer. Reject unsupported numeric spellings, missing
  values and overflow before I/O. Zero performs initial selection without
  follow/retry waiting. Omission adds no idle or absolute deadline.
- Named initial selection is bounded by the first retained stat's size.
  Ordinary `-n`/`-c` count initial contents, not lifetime output. Initial
  `-n 0`/`-c 0` still admit subsequent appended data.
- Do not carry an unmet initial `-n +N` line-skip counter across initial EOF.
  Follow begins at the actual consumed offset. Preserve the observed GNU
  `-c +N` logical starting offset: beyond EOF this can cause the subsequent
  size check to report truncation and replay existing bytes. Record this as
  observed compatibility behavior, not proof of an actual filesystem truncate.
- `-f` pins the opened resource across rename/unlink; it does not reopen the
  pathname. Observed size below the acknowledged offset resets to byte zero.
  Same-size in-place writes are not appends. Unobserved truncate/regrow remains
  outside the stat/read contract's detection guarantees.
- `-F` compares complete identities of actual retained resources while the
  name remains available, including same-size/same-mtime replacements. Unknown
  identity is unsupported, never guessed from a path, size, time or wrapper.
- On reported name unavailability, stop reading the old resource. It may be
  closed with proper drain rather than retained solely for historical identity.
  On recovery start at byte zero, even if the same resource reappears. An
  initially failed operand's delayed first open also starts at zero, without
  repeating the initial suffix selection.
- Initial operand admission failures retain exit 1 after recovery. Later
  retryable name/type/access loss does not itself make controlled completion
  fail, including an unrecovered later ENOENT/EACCES. Nonretryable operational
  failures remain failures; cancellation and control/output failures must not
  be converted into ordinary retry diagnostics.
- Retain the declared retry policy for ENOENT, ENOTDIR, EACCES, EPERM and EISDIR.
  EPERM and arbitrary EIO behavior are not claimed as native-tested cases.
  For initial EISDIR with positive line selection, preserve the observed
  immediate failure before later operands; ordinary suffix selection may
  retain the name for retry. Do not generalize that exceptional early-exit
  observation to untested count modes.
- Headers retain quiet/verbose and operand-switch behavior. Initial successfully
  opened empty files still receive their selected headers. Initial directory
  errors and later EACCES transitions can also produce empty headers, as
  recorded; do not impose the disproved universal data-only header rule.
  Keep existing virtual FsError formatting rather than changing generic
  diagnostics or claiming byte-identical native error wording everywhere.
- Consumed stdin ends at its actual EOF; implicit empty stdin does not stop
  named readers. Mixed-input EOF retires stdin only. `-F -` is an explicit
  name-follow refusal. Preserve streaming initial `+N` stdin behavior. Because
  consumed stdin has no retained-size initial boundary, apply explicit idle
  timing while awaiting its input too, then drain its iterator and preserve its
  bounded suffix. This does not make stdin completion stop named followers.

## Bounded ownership and public configuration

- Add `maxTailFollowHandles`, default 64, to standard/browser/agent command
  options and the existing direct stream factory. Preserve the existing
  positional tee-cap argument; use an additive optional second argument for
  the tail cap. Accept nonnegative safe integers; zero disables named follow.
- Preflight named reservations and the single additional `-F` comparison slot
  before filesystem effects. Count reserved, opening, current, candidate and
  closing resources until their release settles. Never reuse a failed-close
  slot to continue acquiring resources. This is per invocation, not global.
- Register one cooperative session owner before opens/timers. Use bounded
  current/candidate/pending sets, not a new permanent cleanup callback per poll.
  Observe and dispose late acquisitions; close admission before draining.
  Preserve primary/falsey failures separately from cleanup-only failures.
- Use 100 ms polling and at most 64 KiB per read as work granularity. Capture
  round sizes and rotate files fairly, yielding through the original command
  signal for shared CPU accounting. Drain known backlogs without an artificial
  sleep per chunk; do not chase an increasing size synchronously.
- Await output and diagnostics. Backpressured writes are not idle expiration.
  Start/reset the global idle window after acknowledged initial/progress work;
  empty reads, metadata changes and retry errors do not reset it. Keep scheduler
  injection internal for deterministic tests and drain timers/listeners on stop.
- Preserve shared Shell wall-clock/CPU limits and owned-output cancellation.
  No subprocesses, watchers, ambient files, new default timeout or fresh Shell.
  No S3/WebDAV retention emulation and no changes to tee's cap or member logic.

## Qualification

TDD must cover exact initial/follow bytes, statuses, transitions and headers,
cap preflight, falsey failure precedence, late open/close, backpressure, idle,
EOF, cancellation, fair bounded reads and unchanged finite behavior. Use memory
fixtures/mocked backends and an injected scheduler, not host fixture files or
slow real-time sleeps. Record unsupported native cases honestly. Root registers
new literal Bash test paths and owns combined build/type/lint/unit qualification,
rebase, atomic delivery and issue closure. Release checks run independently.
