# P16 STOP source/data diagnosis v1

## Disposition

SOURCE/DATA ONLY. No product, supervisor, Worker, compiler, npm, comparator, native oracle, network, private runtime, XAN or arrays execution. No grant, escrow release, budget replenishment, original fixture edit, runtime patch or rescore. The consumed contract0 STOP and all 15 completed source-build passes remain unchanged. Ownership is only this new directory.

**Diagnosis:** the sealed trace validator's zero-unmatched requirement contradicts the selected public Shell invocation path. P16 has two top-level pipeline stages and two reachable literal rg child invocations. The two extra observed stages are those exact declared child argv, not evidence of an unexpected third command or undeclared Worker entry. This is source attribution plus saved-data reconciliation, not a new runtime acceptance result.

## Authenticated authorities

GO/root authorization commit 8f0a9fdaa84d7bae59040617577e2b0ee028d29b; GO 3534 bytes SHA256 5d37bb0ff2f321624783c0b6e3abc027031d98a15aaa3ec2aab31c96169273d9; root record 8642 bytes SHA256 dabb954161fc10903a02d4b457e53285a87ed2af0c40c42cd724427c43c7d9bb. Packet 7ef6e6b816ccc6b2449605c7950ab825d148a529; code a52819daa6ff2c867187b01a7a5bbbb189f0da02; preparation seal commit d6d6ce89c2b87cd92c417c256fde16bf986c91d9. CASES/SCHEMA/FIXTURES and executable harness bytes match their seal pins and stored commit blobs.

Actual evidence commit 78e5628e98a4ed408d0826985f8342a43ceee370; main MANIFEST SHA256 bad9be846fd0f1b3ac085210d2f1187184224fa563b4b79cf5685939875b1d55 (64073 bytes). Finalization commit beea35934ca0d5adb876f4e253b97d28bd6f5dd7; final manifest SHA256 303dbe7be3ea632a8f1c3bf2a95b37573dc10d3716b0f17e05145872979526dc. AUTHENTICATION.json records exact Git commit:path blob metadata and local Git-blob/SHA256 checks. The two large historical verification stdout captures were metadata-checked, not recopied/read to establish this diagnosis. Main manifest lists 201 files plus itself = 202; final lists 33 plus itself = 34.

Selected composition 8437e4eda904e1248c25eeef0d9d455b1d251495 is derived, not assumed stored. The preserved source-input archive at 633f6c82f738f1c69d6c7b6c91672524ec8688b2 was verified by stored blob, encoded SHA256 a49b8a7055ac2902d1368ddb638d62c5a1896dc9ed25c18b025816a710077509 and gzip SHA256 af8bebfcfd125e6008e3ec2071f030a7a438e48b5b01b3720f9ff637378f1f4c; decoded as bounded DATA only. No claim to requalify all 268 selected inputs or rebuild all 858 package files. Copied source was trusted only after selected inventory hash and stored-source authentication. Every P16 loaded-file row (225: 215 parent plus 10 child file-load rows) also matched authenticated admission and retained run-root inventory. Child preload/builtin rows are preserved separately, not mislabeled file loads.

## Exact authority contradiction

CASES.json:716 defines:

`find notes -type f -name '*.txt' -exec rg -H -n -F TODO '{}' ';' | sed 's/TODO/TASK/'`

CASES.json:719 onward declares only find and sed in argv, two zero stage exits, exit0, the exact 51 output bytes, empty stderr and unchanged files. CASES.json:762 separately declares the two literal children, with spaced path kept as one argument. SCHEMA.json:101 explicitly says argv is shell source order, not concurrent execution order; literalChildArgv records find-selected invocations separately. CASES.json:33 forbids imposing an order on independent pipeline stages. CASES.json:780 cautiously says middleware child entry is not guaranteed, but future-adapter.mjs:376 incorrectly asserts that the aggregate child executor bypasses middleware. Neither statement authorizes ignoring a real unexpected child.

