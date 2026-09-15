# Shared history ownership qualification — 2026-09-14

**Acceptance remains open. This increment is evidence-only.** No runtime repair,
new ownership protocol or recovery guarantee is delivered. The precise remaining
blocker is that unmediated host/worker access to exposed native shared storage
can change guest observations without producing distinguishable replay journals,
and current public replay accepts some of those histories before issuing a new,
incorrect side effect. Documentation of the exclusion is not its enforcement.

Source: main `b97593d76b6ce19b38fb2e55c2a6cfc674ebf2a8` plus the pre-existing
working-tree changes. Node **22.23.2**, ICU **78.2**, V8
**12.4.254.21-node.56**, Darwin arm64. The unchanged runner source fingerprint is
`92ada3f4beabbe27ab7edc7811c92842cef7d32c4c060a1ec7a9c96bbde38578`.
The complete SafeJS tracked/untracked, nonignored file manifest fingerprint is
`d56b617a31ad8079ffd861ee748730425b944599e9bdd37ee98962ec1c3a0cb7`:
SHA-256 of Python `json.dumps(files, sort_keys=True)`, where `files` maps sorted
unique `git ls-files --cached --others --exclude-standard packages/safe-js`
regular-file paths to their SHA-256 digests. A base SHA alone does not identify
these dirty-source observations. The manifest and raw execution logs are retained
locally at `/tmp/qualify-shared-memory-current-audit`; they are not release
artifacts or committed implementation.

