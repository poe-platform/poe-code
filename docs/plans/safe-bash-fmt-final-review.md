# command-fmt task-diff review

Reviewed the supplied working tree on 2026-09-19. This review adds only this
receipt. Existing implementation, tests and unrelated edits are preserved.
The requested package-pattern document is at its existing archived location,
`docs/plans/archive/safe-bash-command-package-pattern.md`.

## Blocking finding: cancellation waits for opaque capability metadata

`packages/safe-bash-command-fmt/src/command.ts:133` waits for the entire
`InputScope.open()` acquisition, including the `capabilitiesFor` promise at
line 89. If that capability ignores cancellation and remains pending, invocation
cleanup, Shell execution and Shell disposal remain pending despite no acquired
reader or output. The six falsey-reason cancellation tests and the standalone
opaque-metadata cleanup test in `fmt-adversarial.test.ts` reproduce this.

The private command test `cleanup drains admitted VFS capability acquisition
before settling` requires cleanup to remain pending for the same query phase.
Both fixtures use the same capability API; there is no declared ownership or
cleanup profile distinguishing their requested behavior. A signal being passed
does not establish that a capability cooperates with cancellation. Reconciliation
must specify whether metadata is owned work to drain or detached work whose
late completion cannot acquire resources. Actual iterator acquisition and
retirement must still drain, including reentrant acquisition. Merely removing
the await or changing an expectation would leave one current safety gate unmet.
No implementation or assertion was changed to hide this conflict. This finding
blocks completion.

The maintained SafeFS contract (`src/contracts/filesystem.md:638`) calls this
query a point-in-time observation, not a lease, and says it creates nothing.
Its result contains capabilities rather than a resource to close. That supports
separating metadata waiting from reader acquisition; it does not satisfy the
private test's additional requirement to drain admitted asynchronous VFS work.

## Source and architecture assessment

Downloaded the released GNU coreutils 9.10 archive and verified SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read `src/fmt.c`, the fmt section of `doc/coreutils.texi`, and all five upstream
fmt test files. Compared the pinned development `fmt.c` at
`b25722854370b8206d7f53f8934c36710cdd9974`; differences are initialization
placement/removal, not the formatting algorithm. No native fmt was executed,
and no host locale was used as an oracle.

Reviewed parsing, SDK capture, byte helpers, engine, command lifetime, diagnostics,
facades and qualified private-command build integration. The owner remains
`safe-bash-command-fmt`, private, TypeScript ESM and without external runtime
dependencies. Safe Bash composes/exports it. Typed SDK operands use `--` and
share CLI parsing. Engine input is copied before producer advancement; output
writes are awaited; I/O receives cancellation. Bounded windows, strict cost ties,
checked arithmetic, explicit profiles and separate historical width behavior
remain intact. No additional validated abstraction, host-access or compatibility
defect was found, and no speculative simplification was made.

Previously recorded missing full native byte transcripts, combined
prefix/margin/punctuation/window qualifications and independent browser/workerd
qualification remain open; this source review does not discharge them. Existing
installed-artifact evidence in `safe-bash-fmt-wiring.md` was inspected, but packing
and installed-consumer checks were not freshly repeated in this review.

## Fresh checks

- `npm test --workspace=safe-bash-command-fmt`: 65 passed, no failures/skips.
- `npm run lint --workspace=safe-bash-command-fmt`: ESLint and source/test
  TypeScript checks passed.
- Node test selection of fmt, fmt-adversarial and agent-commands: 755 tests,
  748 passed, seven failed, no skips. Counts include nested subtests. All seven
  failures are the opaque-metadata cleanup cases described above.
- `npx vitest run scripts/bundle-safe-bash-private.test.ts`: three passed.
  An initial attempt used the Node runner for this Vitest file and failed runner
  initialization; it is not a product failure or a passing check.
- `git diff --check`: passed.

No code or CLI appearance change was made, so no new screenshot validation was
required. No local commit, remote-main delivery, release or private command
publication occurred. Task-owned logs and downloaded source were retained only
temporarily under ignored `out/command-fmt-final-review` and purged after capture.
