# PDF parser robustness and corpus qualification

Status: **initial local robustness increment; mature qualification incomplete**.
Candidate base: `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the existing
working tree. This is not a frozen release candidate. New qualification source
SHA-256: `6aba9323f992ab2392c4ff3f71fd1d8e6d913c158d7e8fe02e6d3099d5b48878`.
Rehash the complete parser, manifests, bundled assets and dependent command
closure before any differential receipt; a base commit alone does not identify
this working tree. Existing work was preserved.

## Local executed controls

`packages/pdf-parser/src/qualification.test.ts` contains original, in-memory
fixtures; no downloaded documents, oracle processes or copied source are used.
The original fixture expressions and generator are retained as reproducible
corpus source, rather than generated disk PDFs.

| Control | Result and limits |
| --- | --- |
| Classic page headers 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.0 × rotations 0/90/180/270 | 36 cells pass page count, inherited rotation, MediaBox, empty extraction and unchanged caller bytes; header acceptance does not qualify version-specific features |
| Seeded object mutation | 512 cases, seed `0x504446`, LCG multiplier 1664525/increment 1013904223, 1–4 byte replacements; contiguous/chunked values or typed error codes/offsets agree |
| Failure reduction | Deterministic bounded deletion minimizer; negative control reduces `abc!def` to `!`; any generated mismatch reports seed, iteration, split and minimized hex |
| Strict syntax negatives | Malformed numeric tokens, negative reference, truncated containers, invalid name/hex escapes reject |
| Fatal boundaries | Input, work and retention admission reject with LIMIT in strict and recovery modes; falsey cancellation reasons propagate by identity |
| Expansion | 128-byte RunLength output rejects at expandedBytes=127 |
| Cumulative reads | Separate 4096-byte retained/work budgets exhaust in fewer than 64 object reads, rather than resetting per read |

Mutation limits: 4096 input bytes, 1024 token bytes, 128 syntax objects,
16 nesting levels, 65536 retained allocation units, 4096 expanded bytes and
65536 work units. These are deterministic admission checks, **not measured
JavaScript heap peaks**. The generator is finite and fixtures are small; it is
not an exhaustive fuzzer or a proof against hangs. Mutation success includes
valid mutated objects; rejected inputs are not labelled recovered documents.
No unexpected counterexample was found. New tests: five; total maintained
parser workspace suite: 156 passed, zero failed/skipped/cancelled.

Maintained verification: `npm run test --workspace=pdf-parser`,
`npm run lint --workspace=pdf-parser` (ESLint and both source/test typechecks),
and `npm run build:workspaces -- --workspace=pdf-parser` all exited 0 on Node
22.22.2. The workspace test route completed in approximately 4.24 seconds;
this is a single suite-duration observation, not a parser performance gate.
No shared/runtime implementation, export, dependency, workflow or visible CLI
changed, so repository-wide checks and screenshots were not executed here.

The first new corpus run failed with LIMIT when two semantic traversals shared
a deliberately small 128-object quota. Investigation confirmed cumulative
accounting, not a parsing failure. Each independent semantic cell now opens
its own document; a separate control verifies cumulative exhaustion. No runtime
implementation was changed, and no budget ceiling was raised to hide a failure.

## Corpus gate ledger

Local fixtures qualify only their stated semantics. Prior source/oracle controls
in the architecture document are upstream observations, not candidate passes.

| Required family | Existing local candidate evidence | Mature/differential status |
| --- | --- | --- |
| Old/new versions | Original classic-header/rotation cells above | Real producer documents for each admitted version missing |
| Classic, stream, hybrid xrefs | Revision workspace tests | Pinned complete-document oracle comparison missing; filtered xref integration unsupported |
| Incremental saves, free entries, generations | Revision workspace tests | Multi-producer/repaired history corpus missing |
| Encryption R2–R6 | Independent primitive/security workspace tests | Automatic encrypted document/text integration unsupported; encrypted complete-document corpus missing |
| Strict malformed/recovery | Syntax/revision controls and seeded mutations | Mature recovered producer corpus and minimized differential findings missing |
| Filters/predictors | Original decoder workspace vectors | Pinned corpus comparison missing; image codecs unsupported |
| Type1/simple fonts, ToUnicode, CID/vertical widths, TrueType cmap | Font/text workspace controls | Embedded Type1/CFF/Type3 completeness and mature embedded-font corpus missing |
| Rotation/vertical/RTL/layout | Original layout/font controls and rotation headers | Native reading-order/RTL/vertical-font parity unverified |
| Scanned documents | Empty-content page control only | **Not a scan pass**; image-only/hidden-OCR/mixed raster corpus missing; OCR outside parser scope |
| ActualText and Unicode | Explicit provenance and intentional semantic profiles | Nested Poppler differences require adjudication; not an agreement gate |
| PDF 2.0 extensions | Header and bounded initial structures | Language escapes, extension filters and complete PDF 2.0 support unverified |
| Byte/object/page APIs | Workspace tests | SDK/CLI installed artifacts, realm/host authority and original/checkpoint/replay cells unverified here |
| Memory/work/cancellation | Deterministic quota/reason controls | Heap/RSS peaks, interrupted mature files and event-loop/platform interruption latency unmeasured |

Keep syntax, recovery, raw inspection, extraction and rewriting separate.
Unsupported encryption, missing fonts/codecs, LIMIT and cancellation never count
as successful extraction. Preserve raw strings, streams, mappings, revision
provenance and glyph geometry even when a selected interpretation differs.

## Explicit opt-in differential QA (manual agent procedure)

Execute this Markdown procedure only with explicitly supplied local oracle
builds and approved fixture bytes. Do not put oracle invocation/downloads in
unit tests or automatic workspace pre/post hooks. No external parser adoption
is proposed or authorized by this QA.

1. Pin PDF.js `579c4b700f23f7782234f03358b5e9eaa3f58889`, Poppler
   `0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46` and qpdf
   `54d6053af283bbeb8b325f4886c0f65cc51f2b80`. Check source commit, local
   modifications, build options, executable/module hash, version and asset
   hashes. An installed version string alone cannot prove these revisions.
   PDF.js archived source reference SHA-256 is
   `aa4f80cb180ab11a7b5b4fe0aa20fe60e24ed804d42ff1d674fd988f5522eabb`;
   this does not identify an arbitrary built distribution.
2. Admit each fixture through a ledger containing ID, SHA-256, byte length,
   producer/version, relevant cells, expected strict/recovery result, origin,
   copyright holder, license/permission evidence and redistribution allowance.
   Original fixtures above are first-party; do not treat public download
   availability as permission for third-party corpus retention. Reject missing
   permissions. Keep restricted documents outside the repository and publish
   only permitted minimized cases. Pin fonts/CMaps and retain their notices.
3. Populate every missing family in the ledger. Include hybrid precedence,
   deleted revisions, indirect stream lengths with binary terminator bytes,
   object-stream index mismatches, old/new encryption and embedded-NUL
   passwords, damaged xrefs, embedded font families, vertical/RTL/rotated text,
   image-only pages and OCR text layers. Add independent expected byte/object
   results and deliberately invalid controls, not merely parser agreement.
4. Stage task-owned temporary inputs/results under `/out/pdf-parser-qualification`
   on a host providing `/out`. Record full candidate hashes and Node runtime.
   Supply engine bytes explicitly. Disable PDF.js URL/worker font/CMap fetches;
   provide only pinned local byte capabilities. Run native oracles in a
   disposable environment without network or unrelated host documents, with
   explicit per-process timeout/output/memory limits and cleanup after failure.
5. Compare raw object identity and current revision, page inventory and metadata
   separately from text. Run Poppler pdfinfo ordinary/custom/meta and pdftotext
   default/raw/layout/bbox profiles; qpdf check/show-xref/JSON inspection; PDF.js
   object/page/text controls with explicit assets. Capture status, diagnostics
   and output hashes. Native profiles are distinct observations; do not use
   normalized output alone as a lossless-byte assertion or equate text-run
   order with layout. Encryption/password retries must be explicit profiles.
6. For each difference identify specification, producer recovery, intentional
   profile difference, candidate defect or unresolved semantics. Minimize
   candidate defects while preserving the feature and error class; retain seed,
   original hash and minimized permitted bytes. Add a failing in-memory test
   before fixing a validated defect. Never swallow quotas/cancellation during
   minimization or classify an oracle timeout as parser rejection.
7. Separately measure peak heap/RSS and elapsed time for increasing admitted
   sizes, repeated reads, expansion bombs, sparse IDs/ranges and crypto rounds.
   Report environment, sample count, input/output size and quota settings.
   Exercise cancellation before admission, during capability lookup/decoder
   work and between crypto rounds. Record cooperative work-to-observation and
   wall-clock latency separately; synchronous platform calls cannot promise
   event-loop interruption. Confirm cleanup after failure and denied file,
   network, font and ambient oracle authority.
8. Verify dependent command exports through the maintained private-source
   artifact pattern, currently archived at
   `docs/plans/archive/safe-bash-command-package-pattern.md`. Its requested
   original path is absent in this working tree. Inspect complete packed parser
   imports/assets for external runtime dependencies; do not infer the closure
   from the empty manifest. Execute supported CLI/SDK, actual runtime and
   original/checkpoint/replay cells; inspect screenshots for changed CLI output.
9. Save a receipt with passes, failures, skips, unsupported, unavailable and
   incomplete cells separately. Purge task-owned staged logs/files afterward.
   Do not close mature qualification until required cells and budgets pass.

Execution availability on 2026-09-21: `qpdf`, `pdfinfo` and `pdftotext` are absent
from PATH; no pinned PDF.js build or permission-reviewed mature fixture corpus
was supplied. `/out` is also absent. Consequently steps 1–9's external differential
execution is **incomplete**, with zero oracle cells counted as passes. No parser
was downloaded, invoked or adopted; no temporary corpus output was generated.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. This receipt does not establish command compatibility or release readiness.
