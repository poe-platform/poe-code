# S3 copy-admission directory index

Date: September 1, 2026.
Status: implementation and functional validation complete; guarded lint remains
the parent's integration gate, not a claimed worker pass.

## Scope and completed plan

- [x] Inspect current archive batching and existing copy/security controls.
- [x] Measure actual copy inputs with in-memory destinations before editing.
- [x] Prove a bounded directory index worthwhile with an in-memory prototype.
- [x] Add failing memfs regressions before implementing the index.
- [x] Validate all original cases, negative controls, and final copy timings.

Only `tests/integration/s3-http-exports/committed-archive.mjs` and
`tests/integration/s3-http-exports/archive-controls.test.mjs` change beneath
`packages/safe-bash`, plus this plan. Work resumed after the parent's reported
integration base `b8daebfe3`; no manual Git commands or integration-worktree Git
state changes were performed. Existing isolated fixture Git controls still ran.

## Implementation and boundaries

`copyRegularTree` receives an invocation-local directory-name index bounded to
256 directories, 32,768 names, and 1,048,576 characters including directory keys.
Every lookup obtains fresh directory metadata and checks directory kind. Reuse
requires matching dev, ino, mode, nlink, size, mtimeMs, and ctimeMs. Population
checks metadata before and after listing; incomplete identities are never cached.
Names are copied into owned arrays, and evicted entries are enumerated again.

Owned source-directory identity changes during listing fail. Unrelated ancestor
membership churn receives at most three listing attempts, then uncached admission
with the existing canonical spelling and fresh child checks. Ancestor dev/ino/mode
replacement and I/O errors still fail; errors are not swallowed or rerun through
a success fallback. Oversized empty directory keys also bypass storage.

No source bytes, hashes, results, verifier stages, mutable fixtures, or receipts
are shared. Every payload is read, checked before/after, written, and hashed as
before. Frozen filesystem capabilities remain supported without mutating the
caller. Directory metadata checks are not a lease or an ABA-proof guarantee.

Byte comparison confirms all helper code outside `copyRegularTree`, including
committed Git-object batching, remains unchanged. All pre-existing test bytes
remain unchanged apart from adding the memfs import and the new test block.
There are no production, evidence, workflow, concurrency, or test-limit edits.

## TDD and negative controls

- Final regression replay against the authenticated original helper: 49 new
  named cases, 24 expected failures and 25 passes.
- Final focused run: 63/63 pass, comprising 49 new index cases and all 14 existing
  copy-admission cases. Duration: 0.732724708 seconds.
- Ignoring cache identity is detected by all seven field-invalidation cases.
- Omitting post-list source identity validation is detected by all seven fields.
- Removing effective bounds fails all five selected bound/eviction controls.
- Sharing the index across invocations fails the invocation-isolation control.
- An oversized empty-key probe exposed a storage-loop defect under a two-second
  outer watchdog; the final implementation and dedicated memfs test pass.
- A frozen-capability probe exposed a read-only-property error; the dedicated
  regression passes after using an own property on the invocation-local wrapper.

Fault injection used isolated, source-authenticated, in-memory module overrides;
no on-disk runtime or historical evidence was mutated. Additional controls cover
canonical spelling changes, extra names, fresh symlink/special-file rejection,
all four ancestor membership fields, incomplete identities, and falsey/I/O errors.

## Final copy measurements

Serial A/B/B/A runs compare the original copy body captured before editing with
the final implementation, using identical installed tool/current dist inputs and
fresh memfs destinations. Exact path/size/SHA-256 inventories agree in every run.
These are copy-phase measurements, not disk-publication or full-gate timings.

| Copy group | Original runs (seconds) | Indexed runs (seconds) | Native listings before → after |
| --- | --- | --- | --- |
| TypeScript, Node and Undici build tools | 0.969221917 / 0.866798333 | 0.136408791 / 0.141113459 | 2,361 → 47 |
| Repeated consumer declaration tools | 0.326412333 / 0.410991750 | 0.049756166 / 0.035109625 | 1,160 → 26 |
| Current package dist | 3.274542416 / 2.929108000 | 0.235405750 / 0.264681542 | 10,981 → 54 |

Native listing time alone falls from 0.722–0.730 to 0.010–0.011 seconds for build
tools, 0.275–0.334 to 0.005–0.013 for consumer declarations, and 2.526–2.585 to
0.009–0.010 for dist. Fresh metadata calls increase, rather than disappear:
3,376 → 5,784; 1,631 → 2,817; and 14,901 → 25,936 respectively.

Payload reads and writes remain exactly 247, 115, and 968 per group. Corresponding
byte totals remain 26,147,198; 2,522,132; and 4,425,628. The declaration group
deliberately repeats the Node/Undici copying done later by the real verifier.

## Full-suite validation and timing limits

Command: `node --import tsx --test --test-reporter=tap packages/safe-bash/tests/integration/s3-http-exports/exports.test.ts`.

| Version | Passed cases | TAP duration (seconds) |
| --- | ---: | ---: |
| Original baseline | 127 | 133.965672375 |
| Initial indexed implementation | 165 | 154.047157250 |
| Bounds/churn regression expansion | 175 | 150.143935791 |
| Final implementation | 176 | 153.008184292 |

All 127 original names remain in their original order, with their assertions
unchanged. The final run has no failures, skips, cancellations, or todos.
Full-suite timings were co-loaded and did not demonstrate an overall speedup.
Do not extrapolate the isolated copy gains into a minute-scale or CI claim.

Only `npm run lint:eslint` was launched, never direct ESLint. With three guarded
lint processes active, this worker stopped only its own redundant child to reduce
hook contention (exit 143). The other two were untouched. This is explicitly not
a lint pass; the parent's normal integration hooks must provide that result.
No full-workspace test or CI result is claimed for this patch.
