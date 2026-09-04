# Kamilio integration issues

Resolve the open integration issues reported by kamilio, deliver atomic fixes
directly to `origin/main`, and verify the GitHub releases. Keep unrelated changes
and existing commit identities intact. Issue closure requires verified delivery,
not merely a local passing test.

## Acceptance

- #552: portable `cut` field selection accepts its byte delimiter without a host
  Buffer shim. Cover stdin and files, default tabs, explicit delimiters, multiple
  fields, and empty fields through the portable implementation. Add the reported
  reproduction to the installed browser-package release smoke fixture.
- #555: shell `>` and `>>` use filesystem streaming writes when available; split
  UTF-8 and binary chunks retain exact bytes. Preflight unsupported modes before
  destructive mutation; complete, fail, and cancel output explicitly.
- #556: share the filesystem output lifecycle between redirection, `tee`, and
  network file output, building on `createOutputOperation`. Preserve bounded
  backpressure, shared budgets, no replay after consumption, cancellation and
  writer settlement, and adapter-specific commit-on-success guarantees. Exercise
  `>`, `>>`, `tee`, `tee -a`, and `curl -o`, including empty input, unsupported
  targets, pre/post-consumption failures, quota/output budgets, aborts, multiple
  destinations, and early downstream close.
- #554: expose filesystem capability requirements and supported/partial/
  unsupported command evaluation. Execution and help use the same metadata.
  Distinguish write, append, exclusive creation, implicit/explicit directories,
  rename, timestamp mutation, links, and recursive operations, including the
  existing/missing `touch` and overwrite/append `tee` modes. Reject unsupported
  requirements before mutation without emulation or assuming mandatory methods
  prove support.
- #551: expose a browser/Worker bounded regex provider or command pack for
  `grep`, `rg`, and `sed`. Preserve regex/input/output budgets, cancellation,
  disposal, and adversarial-pattern isolation. Verify the public packaged entry
  in real workerd as well as browser bundling; event-loop RegExp execution is not
  an isolation substitute.

## Verification and delivery

1. Reproduce failures with focused tests before implementation; register added
   SafeBash tests by literal path in its integration discovery controls.
2. Run focused tests, maintained builds, strict package type/consumer checks,
   and package smoke tests relevant to each change. No snapshot or test failure
   waiver, environment weakening, or skipped hook substitutes for validation.
3. Use explicit owned file lists and Conventional Commits. Follow the current
   repository manual pre-push policy: this cross-workspace change requires the
   full `npm test` route and repository-wide lint. Never bypass installed hooks.
4. Verify remote-main commit identity after each push and monitor both root and
   scoped-safe-package GitHub release workflows to successful completion.
5. Report local commits, remote delivery, package publication, and acceptance
   evidence separately. Re-query open issues before claiming the goal complete.

## Local validation prerequisites

The September 4, 2026 host needs an isolated validation environment, without
changing repository dependencies, global npm, test selection, or hook policy:

- Use Node 22.22.0 with npm 11.19.1, which satisfies the release workflow's npm
  range and supplies the `tar.Parser` API required by committed-archive checks.
  The host's npm 10.9.4 and the minimum npm 11.5.1 both bundle incompatible tar 6.
  An isolated npm prefix with an identical copy of the host Node binary keeps
  the verifier's sibling-npm resolution bound to the intended toolchain.
- Set `TMPDIR` to a fresh directory outside the checkout and `node_modules`.
  The shared `/tmp` has over 45,000 entries and exceeds guard-test limits;
  checkout-local directories instead cause nested Vitest config discovery.
- Remove the terminal-injected `NO_COLOR` only from validation child commands.
  Its conflict with Vitest's `FORCE_COLOR` adds Node warning lines to process
  output assertions. Do not suppress warnings or change the assertions.
- Preserve caller-supplied optional unit profiles and normal Git-hook cleanup.
  Run the same complete `npm test` route and required manual pre-push checks.

Newer main commits removed the commit/push hooks and established selective
manual validation. Integration preserves those commits and the independent
stat-format fix by merging `42d9dba27cafcb637ca28498c1e5ca4d53d68633`, without
rewriting the existing fix commits. Revalidate the merged tree before pushing.

The extra strict SafeBash audit initially reports 24 diagnostics already present
at `e4e23699e696d320363da662d1d74475bb098d28`, independently checked against
unchanged Git blobs. Keep this audit limitation separate from the required unit,
build, lint, current-consumer, publication, and runtime-acceptance results; do not
describe the entire strict source audit as passing.

## Verified published baseline

The independent audit installs fresh registry tarballs for all three scoped
packages at version `0.1.44`, verifies their registry SHA-512 integrity, and does
not use the earlier local artifacts that happen to share that version number.

| Issue | Classification | Observed baseline |
| --- | --- | --- |
| #552 | Reproduced defect | Browser-bundled field-mode `cut` fails for stdin and VFS input with `val must be string, number or Buffer`; character-mode controls pass. |
| #555 | Reproduced defect | Stream-only redirection fails while `tee` and `curl -o` preserve the same bytes. A byte-preserving adapter leaves only `c3` of `c3a9`, or 32 of 70 PNG bytes, before a failed overwrite. Append fails but preserves the original; the audit does not call that append corruption. |
| #551 | Confirmed capability request | The documented browser subset lacks `grep`, `rg`, and `sed`, and the published API lacks an injected portable bounded provider seam. Default browser registration is not claimed to be broken. |
| #554 | Confirmed capability request | Package-owned command requirements and their evaluator are absent. |
| #556 | Confirmed refactor request | Redirection, `tee`, and network files have separate output implementations; this is not evidence that every requested regression-matrix case previously failed. |

Adapter controls verify exact byte handling, honored append flags, unchanged
files after rejected append, and working streaming append. Browser baseline
evidence uses an isolated VM with consistent typed-array realms and no Buffer
shim; it is not a workerd result. Compare the same bug stimuli with the final
candidate, and separately qualify the opt-in portable search pack in workerd.

The final local candidate (`0.1.45-local.4`, not a publication) passes all 13
output cases and all nine exact-byte `cut` cases. Five output failures are
reproduced on the registry baseline; eight successful controls remain unchanged.
The sequential adapter explicitly declares `randomAccessWrite: false` in both
runs rather than inheriting a newly added capability from its MemoryFS backing.
Original receipts and the one-line fixture difference are retained; the corrected
baseline receipts match the originals. Unsupported binary append is not claimed
to succeed. The opt-in search pack separately passes 15 actual workerd cases.
