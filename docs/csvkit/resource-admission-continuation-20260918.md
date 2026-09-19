# Resource admission continuation

This continues the existing uncommitted suite; it does not establish full csvkit
2.2.0 compatibility. The source hash/profile/captured observations were preserved.
No new native reference requalification or real service qualification is claimed.

## Reproduced issues and changes

- SDK settings exceeded host argument/retained limits yet reached a match-file
  opener. Original regression threw `unexpected open`. Settings graph admission
  now runs before cloning/acquisition and carries retained charges into Runtime.
  Independently cloned aliases, nested graphs and bigint zero-byte allowance have
  exact status-78 diagnostics. Settings are evaluated once; nested accessors,
  shared backing stores and unqualified object/deep-clone profiles are explicit
  divergences. maxNestingDepth defaults to 100; depth beyond 256 remains unqualified.
- A JSON over-depth malformed child originally produced status 1. Host nesting
  now denies before allocating/parsing its container, through argv and SDK.
- Oversized supplementary-character JSON strings originally reached JSON.parse
  before denial. A decoding spy reproduced the allocation boundary. Lexical
  codepoint admission and retained admission now precede token slicing/decoding.
  Literal/escaped supplementary pairs and escaped solidus fit the same bounds.
- An independent agent reproduced TextEncoder allocation before output denial,
  including exhausted shared channels and bulk side-file concatenation. UTF-8
  preflight now precedes encoding and bulk concatenation; surrogate pairs across
  joined bulk chunks are preserved. Cooperative cleanup drains admitted writes.
- The independent agent reproduced excess column/row parsing before denial,
  including field-budget precedence. Columns deny before accumulating excess
  fields; invocation-local row reservation denies before excess records parse,
  including across named readers. Blank/multiline records, empty exhausted readers,
  recordLimit and SDK no-header loading have focused coverage.
- Independent in-memory stress reproduced local side-file closure followed by
  forbidden acquisition: a registration callback closed the destination scope,
  yet empty input succeeded after truncating it and nonempty input truncated it
  before rejecting. Two more cases advanced the text producer after cleanup
  closed admission during a pending open/write. Four failing regressions now
  pass after checks before open, after awaited acquisition and after awaited
  write. Registration-time closure opens no file and preserves existing bytes;
  acquired handles close once, admitted writes drain, and subsequent producer
  acquisition/advancement is denied. Existing loop-body checks cover closure
  triggered synchronously by a producer. Read-only late open/write rejection
  probes preserve primary error identity, settle cleanup and observe no unhandled
  rejections; they do not claim rollback of completed effects.

The mixed raw/escaped surrogate fixtures initially used lone UTF-16 surrogates
as UTF-8 producer input. TextEncoder replaces those units, so their byte input
does not describe the proposed paired Unicode JSON. They were removed from that
valid-UTF-8 boundary test and are not credited as passes. Short escaped newline
also follows Agate Text/null conversion rather than preserving raw newline text;
the codepoint boundary test uses escaped solidus instead of asserting a different
serializer profile.

## Verification

- Final maintained csvkit workspace tests: 90 files, 4,228 passed, one skip and five
  TODOs excluded. Counts include policy refusals, not just native differentials.
- Maintained csvkit lint: ESLint and strict product/test TypeScript checks pass.
- Selected uncached safe-bash build closure: 11 declared builds pass; final
  csvkit dependency closure: four declared builds pass.
- Actual Shell registered-command file: 74 tests pass, with no exclusions.
  The final complete CSV-family Shell sweep passes after the row assertion was
  added. Its dot reporter supplies completion/status rather than a parity tally;
  existing refusal, skip and TODO cases are not native compatibility passes.
  After the final lifecycle guard and rebuilt domain, the selected registration,
  csvclean, input-lifecycle and byte-ownership Shell files pass 107 tests with
  no exclusions. The independent guard review passes 67 focused domain cases,
  strict test typecheck and exact-file ESLint before final maintained checks.
- Maintained safe-bash typecheck: source/tests and 26 current consumer groups
  pass, including expected negative-consumer rejection; compile-only evidence.