The observer at future-adapter.mjs:300 records every middleware invocation. Both validators (mandatory safety at :163–172 and semantic assertion at :367–375) consume only row.argv, then require zero unmatched. Full observed stage order is sed(false), find(true), rg notes/a b.txt(true), rg notes/z.txt(true); every stage is kind=result, exit0. Removing the two declared top-level stages leaves exactly the two literal children. Mandatory safety first produces MANDATORY_TRACE_STOP, and the later assertion produces the preserved UNDECLARED_STAGE 2 !== 0. This is why stdout alone is insufficient. The later namespace/checkGuards assertion at :378 was not reached; independently comparing saved before/after confirms equality but does not retroactively execute that assertion.

## Original handler and Worker path

All line references below are to authenticated selected source, not live HEAD. SOURCE-EXCERPTS.json includes exact sections, source commits, blob IDs and hashes.

1. Adapter :298 creates actual Shell plus agentCommands. plugins/index.ts:67,97–101 composes standard commands. commands/index.ts:21,27 wraps the injected executor with directExecutor and gives it to findCommands.
2. find.ts:86–94 substitutes each matching filename into literal argv and awaits execute. Its conjunction short-circuits (:114–121), directory entries sort (:153), and visit awaits each child (:154). Only the two .txt files match; omit.log is lstat'ed but not content-read.
3. execution.ts:5–14 checks context.invoke first; this selected Shell provides it. It forwards argv, streams, cwd/env and explicit stdin provenance. It does NOT take the fallback that bypasses middleware. runtime.ts:1520 invokes the child; :2234–2266 builds quoted literal words and dispatches an isolated command; :1526–1535 composes middleware again. Thus the observed rg entries are reachable original handlers, not fabricated invoke receipts or replacements.
4. rg.ts:120–143 creates/opens RegexExecutor and submits matcher.batch([]) even for -F. matcher.ts:9–13 carries fixed:true in the descriptor and calls the session. client.ts:273–279 requests work, :202–216 allocates Slot, :79 constructs the admitted worker URL, :28–55/:289–295 closes each session, :146–148 retires slots when no session remains, :111–127 awaits product terminate. Two sequential rg invocations therefore explain two starts in this fixture. This per-command attribution is source inference: logs bind tokens to runtime P16 and worker entry, not a command-call stack.
5. sed.ts:2 uses its own Pattern/substitute implementation (regex.ts:51,295), not this rg RegexExecutor. Worker entry source regex-execution/worker.ts:1–48 imports matching, expr/bre-worker and protocol and processes descriptors. Loading expr/bre-worker is a static import, not evidence that an expr command ran.

Both tokens source-build:P16:1 and :2 load dist/commands/regex-execution/worker.js (1981 bytes; SHA256 46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f). PID1675, threadIds2 and3. Requested execArgv=[] and limits128MiB/4MiB; the sealed observer adds the explicit worker-preload import. The complete saved P16 parent loads, 24 child rows, 12 worker events, four stages, ten FS calls, outcome, namespace and cleanup fields are preserved in TRACE-DATA.json, not filtered to stdout. No network requests or authorizations, extra stage argv, foreign entry, admission refusal or FS mutation is visible in those domains. No claim about uninstrumented/opaque activity.

