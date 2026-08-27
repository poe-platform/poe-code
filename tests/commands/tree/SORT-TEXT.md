# TREE-WORK-002 and TEXT-BOUND-001 (tree)

Author candidate for a different verifier's frozen replay. Only tree-owned source
and tests change. The routed findings in the user message were sufficient; no new
hidden safety corpus, proposals or reviewer holdouts were inspected or executed.
There is no root/default integration, shared executor, FS, contract or lifecycle
change, and no claim of an unbounded engine or regex backtracking.

## Original bounded failures

The source under test was the tree content of
`dff53c461f7d84d826583bd5e19e95398ea77969`, unchanged on initial inspection:

- `tree.ts`: `449536d5ef259a44308d253c1f5af4bf7af7bed128deff688f9fb8df8bb4c44a`.
- `io.ts`: `ab76f076d122d27d6bfb04d623551c88f28fdd3f9408c06ae2dc3769462ba153`.
- `arguments.ts`: `572db370cad20fff449ed6ce43c0a358390a8f9cfb15ea447d4ac7aaec4b8c9a`.

All four new regression tests failed **before source edits**. Their exact TAP is
retained as `sort-text-original.tap`, including native TAP assertion whitespace.
It is captured data, not a TypeScript input or discovered test. This explicitly
classified `.tap` data does not require excluding canonical `.ts` files from
typechecking or test discovery. `sort-text-fixed.tap` retains the 12-test green
regression run. No original expected output or old test was relaxed.
The original raw TAP contains nine whitespace-only assertion-formatting lines
flagged by `git diff --check`; they are retained byte-for-byte as evidence. The
source, canonical regression, documentation, manifest and green report pass the
separately scoped whitespace check. No source/test check is waived by this data
classification.

| Small bounded fixture | Original measured result | Fixed measured result |
| --- | --- | --- |
| 32 entries, 64-byte names, 62-byte common prefix, work cap 256 | Shell status 0, stdout 2082 bytes, no diagnostic | Status 1, empty stdout, work-limit diagnostic |
| 32 two-byte names, alternating directories/files, depth 1 | Plain walk charges 97 units; `--dirsfirst` also fits exactly 97 | Plain walk charges 221; `--dirsfirst` fails at that same 221 cap |
| Error.message of 96 ASCII units, field cap 32 | One raw-message regex scan and one byte-size scan before rejection | Zero raw-message regex, byte-size or encode calls |
| 104-unit raw error: 96 uppercase letters plus `: denied`, cap 32 | Prefix stripped first; prints `.  [denied]` and ordinary diagnostic | Raw input rejected; empty stdout and field-limit diagnostic |

These are actual Shell/MemoryFS invocations and small direct counter probes, not
large-memory demonstrations. The biggest prefix fixture has only 2048 filename
bytes. Text probes use 96/104 units. Counters observe calls/work reservations,
not physical bytes read by `memcmp`, elapsed CPU time, heap/RSS or allocator
overhead. Finite name/entry limits existed before the fix; the defect was missing
cumulative accounting and pre-admission scans, not infinite computation.

## Exact policy and minimal root fixes

1. Before a byte-sort comparison, reserve one call unit plus both complete input
   byte lengths. Early byte differences do not refund this conservative charge.
   `--dirsfirst` retains the existing stable second sort and reserves one unit
   before each constant-size classification comparison. Both charges use the
   existing shared invocation `WalkBudget`, whose `step` checks the signal.
2. Before proportional text sizing, reject a UTF-16 length lower bound exceeding
   the per-field limit or remaining aggregate quota. For a surviving string,
   compute exact UTF-8 size and reject if necessary before regex/encoding. No
   truncation, prefix-stripping escape hatch or per-entry quota reset is added.
3. Admit raw backend error text before the existing anchored prefix regex. The
   rendered error still consumes metadata when visited, so repeated/raw/rendered
   strings are conservatively charged more than once. String-valued errors and
   Error.message meaning/path text remain intact within limits. Bounded primitive
   number/boolean/null/undefined text remains available. Opaque object, symbol,
   bigint or non-string message values get a fixed diagnostic instead of an
   unbounded/custom `toString` call. Host getters themselves remain opaque work.