- Repository type lint/contracts and workflow lint pass. Guarded repository
  ESLint completes with zero errors and two docx-test warnings: 16,009 configured
  subjects linted, 18,069 opens/closes, no admission failure. This precedes the
  final lexical-string and row-test additions; their package lint passes above.
- The selected committed-archive admission control passes, preserving guarded
  build authority and raw path/payload bytes. It is a synthetic selected control,
  not a complete archive/packed-consumer gate.
- An actual Shell table and column/nesting diagnostics were rendered through
  scripts/screenshot.ts and visually inspected: readable, aligned, no clipping.
  The temporary owned screenshot is purged after reduction into this record.
- Normal repository npm test completed with exit 1; no repository unit pass is claimed.
  Its fresh frozen shared phase passes 2,895 files with two skipped files:
  133,694 passed tests, three skipped and five TODOs. The maintained safe-bash
  runner phase passes 536 tests. The subsequent safe-bash command reports two
  committed-revision failures and 22 public-cleanup setup failures. Final output
  truncation prevents crediting an exact overall safe-bash pass tally here.
  An earlier completed run failed three newly introduced row cases
  because it started before the row fix and ran while source was changing.
  Read-only runner/Vite inspection supports stale transformed source as the
  explanation (file isolation does not invalidate cached transforms); it is not
  forensic proof. The fresh frozen shared phase passes those cases. The final
  narrow lifecycle patch follows this broad run and is covered by final focused
  checks above; the failed broad run is not presented as final-source acceptance.
  An accidentally broad second safe-bash test invocation was stopped; it is an
  interrupted check, not a pass. The focused actual-Shell file was then run
  directly with the maintained Node/tsx test engine. Other processes were preserved.

## Reproduced integration gate blockers

The selected committed Pandoc metadata case independently fails with
`committed build input differs from reviewed authority: scripts/build.mjs`.
The packed S3 exports check also fails in the normal repository run. The guarded
build script was already modified when this continuation began; no commit, live
overlay, verifier weakening or reversal of that existing change is authorized.

The public invocation-cleanup file independently reproduces 22 setup failures
with `Unadmitted peer public route: @e965/xlsx`, before native retirement cases
execute. The fresh maintained repository build makes the workbook reader part
of the peer's emitted runtime closure. Its external imports exceed the current
peer verifier's built-workspace-only model. Fixing this requires authenticated
external metadata/file/import-edge capture, staging and loader checks, including
transitive dependency ownership; merely accepting the bare import is insufficient.
No admission bypass or rollback of the workbook implementation was made. Earlier
focused public-cleanup passes do not qualify this freshly rebuilt closure.

QA procedure: docs/plans/csvkit-resource-admission-continuation-qa.md.

## Explicit remaining blockers

Full reference compatibility remains unfinished as described in implementation-
status.md and individual specifications. These additions do not qualify every
input quoting mode, Python regex feature, Decimal algorithm, codec/compression,
SQL dialect/driver/service or Python/IPython session profile. Workbook dependency
allocation/preemption, CSV row serializer intermediates, diagnostic allocations,
schema/SQL/session resources and every original test denominator remain open.
The new nesting knob is qualified for SDK data graphs and decoded JSON containers;
it is not a universal schema/output nesting guarantee. Retained accounting remains
the implementation's cumulative admission model, not a hard peak-memory/RSS claim.
Cancellation cannot undo completed effects or preempt arbitrary trusted host work.

Independent read-only stress additionally reproduced a CSV row serializer
allocation boundary: with maxOutputBytes zero, Runtime.row(["a\rb"]) calls
String.split for CR normalization before output denial. Encoding and sink writes
remain denied, but serializer intermediates remain an allocation blocker.
An admission refactor must retain dialect-first/per-cell native error ordering
(missing escape and timedelta overflow currently precede byte denial) and count
the assembled Unicode sequence. Accepted lone-surrogate delimiters/quotes/endings
can pair across field boundaries; summing independently encoded fragments is
incorrect. Primitive-string CR normalization differs from typed descriptor text.
No serializer qualification or fix is credited by this review.

No README content, staging, commit, push or publication was performed.
