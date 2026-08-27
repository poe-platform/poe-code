# Final frozen file replay —40 fresh cases, once

Candidate `cd37ce07c1f41f3797e19e0f701b662823338843`; actual completed run
2026-08-27T09:28:21.230Z–09:28:23.892Z (2662ms). This duration is an execution
record, not a performance comparison. No source edits, author tests, extra
product cases, native captures, dependency installation, stage or commit.

## Admission and immutable inputs

Root accepted completed `harness-review/V2_REVIEW.md` as the approval source,
superseding the unavailable tmp path for availability only. It explicitly says
F29v2 GO and retains F33/F34 scoped GO. Report SHA256:
`63350a5e103d837f22dc03ddf32ffe2a64b5afc98d452f74d35fe73a745c4a44`.
The exact approved runner SHA256 is unchanged:
`de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756`.

Used the already READY regular-file snapshot and copied locked dev dependencies,
not moving HEAD or live worktree imports. All597 frozen source/dev/build files
and54 original/private/restored artifacts verified before/after. No symlink or
hard-link aliases in candidate files. The unchanged READY publication remains a
separate zero-call checkpoint. No rebuild: its scoped strict type/declaration
build PASS is **REUSED, NOT RERUN**; no standalone consumer was run or claimed.

Source aggregate:
`f9276a3524347ec20030d41c25d2d5bc033471437b7a9749094585b17693ce0c`.
Development dependency aggregate:
`cda0820b8443488b19d0747cb97de37f8aec7492747bff286705a33f6026402e`.
Seven installed package version/integrity metadata entries match the lock;
individual copied files are hashed, without independent tarball verification.

The bridge has exactly five mechanical replacements from the historical v1
bridge: three frozen API imports, exact v2 runner import, and original40 selector.
Telemetry/promise behavior is unchanged. All actual file definitions execute via
the frozen `createFileCommand`; `fileCommands`, `FsError` and actual `Shell` are
manually bound. Root/public/default registration remains outside this task.

## Counts — no all-pass or cohort inflation

| Lane | Fresh result |
| --- | --- |
| Original scenarios |40 executed once;0 reused-as-final;0 retries |
| Raw semantic status |38 pass;0 fail;2 backend limitations |
| Adjudicated40 |35 pass;3 native-profile conflicts;2 backend limitations |
| Native case lane |17 exact-machine pass;3 conflicts;20 not-run |
| Content views |80/80 semantic accepted |
| Exact combined MIME |17/20 |
| Exact MIME type |18/20 |
| Exact MIME encoding |17/20 |
| Exact machine total |52/60 |
| Human description |20/20 semantic;4/20 exact characterization only |
| Unsupported / oracle unavailable |0 /0 within this frozen corpus |

Raw failure IDs and new routed source failure IDs: none. This does not turn
profile conflicts or backend characterizations into passes. All109 original
native observations are retained:80 linked to fresh content-view comparisons,
29 reference-only rows NOT newly compared and NOT passes. No new native calls.
The20 workflow native lanes stay not-run; semantic workflow success is distinct.

`final-content-comparisons.json` preserves each fixture's exact bytes/hash,
native stdout/stderr/status, actual output/status and read-only FS trace.
`final-native-reference-inventory.json` accounts for all109 historical rows.
`final-adjudication.json` identifies every F01–F40 result; all raw reports/events/
loaded-module logs/child stdout/stderr remain intact under `results/`.

## Profile and source changes

- F07 partial UTF-8 at EOF and F18 truncated six-byte PNG: native reports
  text/plain + unknown-8bit; strict candidate reports octet-stream + binary.
- F12's actual frozen ASCII PDF: both report application/pdf; native charset
  us-ascii versus candidate binary. The author's different iso8859-1 PDF is not
  substituted into this oracle. These three cases are NOT native-parity passes.
- F16 now produces registered application/vnd.sqlite3 and matches all three
  native machine views. Only its combined/type outputs changed among80 content
  views versus original d168; the frozen semantic alias/oracle did not change.