The target remains ECMA-262 edition 16 and ECMA-402 edition 12, June 2025, plus
the ledger's separately tracked newer APIs. Test262 remains pinned at
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. The official
[published edition PDF](https://ecma-international.org/wp-content/uploads/ECMA-262_16th_edition_june_2025.pdf)
was rechecked: §25.4.3.14 step 13 still specifies `(i × 4) + offset`, including
the BigInt path. Native eight-byte indexing and upstream passes do not resolve
that published-text discrepancy. No target or runtime floor was changed.

## Independent worker witness

[Executed manual QA](manual-qa.md) uses a native worker with a startup
acknowledgement and an atomic request/publication handshake. The request is sent
by the guest after the save call has settled, so the worker cannot race that
initial capture. Only the worker can block; the guest yields while awaiting
publication. Each worker is terminated in `finally`.

| History                                              | Original read | Words at pending boundary | Producer replayError | Normalized journal SHA-256                                         |
| ---------------------------------------------------- | ------------- | ------------------------- | -------------------- | ------------------------------------------------------------------ |
| Worker publishes zero                                | 0             | `[0,0,0]`                 | absent               | `3dbd666b8812cd78e77ec8c07217ae0bc9c00ba9c2d5da074a7f5d0a71cb1999` |
| Worker publishes seven, host resets after guest read | 7             | `[0,0,0]`                 | absent               | `3dbd666b8812cd78e77ec8c07217ae0bc9c00ba9c2d5da074a7f5d0a71cb1999` |

The journal comparison preserves all data, associations, order, lifecycle,
arguments and results. Only random run IDs are replaced with `RUN`, retaining
call ordinals. Hash encoding is sorted-key JSON with separators `(',', ':')`.
Deep equality and both independent original-value assertions pass, process exit 0. Complete heap equality is neither expected nor asserted. Worker-loop replay
is not claimed to pass: the replay journal contains no worker to publish its
marker. Exhausting a budget after attempting replay would not be the required
pre-resume unsupported-history rejection.

Two preliminary QA attempts failed and are retained locally. The first inherited
`--input-type=module` into an eval worker using `require`; the worker now has
explicit `execArgv: []`. The second lacked the guest request handshake and raced
the first save capture; its unequal-journal assertion failed. Adding the request
handshake orders the actual writes after settlement; no assertion or budget was
relaxed. The final witness is the independently acknowledged schedule above.

## Actual replay and side-effect rejection failure

The first module in `../agent-refresh/reproductions.md` was executed unchanged
against the same source. Its observation process exits 0, **not** a recovery
acceptance pass:

| Schedule                             | Original | Pending replay | Completed replay           | Effects after pending replay |
| ------------------------------------ | -------- | -------------- | -------------------------- | ---------------------------- |
| Synchronous write, return only       | 7        | 7              | 7                          | none                         |
| Queued write, return only            | 7        | **0 accepted** | **0 accepted**             | none                         |
| Synchronous write, subsequent effect | 7        | 7              | 7                          | `[7,7]`                      |
| Queued write, subsequent effect      | 7        | **0 accepted** | host-call mismatch rejects | **`[7,0]`**                  |

The host save runs once in every cell; `replayError` is absent in all snapshots.
Completed replay's later argument mismatch does not repair pending replay's
already-issued wrong effect. This validates SM-REPLAY-1/2 on the current code.

## Determinism and authority disposition

Guest-confined shared memory with no independent writer has reproducible
controlled traces. Existing boundary-coordinated host invocation/settlement and
callback tests also pass their explicitly scripted schedules, including retained
and cross-call aliases. Those examples do not prove that raw native buffers have
exclusive ownership between those boundaries. `registerSharedStorage` retains
block identity, and prefix/outcome snapshots record boundary bytes; neither
revokes a retained native view or records every intervening guest read.

A native SharedArrayBuffer alias is not revocable. A caller assertion that it
will not retain/mutate it would be a host trust contract, not enforcement.
Comparing bytes at the next boundary cannot detect change-and-undo, and copying
bytes concurrently does not capture an atomic history. The missing repair must
therefore either enforce a mediation/ownership protocol for supported capture,
or mark unmediated histories nonresumable and reject them during public restore
before guest execution, reconciliation providers or new host effects. Old
unproven snapshots also need a deliberate fail-closed disposition. No new boolean
trust option or altered legacy recovery assertion is substituted for that work.

Low-level restore has a narrower independently tested contract: it reconstructs
private storage and paused waiters. Owned `activateAtomicWaits` registers those
waiters; it does not reconnect an external agent cluster. Current tests cover
same-owner idempotence, different/missing owner rejection, heap-order-independent
FIFO, registration mutation rejection, partial-activation rollback, cancellation
and zero residual waiters. The remaining-time test retains 59,750 ms after a
250 ms elapsed capture and does not charge a later paused interval. This is saved
remaining execution time, not a promise to preserve an external wall-clock wait
history. Public raw-snapshot rejection remains distinct from low-level activation.

The conformance adapter grants blocking authority only in isolated fixture/agent
execution. Ordinary public execution stays nonblocking. That authority boundary
is intentional host policy, not an ECMAScript defect. The previously recorded
Node18 growable-storage failure is instead a required-runtime capability gap;
this audit has not repaired or reclassified it. Bun, Workerd, other platforms,
installed artifacts and full required-runtime conformance remain unqualified.

## Commands and checks

Run from `/Users/kjopek/Workspace/poe-code`:

```sh
npx vitest run packages/safe-js/test/conformance packages/safe-js/src/snapshot/atomic-wait-ownership.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-continuation.test.ts packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts packages/safe-js/src/interp/atomic-wait.test.ts packages/safe-js/src/interp/shared- packages/safe-js/src/interp/globals/atomics- packages/safe-js/src/interp/globals/shared-array-buffer.test.ts packages/safe-js/src/snapshot/shared-array-buffer.test.ts
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/qualify-shared-memory-test262 --include built-ins/SharedArrayBuffer --include built-ins/Atomics --timeout-ms 3000 --report /tmp/qualify-shared-memory-current-audit/upstream.jsonl
```

Focused checks: **509 passed / 43 files, zero failures/skips**, exit 0,
13.24 seconds. Coverage includes integer/BigInt operations, growth/aliases,
waitAsync/notify, invocation versus settlement writes, retained/cross-call
storage, independent agents, timers, cancellation and activation cleanup.
The manual modules use `node --import tsx --input-type=module` with their fenced
JavaScript supplied on standard input. No unit tests create files, no generated
QA script is added, and no runtime implementation or existing test is edited.

The upstream run follows the focused checks; no concurrent local test/build gate
is used. Its default budgets, 3,000 ms variant deadline and 10,000 ms startup
deadline are unchanged. Its terminal disposition is recorded below when complete.
Full package/build/backend gates were not rerun for this documentation-only
increment. No CLI visual behavior changed; screenshots are not applicable.

## Delivery

The task-owned Markdown QA, report and ledger appendix form one local Conventional
Commit. Existing staged Safe Bash edits and all pre-existing SafeJS source and
ledger text must remain intact. No unrelated implementation is adopted into this
commit. Required manual checks for these exact Markdown contents are recorded
with the terminal results below. **Remote-main delivery: none. Publication and
release receipts: none.** No push was requested or performed. A report commit is
not completion of qualify-shared-memory.

## Terminal results and exact-content review

Completed upstream selection: **493 files / 986 variants; 968 passed, 18 failed, zero unsupported/timeouts**, complete=true, exit **1**. All **238** previously excluded agent/blocking variants pass by exact filename/mode mapping. The 18 nonpasses remain the nine immutable-buffer helper fixtures in both modes, tracked separately from the published edition. Metadata and execution accounting errors: zero. Raw report SHA-256: `83dde11ccf347bae000e5275722bec74b4e512cd82bc84f3762435f08e0426b6`; exact command and every failing filename are retained in the report. No historical failure is erased by this run.

Completed at `2026-09-14T05:51:55.151Z`. Each of the following fails in both
sloppy and strict mode with `unexpected-throw`, runtime `Test262Error`, message
`no arg factories match include immutable and exclude undefined`:

- `built-ins/Atomics/add/immutable-buffer.js`
- `built-ins/Atomics/and/immutable-buffer.js`
- `built-ins/Atomics/compareExchange/immutable-buffer.js`
- `built-ins/Atomics/exchange/immutable-buffer.js`
- `built-ins/Atomics/notify/immutable-buffer-returns-0.js`
- `built-ins/Atomics/or/immutable-buffer.js`
- `built-ins/Atomics/store/immutable-buffer.js`
- `built-ins/Atomics/sub/immutable-buffer.js`
- `built-ins/Atomics/xor/immutable-buffer.js`

These are separately tracked newer-API helper failures, not omitted/skipped
variants. The historical BigInt timeout remains a historical nonpass with
unproven cause; this completed run has no timeout. Independent filename/mode
reconciliation finds all 238 former agent/blocking exclusions passing.

The final formatted Markdown worker module was re-executed, exit 0, and both
normalized journal hashes exactly match the table above. The formatted report
and QA, newly appended ledger section, and task-only staged diff pass Markdown
formatting and whitespace checks. No failing code test was waived; this is a
documentation-only commit of an unresolved recovery finding.
