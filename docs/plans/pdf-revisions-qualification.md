# pdf-revisions qualification

Status: draft, scoped revision/object inspection increment. No prerequisite or
dependent feature gate is closed by this receipt.

## Implemented scope

Private `pdf-parser`, separate from `pdf`, declares zero runtime dependencies.
Its runtime imports are relative first-party TypeScript modules only. No file,
network, native, WASM, entropy, font or host capability is acquired. No upstream
implementation was copied or adapted; the existing first-party MIT license is
retained. Research pins supplied for this task remain PDF.js
`579c4b700f23f7782234f03358b5e9eaa3f58889` (Apache-2.0), pdf-lib
`93dd36e85aa659a3bca09867d2d8fac172501fbe` (MIT), qpdf
`54d6053af283bbeb8b325f4886c0f65cc51f2b80`, MuPDF
`89c1d183a7fb724898b2017d6ecd402a61886d4f` and Poppler
`0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46`. These are research references,
not adopted runtime dependencies or authorization to adapt incompatible code.

Classic xref tables, unfiltered xref streams, `/W` zero-width defaults, `/Index`
defaults, `/Size`, newest-first `/Prev`, and hybrid `/XRefStm` precedence are
implemented. Free objects mask older entries and generation matching is exact.
Offsets and xref fields use safe checked arithmetic. Raw streams require a
validated length and aligned terminator; ordinary indirect `/Length` is resolved
through the document index. Binary payload terminator substrings are not scanned.
Unfiltered compressed objects validate `/N`, `/First`, header pairs, sorted
relative offsets, unique nonzero object numbers and exact member index. Repair
and eager cache retention are absent. Lazy reads share cumulative quotas;
input snapshots, nested stream snapshots and returned bytes have independent
ownership. Cancellation reasons and quota errors propagate without recovery.

Recovery is opt-in, bounded by the same reader budgets, and reports
`RECOVERY_SCAN`. It scans object candidates, skips successfully parsed stream
payloads and keeps the newest encountered object header. It does not reconstruct
free-object history or promise revision fidelity. Unsupported decoding and
reference errors remain fatal. Strict syntax requires a header at zero and a
final EOF marker.

## Independent evidence and limitations

Original byte-array fixtures cover classic updates, freed objects, generation
changes, xref/object streams, zero-width fields, indirect lengths, binary payloads
containing `endstream`, hybrid table placeholders, newer free entries over hybrid
history, revision/reference cycles, overflow, stream truncation, unsupported
filters, header validation, trailer size bounds, all input split points,
returned-byte ownership, cancellation and cumulative quotas. Unit tests create
no files and run no native oracle. Existing syntax fixtures remain passing.

PDF 2.0: an original 2.0-header fixture exercises only unfiltered xref/object
stream resolution. Other 2.0 structures and extensions remain unqualified.
Linearization: independently unqualified; linearization dictionaries, hint tables,
first-page sections and producer controls have no acceptance receipt here.
Filtered xref/object streams, encryption, pages, fonts, CMaps, extraction and
rewriting retain separate gates. Unfiltered indirect xref-stream lengths now
bootstrap from checked row layouts and are validated against their own revision
index before construction succeeds. Recovery is object-inspection best effort,
not a substitute for strict revision qualification. Quotas are conservative
allocation accounting, not exact JavaScript heap measurements. Actual browser,
workerd and checkpoint/replay integration qualification remains pending; the
Node-hosted isolated realm check described below passed.

The command-package pattern is currently available at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its original path is
absent in the working tree. No command exports or registration change is part of
this task. Future command consumers must bundle this source via the maintained
private-package boundary and prove isolated installed artifacts contain no bare
private imports. This increment does not claim that the whole Safe Bash artifact
has zero external dependencies or qualify its published runtime graph.

## Verification

- `npm test --workspace=pdf-parser`: 24 passing groups (11 syntax, 13 revision).
- `npm run lint --workspace=pdf-parser`: ESLint and source/test type checks.
- `npm run build:workspaces -- --workspace=pdf-parser`: selected maintained build.

No CLI behavior changes; screenshot qualification is not applicable to this
byte/object API increment. No local commit, remote-main delivery or release is
claimed.

## Task diff review

Dictionary name lookups previously converted byte names through temporary
arrays and strings without charging lookup work. They now compare bytes directly
and charge entry visits and compared bytes against the document's cumulative
work budget. The allocation regression fails with the original conversion and
passes with direct comparison. Syntax-shaped cancellation reasons were tested
during strict parsing and recovery and propagate unchanged; no cancellation fix
was necessary. The 22-test route, package lint/typechecks and selected maintained
workspace build passed after the change. Runtime imports remain relative,
first-party modules; no host capabilities or external runtime dependency were
added. Existing contributors' changes outside these reviewed files were preserved.

Unresolved findings block final revision qualification: linearization has no
independent acceptance fixtures. Filter decoding and full
PDF 2.0 structure qualification remain separate gates. Safe Bash artifact
integration has no installed-consumer receipt for this parser increment. There
is no snapshot/version format change in this review.

## Indirect xref length candidate receipt

The new original fixture first failed with `REFERENCE: missing object`, proving
the bootstrap gap. The engine now derives the exact unfiltered stream byte count
from checked widths and ranges without scanning binary payloads. After section
loading, it builds revision-local indexes oldest first and validates the indirect
length with generation checks, reference-cycle detection and shared quotas.
Newer replacement or freeing of a length object cannot alter historical length
validation. The shared layout validator also bounds total rows before allocation;
hybrid visited-offset bookkeeping now charges its retained allocation.

The final 24-group package route passed with zero failures/skips. The added
controls cover mismatched/cyclic/wrong-generation lengths, huge Size, zero-width
layout, all byte splits, allocation/object budgets, and malformed object-stream
headers/members. One initial negative fixture selected a legal whitespace
boundary for `/First`; correcting it to an actual header overlap made the control
valid. Source/test lint and typechecks and the maintained selected workspace build
passed on the final runtime candidate. No broad repository gate was run because
the change stays within this leaf workspace and adds no shared wiring.

Executed [manual QA](pdf-revisions-candidate-qa.md) against the built SDK in a
fresh Node VM module realm: only the three explicit first-party modules admitted,
no process/Buffer/require/fetch globals, cross-realm bytes/chunks accepted,
non-byte views rejected, returned-byte ownership preserved, argument errors and
fatal recovery quotas checked, and falsey cancellation reason propagated exactly.
This is a deterministic Node-hosted realm check, not a browser/workerd or bounded
performance receipt. Runtime imports are relative first-party modules only; the
private manifest still declares zero runtime dependencies. No native oracle,
upstream code adaptation or ambient PDF acquisition was used.

SHA-256 runtime source candidate:

- `src/index.ts`: `32e1b23245792f2956eee6adc358971a896d9edd80eedb8d8f6c7e69cb342fae`
- `src/syntax.ts`: `c8b65fe0bbedd479f2b483690ecab8caef330eed8eefb578eb5fada2fd444bb2`
- `src/revisions.ts`: `687c5dbeb8150c9ee715f5bbc164aabc9cfe22dcb945c322b7dde69dec5b9a04`

CLI/screenshot checks are not applicable: no visible command change. Actual
runtime matrix, Safe Bash installed-artifact integration, checkpoint/replay,
linearization and remaining PDF 2.0 structure cells remain unverified. Filter,
encryption, font, page and text feature gates remain independent. No task-owned
temporary logs or generated evidence files remain. Local commits: none;
verified remote-main delivery: none; successful releases: none.