| Selected source | Stored revision | SHA256 |
|---|---|---|
| `src/plugins/index.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `35e65e44501ee190f6027e44bb4be28108954a316d46ab3aa2d76ce5e2924751` |
| `src/commands/index.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `67a0e34ea9a8518d2349b4707ef5214e9da0de790ea5c1973daac71dabc70aa9` |
| `src/commands/execution.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6` |
| `src/commands/find.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `534a5359a42bb7bf0020f21092740262edbe9053744e29d153fa9e6319539db2` |
| `src/shell/runtime.ts` | `d2502aae3c8458e0ac92662f2af07e7f9fc3923a` | `100361256ee71d7a263c92fa607de31ec1d3be9b1fb5c601b337c19e700ac4b3` |
| `src/commands/search/rg.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `1c38e14b811a46795af958a99b9fae6b02b415b6ff8363e5755ecd15bfdd9d5f` |
| `src/commands/search/matcher.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `db1d257b12c3cd11a2c8335fd2b56a3959e95c9a301cd8ed6d3dc16e9744989e` |
| `src/commands/regex-execution/client.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `5d086314898c38390753a07ef1c37001890ac2b47f3d0e05e221048b9db42ebc` |
| `src/commands/regex-execution/worker.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `a442bb67cda6aff313cf3909cbfb0d3d8c12ebc420437d5fd9d7bd51fc6c9da6` |
| `src/commands/text-programs/sed.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `38fceb4869a0db8197a050de3430d5b9c5017e1606a4348d17d8004745c645a9` |
| `src/commands/text-programs/regex.ts` | `67eab12e315054907ef4ef435c6bbca2f59e0c36` | `23df19386627659c3a5175562a2f8eeda873b81e3dc3e78d3cf51aafa7b3b06f` |

## Worker accounting, not posthoc settlement

All 16 saved observed records were compared to all three corresponding raw logs (48 exact parsed-sequence comparisons). Across 17 tokens: 17 constructor attempts, starts, preloads, entry loads, online events, product terminate calls, exits and terminate fulfillments; each exit code1, no pending terminate, errors, driver termination or emergency. WORKER token rows are in TRACE-DATA.json. Exit1 here is the recorded terminated Worker result, not a shell command failure.

Supervisor :207–209 saves the P16 observed receipt; :211 calls requireCleanSafety, whose admission.mjs:99 rejects its safetyStops. It never reaches :224 settleWorkerStarts for P16. Reservations :106–109 already withheld four; settlement :112–127 is a distinct authority transition. Frozen totals therefore remain 15 complete starts plus four unknown/withheld; aggregate productWorkerStarts=null. 372−15−4=353 remaining, not 372−17. Raw17 does not upgrade frozen null, refund two, prove missing role cleanup or authorize another settlement. No accounting-runtime fix is justified for this conservative STOP behavior.

Twenty parent loader roles have only their containing OS exit evidence, zero individual loader-exit receipts. Original 23 direct children and supervisor are reported reaped; 16 exec/dispose completions and zero fixture/listener/pending counters are scoped observations, not all-opaque-host drainage. This investigator starts no such roles.

## Capture completeness and finalizer error

RESULTS.json is not a truncated 16MiB stream. It contains 1,747,369 JSON bytes through the final brace (SHA256 571a4df930e419a06e831d202a021c72857c116f4222bf1225c1cec34b35044a), one LF, then 15,029,846 ASCII spaces. JSON+LF is 1,747,370 bytes (SHA256 6c845b1af4ab42227e20c0cfe8d0114ff21eb785c358e7eaea9016a0fe94c358). Full 16,777,216-byte hash is 4851193778874cd65ffbfc99b3ab70beed37c4060f3acf86cec6b28440c0d420. Parse/reserialize exactly reproduces that prefix. Supervisor :241–248 explicitly pads with spaces; the compact overflow fallback was not used. Meaningful bytes include duplicated raw/log/receipt data; padding is neither missing results nor meaningful workload.

Recomputed saved raw child streams156266 + original logs1099927 = frozen capture1256193; max child96639. Outer stdout62/stderr0 is separate. Run inventory5785 entries sums189140420 logical regular bytes exactly, including terminal16777216, receipts1622703 and admissions431892. Receipts+admissions2054595 and terminal are not extra charged child-stream bytes; they are scratch sidecars/duplication. External administrative files are also outside this frozen child capture/root scratch domain: main manifest-listed leaf bytes12779495, final manifest-listed leaf bytes33797750, excluding respective self-manifests and unlisted later work. Thus1256193 is not all evidence bytes. The33,549,064-byte historical verification stdout is retained, not recopied. No RSS, allocated-space, kernel-quota or global-storage claim. CAPTURE-ACCOUNTING.json contains exact per-file counters/hashes.

