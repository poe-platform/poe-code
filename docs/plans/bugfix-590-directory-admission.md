# Bugfix #590: bounded directory admission

## Validated scope and policy

Small in-memory witnesses and source inspection confirmed that ls, recursive cp
and find obtain entire directory arrays before command-owned sorting or traversal.
Memory expands its entry map and Real calls eager native readdir; a post-return
command cap cannot prevent those allocations. No large-directory, RSS, heap or
timing claim was reproduced or inferred.

Add optional `ReadDirectoryOptions.maxEntries` to the existing filesystem API.
The value is a nonnegative safe integer, including zero for an empty listing.
Cancellation precedes validation; invalid values reject with EINVAL and excess
entries reject with EFBIG, never a truncated result. Omission retains the adapter's
existing limits and ordering. Error syscall and path identify the virtual readdir
operation; Real retains its existing host-error message/cause sanitization.

Root selected a command default of 10,000 entries per listing, matching tree/du's
actual per-directory defaults rather than their separate 100,000 total-entry
limits. Standard, agent and browser command routing is a separate implementation
owner. The default is not a filesystem-wide default or cumulative traversal quota.

## Owner boundaries and implementation

- Core owner: filesystem type, shared internal directory admission helper, Memory,
  Real, focused Vitest tests and this plan.
- Remote/composition owner: S3, WebDAV, Mount, Overlay, Readonly and forwarding
  controls. Quota forwarding should remain unchanged unless tests identify a gap.
- Command owner: shared substantive command admission, every direct listing in
  filesystem/find commands, public standard/agent/browser options, explicit Bash
  filesystem-type re-export, tests, registration and consumers.
- Root: authoritative existing filesystem contract update, coordinated builds,
  independent review, full checks, Git and release delivery.

The internal helper API is:

```ts
directoryEntryLimit(options: ReadDirectoryOptions, path: string): number | undefined
admitDirectoryEntries(count: number, limit: number | undefined, path: string): void
```

Memory compares the directory map's known size after normal path/type/permission
checks, before entry iteration, mapping or sorting. Real retains eager readdir
when the limit is omitted. With an explicit limit it uses opendir with one-entry
buffering and sequential read calls: an exact N-entry result requires the following
EOF read; an excess result stops at entry N+1 before reading its name/type or
appending it. The acquired handle immediately enters try/finally ownership and
closes exactly once. An explicit failure flag preserves falsey primary failures
over cleanup failure; native failures retain their existing error mapping and
caller cancellation retains exact identity. A late-acquired handle closes without
being read when cancellation occurred during acquisition.

Overlay uses a conservative distinct-candidate cap N and bounded per-layer calls,
not a cumulative-work ledger. A small visible result may reject because hidden
or whiteouted lower candidates exceed N. Mount counts unique merged names and
retains synthetic mount precedence. There is no new ordering API. WebDAV's existing
independent XML byte/tree allowance remains; no proportional-to-N XML-tree promise
is made. Custom host adapters may allocate before returning or ignore requested
limits; defensive wrapper/command checks cannot undo those allocations. This is
not a global work, memory, RSS, metadata-call or transactional guarantee.

## Core TDD and verification

The initial bounded core tests had 16 failures and 9 passes; two zero-limit test
rows initially used Vitest's tuple expansion incorrectly. After fixing those rows
without product changes, the corrected baseline remained **16 failing, 9 passing**,
now entirely from the ignored limits/validation/eager-listing defects and retained
legacy/cancellation controls. No filesystem fixture was written to disk.

Core implementation verification on September 4, 2026:

- `npx vitest run packages/safe-fs/tests/directory-admission.test.ts`: **44/44 pass**.
- Focused test plus `contracts.test.ts`, `cleanup-semantics.test.ts` and
  `real-trailing-separator.test.ts`: **148/148 pass** across four files.
- Controls cover omission, zero/exact/overflow limits, invalid values, cancellation
  priority, Memory pre-iteration admission, path/permission/confinement, native
  read counts, excess-entry noninspection, cleanup settlement and exactly-once
  close, falsey native failures versus falsey cancellation, and late acquisition.
- Build is deliberately deferred until all implementation owners freeze source.
  These core checks are not remote-adapter, composed-command, public-bundle or
  integrated release acceptance.

No README, normative contract markdown, Git or release operation is performed by
the core owner. Root will record integrated validation and delivery separately.