4. Apply the same length-first admission to arguments and sink text. Admit cwd
   and raw operands before virtual path normalization. Returned names/targets
   already pass metadata admission before their subsequent scans/formatting.
5. Bound control expansion: raw escape input must fit remaining output before
   encoding; each escaped part is checked before appending. JSON preflight counts
   its exact field encoding, including quotes, backslashes, C0/C1, lone surrogates,
   format controls and UTF-8 characters, before stringify/control replacement.
   The final formatted write checks its aggregate size again. This bounds each
   fragment, not total engine/object overhead or already allocated backend text.

No default limit increases, public option/API changes, workers or new resources
are involved. Limits can now reject work formerly undercharged by the same
configuration. Sorting/formatting bytes within sufficient limits remain unchanged.
Ordinary errors still use human-readable utility diagnostics; resource failures
propagate at the command boundary and current Shell renders non-abort EFBIG as
status 1. Partial output from earlier successful writes remains possible.

The constant regexes remain fixed/linear rather than data-generated. The error
prefix regex now runs only after raw admission. Argument surrogate/digit checks
run after argument admission, trailing-slash processing uses admitted paths, and
the JSON control class runs only on preflight-bounded text. No global regex
infrastructure or worker cleanup mechanism is needed for these finite operations.

## Added checks and preserved cohorts

All 12 new tests pass. Beyond the four original red cases, they verify:

- Byte-sort quota rejection before any observed `Buffer.compare` call.
- Only one completed dirsfirst comparison when cancellation is injected after
  that comparison; the next evaluation observes the abort.
- Remaining metadata and oversized argument/sink inputs reject before raw scans.
  A 20-unit Unicode input whose UTF-8 encoding is 60 bytes still requires one
  **bounded** size scan to reject against 32 bytes; zero-scan claims apply only
  when the constant-time lower bound already exceeds the quota.
- Opaque exceptions never invoke the test object's custom coercion.
- Control-heavy text, compact JSON and pretty JSON pass at exactly their complete
  output byte lengths and fail one byte below. Over-limit control-field JSON is
  rejected before its observed stringify call; oversized diagnostic fragments
  are not written.
- TREE-WORK-001 still has an actual Shell cumulative matching check with quota
  above the newly charged sorting baseline. The old 256-unit many-name tests may
  now reject earlier during sorting; their direct matcher counters are unchanged.
  This new check prevents interpreting that earlier rejection alone as proof of
  matcher accounting.

The previous **65 tests remain unchanged** and pass alongside these 12: **77/77**,
zero failures/skips/cancellations/TODOs, using Node 22.22.2. Pinned native replay
remains enabled: 24 exact-byte cases, four parsed-JSON cases and all 34 original
native capture rows (six explicit divergences are not parity passes).
`node_modules/.bin/tsc --noEmit -p tests/commands/tree/tsconfig.json` passes on
canonical source/tests/helpers. The captured `.tap` and `.json` evidence is data;
no new broad exclusion or test waiver is added.

An isolated build under `/tmp/safe-bash-tree-sort-text-build-aZmzhJ` emits ESM and
declarations without writing live `dist`. A strict NodeNext consumer of the
existing standalone factories/types compiles and runs under plain Node, checking
actual Shell byte-sort and raw-error admission. This is not root/package-subpath
consumer evidence. `sort-text-source-manifest.json` records the final bounded
run's actually loaded hashes plus canonical owned TypeScript input coverage,
not a full-project typecheck or clean whole-repository gate.

The original native fixture hash remains
`a7c312188244ff48760b4a6b247983d2ffa66bcffd6072d67e63acd1f074a3ab` and the authenticated
tree 2.2.1 Darwin arm64 C/ASCII binary hash remains
`34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
Test-only prototype instrumentation restores originals in `finally`; all Shells
are disposed and per-run native/real fixtures use existing cleanup. No background
worker/resource remains. Independent verification of the committed final source
is still required before any integration.
