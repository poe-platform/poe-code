# Targeted author validation

Candidate `073d39c6c49d5ee24172706e02179dd6da484483` changes only the
three authorized TypeScript paths. It is a test migration, not a product fix.
Private/shared helper, runtime, timeout, package, export and configuration files
were not edited by this author. Stage2 cancellation remains unauthorized.

## Commands and outcomes

- Curie evidence authentication:
  `node tests/integration/owned-output-production-independent-20260827/first-read-followup/verify.mjs`
  exited 0 with 108 authenticated files, 24 observer executions, and the exact
  statement `unchanged historical 2/6; not rerun/rescored here`.
- Final narrow strict validation used `tsc --noEmit` with ES2023, NodeNext,
  strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  verbatimModuleSyntax, skipLibCheck and Node types, rooted only at the new
  fixture, probe and supervisor test. It exited 0 after candidate commit.
- Canonical target:
  `node --unhandled-rejections=strict --import tsx --test --test-name-pattern='pipeline close: first-read-' tests/shell/remote-close.test.ts`
  exited 0: tests 10, pass 10, fail/cancelled/skipped/todo 0. Each child retained
  the unchanged 3000ms hard deadline, 1 MiB combined-output cap, strict rejection
  mode and residual process-group check.
- Small direct child groups were run before the canonical target to isolate
  head/local/S3, original HTTP, acquired-body HTTP and destination-survival
  behavior. After the explicit harness correction recorded in
  `data/validation-attempts.data.json`, all ten exited 0 without implicit retry
  or assertion weakening.

## Boundary facts from the passing canonical run

| Case | Public-boundary/resource result |
| --- | --- |
| head-zero | reads 0, return 1; caller/head live. |
| local unenrolled controlled | remained pending for the full 1200ms with active 1/read 1/return 0 and live caller/command; recorded host release then yielded active 0/return 1 and public status 0. |
| local owned | acquisition 1/release-completed 1/read 1/return 1/active 0; destination and operation EPIPE while caller/command stayed live. |
| S3 original | read 1/return 1/active 0; destination and exact S3 GET operation EPIPE while caller/`cat` stayed live. |
| WebDAV original | GET fetch calls/settled/rejected 1/1/1; GET responses/readers 0/0; exact GET operation and destination EPIPE while caller/`cat` stayed live. |
| curl body and curl headers originals | each registered/called/completed transport cleanup 1/1/1 and actual request/close 1/1 before public settlement; response acquisition/disposal 0/0; transport/destination EPIPE with live caller/`curl`. |
| WebDAV body acquired | exact GET response/reader/read/pending/release 1/1/1/0/1; reader cancel calls/rejected 2/2 and body cancel calls/rejected 1/1, all EPIPE; caller/`cat` live. |
| curl body acquired | response/read/pending/iterator-return/return-done/dispose/dispose-done/request-close 1/1/0/1/1/1/1/1; transport cleanup completed; caller/`curl` live. |
| required destinations | stdout destination EPIPE while caller/command/transport stayed live; VFS body was exact `first\nsecond\n`, headers contained HTTP 200 and content-length 13, verbose stderr contained HTTP 200; response disposal, transport cleanup and request close completed before public settlement. |

All remote cases passively observed server response close before shell disposal
and fixture teardown. Final diagnostics recorded active source 0, source return
1, server response/close 1/1, no observer errors, no cleanup failures and no
unhandled rejection. The HTTP helper then recorded sockets 0, tasks 0, server
not listening and fixture errors 0. Successful children were not rescued by a
caller abort or supervisor kill.

## Review handoff

- Policy/provenance freeze: `POLICY_ASSERTIONS.md` and `FREEZE.json`.
- Scenario dispatch, local ownership, exact boundary assertions and passive
  remote close: `tests/shell/first-read-probe.ts` lines 21–338.
- Failure-only cooperative teardown/resource joining: the same file lines 343–383.
- Typed signal/counter gates, bounded journal, fetch/body/request/transport
  observers and hook restoration: `tests/shell/first-read-owned-fixtures.ts`
  lines 75–418.
- Canonical discovery and unchanged supervisor protections:
  `tests/shell/remote-close.test.ts` lines 6–59.

The author did not launch an independent review. A different reviewer should
authenticate the freeze/candidate hashes, account for the intervening foreign
ancestry disclosed in `CANDIDATE.json`, inspect unchanged head-zero/S3/original
HTTP inputs, and execute only the targeted committed candidate.