## Remote, composition and command verification

Remote/composition TDD had 11 failing and 8 passing tests after correcting an S3
fixture to account for the existing root-stat probe. A separate duplicate-array
witness failed twice before Mount and Overlay gained defensive backend-length
checks. Final focused coverage passed 23/23, with 180/180 related tests. Evidence
is retained in `/tmp/poe-590-remote.ZIdcyD`; the initial fixture failure remains
separate from the corrected product baseline.

The command baseline had 16 substantive failures plus four fixture failures.
Plugin-initialization assumptions and the sort observer were corrected rather
than counted as product evidence. Cooperative checkpoint controls separately
went from six failing to six passing. Final command coverage passed 36/36,
related command/yield coverage 295/295, and discovery coverage 96/96.

Independent review found no actionable defect in the frozen core, wrapper,
remote or command changes. Additional small probes covered layered whiteouts,
S3 exact-cap pagination, independent XML bounds, falsey wrapper cancellation,
find pre-order/depth-first/prune effects, recursive ls headers, ls -d bypass,
and the browser timer-based yield fallback. A distinct Quota/Overlay construction
Proxy-invariant error was reproduced before directory operations; it is not
repaired by this change and arbitrary quota composition is not claimed.

Root combined admission tests passed 67/67. The full safe-fs Vitest selection
passed 1,115/1,115 across 49 files. These source-level results do not substitute
for the coordinated build, public consumers, full maintained test route or lint.
Root integrated logs are retained in `/tmp/poe-590-root.bg9YZy`.

## Integrated regressions and corrections

The initial normal workspace/root build, public consumer checks, public
standard/agent/browser smoke, and repository lint passed. The full `npm test`
run then exposed one Readonly compatibility regression: omitted-limit
pre-aborted reads stopped reaching the backend, changing the existing delegate
count from seven to six. A separate source witness also demonstrated that the
new unconditional post-return cancellation check changed a legacy backend
success into rejection. Two added regression tests failed before correction;
the corrected focused/adjacent cohort passed 113/113. New cancellation checks
now apply only to a defined `maxEntries`, preserving both omission behaviors.
The existing Bash cancellation test was not weakened. Independent review
approved the corrected source; rebuilt public validation is still required.

The initial full run completed the shared Vitest phase with 29,837 passes and
43 skips, Python with 29 passes, Bash runner checks with 241 passes, and the
Bash suite with 18,872 passes, one failure and 63 skips. That full run failed;
skips and unavailable external comparators are not passes. Later workspace
tasks and the root posttest were not certified by that interrupted route.

Ownership review also found that the new command test used `RunOptions.commands`
from an unrelated staged user helper change, absent from HEAD. The helper was
neither edited nor committed. Injecting the exact HEAD helper in memory produced
35 passes and one failure before repair (`10000 !== 1`), then 36 passes after
repair. Tests now obtain contexts through the existing `run("true", ...)` API
and exercise the reader directly for checkpoint controls. Removing both yields
in memory still produces six failures, preserving both checkpoint and all four
queued falsey-cancellation witnesses. Logs are in `/tmp/590-bash-owner.jdTrHu`.

The first lint run passed all 9,663 configured files with zero errors/warnings,
all 25 receipts, root types and workflow lint. The next lint attempt was
deliberately stopped with exit 143 before changing the portability fixture;
`lint-final.log` is therefore incomplete, not a pass. Final lint, a corrected
normal build, public consumers and a complete maintained unit rerun remain
delivery gates. No push or release is claimed by these local results.

## Main integration and current candidate

The corrected normal build passed, as did 124 related Bash tests (including the
unchanged Readonly cancellation test), all 1,117 safe-fs tests, the maintained
25 public consumer groups and their negative controls, and a public runtime
smoke covering standard/agent/browser admission plus Readonly omission behavior.
The subsequent complete lint route also passed: 9,663 configured files, zero
errors/warnings, 25 receipts, root types and workflow lint.

Implementation commit `b73531552b4bf81112e4a7ff38bb2b124ac54843` was local only.
Remote main then advanced through `a6092b16a` with the separately owned #561/#562
fixes and shared-test/CI throughput changes. Its full unit rerun was deliberately
stopped before integration; `test-delivery.log` is incomplete, not a passing run.
The implementation was rebased as
`fdf8bfdac10543e0a6c41c9d30d0eb3ccb8567d5`; stable patch IDs prove the #590 patch
is unchanged. The new combined candidate still requires integrated validation.

