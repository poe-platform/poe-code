# Presentation case accounting

Status: Historical source-row and parameter accounting checkpoint; semantic
adaptation remains partial. The no-implementation statements below describe that
checkpoint, not the current package. Later bounded receipts are indexed in the
[API audit](upstream-api-audit.md); the current text/drawing reconciliation is
recorded [separately](text-drawing-reconciliation.md).

[The ledger](test-case-map.json) retains one row for each of 2,700 collected unit
nodes and 973 expanded BDD scenarios/examples. Every row has its source revision,
file hash, original behavior evidence, target TypeScript case or task, equivalence
rationale, status and execution evidence. No source identity was merged or removed.
The [agent procedure](../plans/pptx-case-behavior-expansion.md) records this update;
the [earlier receipt](../plans/pptx-test-case-accounting.md) remains historical.

## Unit behavior evidence

[The behavior register](test-behavior-evidence.json) retains source assertions,
mock expectations, explicit raises, complete test/fixture/helper source spans and
recursive fixture dependencies. Source text is research material under the
[standalone MIT notice](test-case-map-notice.txt), never product code or fixtures.
Its 2,450 spans and 71 file hashes are provenance, not coverage measurements.

All 2,057 parameterized node IDs match a unique static parameter table selection;
643 cases are unparameterized. Matching includes compound IDs, class names, enum
values, constants, unit values and helper-returned tables. Selected expressions
are source evidence, not evaluated fixture results. Every exact node remains a
separate row even when several nodes share a test body or fixture. Successful
no-exception parsing is retained even where the source contains no assert.

Each unit row has an original TypeScript adaptation task tied to its own source
contract. A task destination does not establish equivalence. Mock-only behavior
must become a specific public return, ownership, state, error or publication
assertion; private class topology is not a reason to drop a behavior. The task
includes every recorded assertion, not only the first or the function heading.

## Original designs and open work

The ledger distinguishes:

- 167 reviewed original designs, all awaiting implementation and passing evidence.
- 894 proposed BDD descriptions with expanded conditions/actions/outcomes and
  original content substitutions; source step definitions and fixture semantics
  still require reconciliation before semantic approval.
- One deferred public graphic-frame shadow behavior, with a specified rejection
  case. Rejection coverage does not establish shadow editing support.
- 2,611 unit cases with exact source contracts and assigned TypeScript tasks whose
  original semantic designs remain required.

Thus all source cases were assigned at this checkpoint, but the requirement to adapt every
applicable behavior is **not complete**. The pipeline's map-every-upstream-case
task must stay open. Neither drafts nor task assignments are counted as adapted,
implemented or passing cases. No blanket skips, architecture-only exclusions or
many-to-one source-row mergers are approved.

Reviewed additions include all 13 unit conversion cases, 19 paragraph spacing
cases, four freeform construction cases and an explicit metrics-based fitting
case. Existing image and navigation designs remain intact. Unit conversions
follow the shared rounding contract: 12.5 centipoints becomes 1,588 EMU, 2.53 cm
becomes 910,800 EMU, and 9,144.9 EMU rounds to 9,145. These deliberately differ from
source truncation and are not source-equivalence passes.

Paragraph cases distinguish null, numeric line multiples and Length objects.
A primitive's missing .pt member is a language typing issue, not an unavailable
model property. Freeform cases replace private start/scale assertions with
non-square original path bounds. Text fitting uses original text and explicit
metrics so 10pt fits and 11pt does not, without relying on host font differences.

## Validated research finding

The source BDD outline at features/cht-datalabels.feature:100 is named for the
value-label getter, but its Then clause reads show_series_name. The step
implementation at features/steps/datalabel.py:186–195 confirms which getter runs;
the model at src/pptx/chart/datalabel.py:125–140 defines separate XML flags.

Both expanded rows remain. Their original designs preserve the actual series-name
assertion and add the intended value assertion. The supplemental
label-switch-independence design uses opposite flags and verifies isolated
mutation and round-trip retention. This is a small original regression design
for a validated research gap, not a reproduced failure in an implemented product.

## Shared contracts and public API

All 2,424 API target obligations remain, including inherited members, enums,
collections, helpers, APIs without source tests and 17 bounded-view additions.
None is excluded for an underscore prefix. All 391 existing counterpart package,
image and XML obligations remain; matching source names never establish
cross-format equivalence.

The shared [SDK](../specs/office-sdk.md) and [CLI](../specs/office-cli.md) contracts
remain authoritative. [Language mappings](api-language-mappings.md) and the
[target API register](public-api-map.json) define model semantics; the later
[command register](command-coverage.json) records route corrections. Model
snake_case is retained. Operation JSON uses camelCase, dotted IDs and the common
version-1 envelope. Commands use images, tables, properties, text replace, schema
and capabilities. Whole-text setters remain distinct from preserving replacement.

Source baseline passes and declaration counts provide no target runtime evidence.
The historical input hashes in the ledger remain historical; current evidence
hashes identify the new behavior register and language notes. The historical
ledger's execution and implementation flags remain false; later receipts must
be assessed individually and do not retroactively change what this checkpoint
verified.

## Corpus and legal boundary

The [corpus manifest](corpus-manifest.json) remains the authority for disposable
QA inputs. This update uses metadata only; no binary is copied, mutated, shipped
or deleted. Unit fixtures must be independently authored in memory and work with
all downloads absent. Product corpus QA and visual checks remain unrun.

Reference identities and copied source expressions remain research/provenance
under the standalone notice. Original target names and authored assets remain
neutral. No README, product code, public CLI output, fixture binary or runtime
configuration changes are part of this update.

## Color design review

All 54 color-unit rows and three color BDD scenarios now have reviewed original
TypeScript designs. Exact color kinds, absent-property errors, theme sentinels,
luminance transforms and invalid channels remain distinct. BDD step definitions
and the original fixture precondition were inspected; original owner graphs and
assets replace it. Constructor argument typing follows J08; the RGB property setter retains its
declared ValueError for a non-RGBColor value. Invalid numeric values retain
ValueError. The hex parser research correction and supplemental
exact-width design are recorded in [the review](../plans/pptx-color-case-reconciliation.md).
The corpus verification is independent preparation, not execution of these cases.