RECONCILIATION.json SHA256 9770fe7dc7a468f693488e3a95ff929cb365db20fd35a3c3fa05db8a1a825828 preserves ReferenceError: runInventory is not defined at transient .node_repl_cell_13.mjs:47:8040. Its saved93 memberships,23 stream records, counts/byLayout and Worker observations exist; completeness is field-scoped, not a successful finalizer assertion. The identified original transient script is not captured by the authenticated evidence manifests; no original expression, lexical scope, intended omitted fields or exact source patch is invented. This is an administrative DATA-reconciliation name-resolution failure, separate from the earlier adapter trace STOP; no evidence attributes it to product/runtime code. ACCOUNTING.json (8289 bytes; SHA256 7a46d1358a9947c7bce4742a16ac3d66be861187077ec352d5b06e79def2b850) is a saved-DATA supplement, not a retry.

## Minimal VERSIONED proposal — NOT implemented or granted

A new P16 trace-contract version should distinguish top-level argv from the separately declared child argv, require exactly one of each four expected result stages, require exact child argv/status/provenance and lexical child order, reject every extra/missing/duplicate/changed stage, and retain independent top-level concurrency freedom. Keep original script, inputs, expected bytes/status/VFS, worker admission, resource/cleanup controls unchanged. Update both duplicated stage validators and the false bypass qualification only in separately authorized new-version files. Preserve contract0 and its STOP. Do not merely increase an allowed count, discard extra stages, weaken safety or treat old P16 as green.

Nine DATA-only controls exercise this proposed membership rule: saved exact trace and independent pipeline swap accepted; missing child, extra child, duplicate, status drift, provenance drift, literal-path drift and child-order reversal rejected. This model is not harness implementation, does not claim hostile-JavaScript validation, and does not rerun or rescore any subject. Optional future accounting schema should explicitly separate observed raw counters, frozen settlement and scratch/stream/administrative byte domains; preserve unknown-withheld and explicit finalizer partial failure. No original escrow transition changes.

Finite proposal: the exact77 unrun memberships in NEXT-EXECUTION.json (source P17–P24/C01–C07=15; installed P01–P24/C01–C07=31; moved same31), plus at most one new-version source P16 diagnostic repeat. Do not repeat completed source P01–P15. This is78 subject children; if fresh setup3 and admission4 remain required, total85 direct children, not77. Under unchanged per-subject reservation4, this scenario requires up to312 reserved Worker starts and82 parent-loader roles (78+4); these are conditional costs, NOT an allocation or claimed sufficiency for a new harness. Additional controls/setup require explicit further costs.

**NEW ROOT GRANT REQUIRED:** authorize exact new version/selection, source P16 repeat, setup/admission costs, per-role bounds, clock/deadline and reservation disposition. Original remaining77 children cannot silently become85. Original exclusive remaining children77/Workers353/loaders77/capture418174207/scratch347730492 stays retained and unreleased; original parent JSON301 bytes SHA25686e8f86c74aad9f721b266ce49c6799285daeb8e56577da180017844a81f3dd0 and deadline1788026556000 remain unchanged. The consumed supervisor's effective deadline1787950849022 (2026-08-28T21:00:49.022Z) is historical authority, not a resettable future clock. No next execution is authorized by this proposal.

## Investigation limits

Coordination start1787950429458; immutable hard endpoint1787951029458. Budget/process receipts are in INVESTIGATION.json and final handoff. Only bounded Git metadata, apply_patch and explicit atomic Git evidence operations are used as sequential children; no background jobs. No installed-tool scans or imports of product/runtime/harness helpers. New files only in this assigned directory; foreign work and original escrow untouched. This diagnosis establishes the documented contradiction and capture domains, not full product acceptance, parity, superiority, deployed-provider behavior or72hours of work.