The incoming sort changes overlapped two staged user files. Recovery stash
`19400feee97fd02168c2316937a985fecb40599c` preserves the original index and
working changes and is retained. Restoring it required combining one import
block; every original staged added/deleted line was compared and preserved
exactly. The same three user files remain staged with 33 insertions and three
deletions. They are not part of the #590 implementation commit. The unstaged
contract link and untracked specification were also preserved.

## Integrated validation

The combined candidate `fdf8bfdac10543e0a6c41c9d30d0eb3ccb8567d5` passed the
normal `npm run build`, including root suffix stages, and full `npm run lint`:
9,663 configured files, zero errors/warnings, 25 authenticated receipts, root
type checking and workflow lint. The maintained public-consumer route passed
all 25 current consumer groups and its three exact negative controls. This is
not a claim that the separate legacy fixture typecheck tracked in #605 passes.

Related directory-admission, readonly, text and YAML tests passed 189/189;
the integrated shared-runner tests passed 28/28. These checks cover the incoming
sort/YAML/test-runner changes as well as #590. The three unrelated staged user
files were present during these checks but remain excluded from delivery.

The full maintained `npm test` rerun exited successfully. Shared Vitest passed
29,839 tests with 43 skips; Python passed 29 tests; Bash runner checks passed
241 tests; Bash passed 18,895 tests with 63 skips and no failures. The remaining
terminal-pilot task passed 239 tests after its native pretest build, and root
posttest passed both lint-stress tests. The uncached maintained orchestration
completed with no excluded declared unit tasks. Undeclared tasks and skipped
cases are not passes. Logs are retained under `/tmp/poe-590-root.bg9YZy` with
the `-integrated.log` suffix.

Independent contract review clarified that new post-return cancellation guards
apply to defined limits; omitted-limit readonly delegation retains its legacy
backend outcomes. The specification checker reports no errors or warnings.
Remote-main delivery, issue closure and actual publication remain separate
pending steps.

After that full run, remote main advanced only by
`cd750d947a7d802a2e64b9f3f9c775d68dfa54aa`, the separately owned #610 quota
Proxy-invariant fix. Rebase produced implementation commit
`c01227019d07922f7770cddb8be0374c6b605c96`; stable patch IDs again prove the
#590 patch unchanged. Recovery stash
`33232860739a8ea4905fea9344c11df781b343cf` is retained, and the restored user
index diff matches its saved index exactly. The complete unit result above
belongs to the pre-quota-integration candidate, not this newer SHA. A fresh
normal build, full lint and affected filesystem/public-consumer checks cover
the incoming integration delta before delivery.

The fresh normal build passed. The complete SafeFS package selection, including
its collocated contract tests, passed 1,120 tests in 49 files; the directory-only
selection independently passed 1,099 tests in 48 files. Related Bash admission,
readonly and text tests passed 123/123. All 25 current public consumer groups
and three exact negative controls passed. A built-public-entry smoke confirmed
the newly constructible quota/Overlay/readonly composition rejects two entries
at limit one and returns both at limit two. These are focused integration checks,
not a second full repository unit run.

The specification now records the inspected implementation commit
`c01227019d07922f7770cddb8be0374c6b605c96`, separately from publication status.
The final combined-candidate full lint also exited zero: all 9,663 configured
files, zero errors/warnings, 25 receipts, root types and workflow lint. No source
changes followed these checks. Only this plan and the reviewed contract/link
are included in the delivery documentation commit; user staging stays separate.

The first push was rejected because remote main gained the independently owned
#563/#564 fixes at `3ff5bba346c738a0d92f0fbd827ca4698ce2f818`. A clean merge
preserves the inspected #590 implementation and documentation commits. Recovery
stash `93f832e2604944ad54db0bbdc939014af77803b4` retains user staging; its exact
index diff was preserved after restoration. No #590 source changed in the merge.

Final-merge focused checks passed 1,225 SafeFS/SafeJS budget and locale-comparison
tests in 51 files, plus 144 Bash directory-admission and jq semantics tests.
The preceding full repository unit/lint results retain their exact candidate
scopes above; they are not represented as a new full-suite run on this merge.