- F30 known oversized readFile is refused before reading; F31 provider lstat
  ENOTSUP is reported without reading. They remain backend characterizations,
  not successful classification. No invalid missing FileStat metadata fabricated.
- PE/Wasm remain unexecuted independent specimens, not new unsupported passes.
  No full magic parity, full-payload validator or unsupported-option matrix.

SQLite's classifier change is separate from TEXT preprocessing changes in
index/shared/README. The exact full commit also changes actual Shell plugin-host
admission/installation/disposal-ready-chain logic. READY source diffs and final
loaded hashes preserve that distinction; this is not an isolated TEXT or Shell
causality experiment. No new large-text safety cohort was added.

## Streams, cancellation, sinks and actual Shell

F27 consumes exactly one65536-byte prefix chunk and calls iterator.return once,
with requested start0/endExclusive65536. F28 preserves incomplete-prefix versus
EOF semantics and scalar segmentation. F32 receives one69632-byte upstream
allocation, retains only the allowed prefix and returns once; the consumer
cannot prevent that already-made upstream allocation. F29's successful PNG
readFile observes active real AbortSignals at FS entry, maxBytes65536 and no
signal-object identity requirement. JSON omits undefined reason fields; the
unchanged entry-time reason===undefined assertion did execute successfully.

F33 and F34 each genuinely call next1/return1, reject promptly with the exact
caller reason, and verify aborted FS signal with identical reason. Both inject
one late read rejection; F34 additionally injects one late return rejection.
Each unchanged assertion observes two event-loop turns with zero unhandled
rejections, then releases cleanup gates. These are fresh measured injections,
not the original early-stopped cases. No promise-handler change made them green.
This finite window is not a claim about arbitrary later uncooperative host work.

F35 retains sink byte ownership/no write overlap, awaits backpressure and
propagates the injected sink failure without retry. F36/F37 preserve denied-path
and stat/read-race diagnostics/effects. F40 preabort does no FS/input/sink work.
Actual Shell: F38 binary segmented PNG pipeline and stdin redirection; F39 named
plus stdin plus empty inputs in labeled/brief modes; F40 exact-reason preabort.
Five Shell calls:4 success/1 expected preabort rejection; all5 disposals observed.
Direct bridge:100 execute attempts,96 results and4 expected rejections.

All40 owned sequential children settled exit0; no timeout, retry or remaining
owned child. Same60s/case,600s/batch,2MiB child stdout/stderr cap and SIGKILL policy.
Family profile remains maxSniffBytes65536/maxReadFileBytes65536 (stricter than
default1MiB fallback); other defaults unchanged. Shell sinks have their own
shared limits, not a single shared file-family budget. Cancellation cannot undo
completed effects or force-stop arbitrary host work.

## Runtime closure and historical separation

Actually loaded21 product modules and4 harness modules, all frozen regular files.
Product imports were only node:path, node:stream/web and node:util; loader denies
product fs/child_process/zlib imports and external file-module locations. Product
closure aggregate:
`bfa06bed82d55b3421d5dad0c893dc60730ebf94a68a606fc199c60e6fc6426c`.
This is exercised/static import evidence, not a JavaScript host sandbox proof.

Original initial40 remains35raw pass/3fail/2limitations, with4 historical native
conflicts. Old v1 corrected3 remains a separate historical run; F29's v1 timing
defect and peer mock failure remain preserved. V2 pure controls remain nonproduct
checks. READY remains zero calls. No original report, PRESEAL or native oracle
was rewritten. Raw reports retain historical PREP policy.candidateExecutions=0;
that field describes the seal, not current execution telemetry.

Before product admission, two preparation mechanics errors (readonly new bridge
copy and parent syntax typo) were corrected with original artifacts/notes kept.
No candidate had run then; no product work was repeated. A later read-only
summary-display syntax typo did not execute product either. No source/oracle fix.
Stop at this bounded final40 checkpoint; no fullgate, public/default integration,
superiority, release readiness or independent whole-source safety approval.
