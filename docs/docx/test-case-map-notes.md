# DOCX test crosswalk research

The [crosswalk](test-case-map.json) accounts for **1,609 unit variants and 650
expanded BDD cases: 2,259 rows and 2,259 distinct proposed TS test targets**.
Mapping is complete for the pinned inventory. Adaptation is pending: there are
zero written target tests, passing results, implemented rows or architecture-only
exclusions in this task. Product parity is not established.

Source revision: `e45454602b53e8e572b179ccf1c91093ec9f4ed7`. The unchanged
[inventory](upstream-test-inventory.json) remains the identity authority.
Its `unmapped_not_implemented` labels describe the original acquisition; the
crosswalk supplies the subsequent mapping state without rewriting provenance.
The [verification receipt](test-case-map-verification.json) distinguishes
accounting checks from product execution. The [task record](../plans/docx-test-case-mapping.md)
contains the agent QA procedure and the later feature tasks' TDD handoff.

## Row interpretation

Each unit row preserves `node_id`, source file, inventory line and commit.
The inventory line may identify the first decorator; the assertion witness
identifies the function body. Each BDD identity is the tuple of source file,
line and **expanded** name. The retained inventory's template fields sometimes
already contain expanded names/lines; they are preserved without pretending they
identify an unexpanded outline. `example_identity` records the example row line
and column values. Plain scenarios have a null example identity.

`owning_task` contains the ordered pipeline ID and one-based position. `target`
gives a proposed neutral TS file and unique title, explicitly `planned-not-written`.
The title is a destination label; the assertion is the complete `semantic` record,
its witnesses and its mapping rules. A title alone is not an adequate test.
No product test may import this research map or derive tests dynamically from
reference IDs, text, fixture paths or code.

For unit cases, `expected_edge_values` contains the actual collected parameter
bindings, including fixture parameters; `parameter_indices` identifies their
collected alternatives. Tuples, enums, types and byte literals retain explicit
research representations. No parameter is inferred by splitting a pytest ID on
hyphens. `observations` retains comparisons, exception checks and mock interaction
assertions. `fixture_bindings` and `constant_expectations` resolve through the
[source evidence catalog](test-case-source-evidence.json), which includes setup,
returns and class data. An empty parameter object means the expectation is in
those constants/fixtures, not that the case lacks an edge value.

For BDD, `expanded_steps` contains all ordered substituted steps, tables and
literal expected values. `step_definition_bindings` links every one of the
**1,856 steps** to its source function and matched arguments. All 650 scenarios
were expanded and matched; no step was executed. Bound definitions retain the
computed expectations that a scenario title alone would lose.

`semantic.assertion` states the target invariant. The source expressions and
values are evidence of its precise boundary, not instructions to copy test code.
Original fixtures must replace incidental wording, paths, template metadata and
image payloads while retaining the meaningful state transition, expected value,
error, ordering and ownership. For example, a missing color element and an empty
run-properties element remain separate null-color cases; both are different from
an explicit automatic color or a theme color with a compatibility RGB value.
A mock constructor assertion becomes an observable owner/type/state assertion,
not a requirement to reproduce private wrapper allocation.

All targets are one-to-one. Shared file paths or shared witnesses do not merge
cases: each target title is distinct. No many-to-one equivalence is claimed.
Future consolidation requires explicit per-variant assertions and evidence that
each invariant is exercised; a generic round trip or shared test filename does
not supply that evidence.

`red_evidence` and `passing_result` deliberately have null commands, results,
revisions and evidence paths. They must be populated by the owning implementation
task, with original failing assertions before code and passing results after it.
Neither source-suite passes nor this documentary validation can fill those fields.
Every row remains a visible behavioral gap until that evidence exists.

## Contract reconciliation

The [shared CLI](../specs/office-cli.md) and [shared SDK](../specs/office-sdk.md)
control the target. The crosswalk embeds the exact `M-*` language/security rules
from the current [public API map](public-api-map.json), hashes that input and
retains all 23 `D01`–`D23` documentation/source resolutions. Rows identify their
primary rules and relevant differences; other applicable rules are not waived.

The model retains neutral method/property spellings and positional order.
Admission/factories/save are always asynchronous; admitted properties remain
synchronous. Sequences use zero-based lookup, `at`, iteration and only supported
slicing; styles and relationships are keyed, while comment lookup uses IDs and
can return null. Null, false, zero, omission and invalid input stay distinct.
Dates are copied UTC instants; lengths use checked EMUs and nearest, half-away
rounding. Owned bytes, explicit VFS/time/identity capabilities, bounded XML/part
views and inert external relationships replace ambient host access.

The CLI uses plural `images`, `tables`, `properties`, preserving `text replace`,
common flags, one-based scoped selectors, fingerprinted locations, the version 1
JSON envelope, schema and capabilities. Ordinary exits remain 0/1/2/3/4/130;
`diff` uses 0 equal, 1 different, 2 failure, 130 cancelled. Typed batch reaches
advanced behavior without arbitrary method invocation. Destructive model text
setters retain their separate semantics.

Known drift is resolved for this map without advancing the later specification
reconciliation task:

- Shared `allowEmpty`/`--allow-empty` governs zero-match mutations. The format
  spec's stale `allowMissing` phrase creates no alias. Text replacement requires
  exactly one of first/all/occurrence, including a unique match.
- Comment identity is `comment_id`, not the BDD title's `Comment.id`; `timestamp`
  replaces erroneous date aliases. Null comment text rejects, omission is empty.
- `table_direction`, actual style ownership/names and source enum values govern
  stale guide examples. Documented underscore-prefixed public types stay public.
- Native image height uses vertical DPI; each missing DPI axis falls back to 72.
  Explicit sizes use the shared checked rounding rule, not truncation or ties-to-even.
  Linked-only pictures are inert and do not satisfy the embedded-image predicate.
- Newly written run breaks use `w:br`; both `w:br` and `w:cr` read as line breaks.
  Paragraph text replacement removes run formatting; run text assignment retains it.
- RGB parsing requires exactly six ASCII hex digits. Core strings reject coercion
  and count at most 255 Unicode code points; revision reads can be zero but writes
  require positive safe integers. Dates normalize to UTC before serialization.
- Defined style flags reset/read false; latent overrides can remain null.
  A moved tab's live handle follows its new node and detached views become stale.

The API inventory currently has **920 records**, and the public API map has
**1,337 rows**, including enums/aliases, inherited members, protocols, returned
views and guide workflows. These are separate denominators from source tests.
The old 331-candidate preparation count is historical. Untested public APIs still
require independent original assertions; no absence from this crosswalk is a
private-mechanics disposition or a coverage exemption.

## Shared package, XML and image comparison

The [DOCX audit](upstream-test-audit.md) crosslinks the
[counterpart audit](../pptx/upstream-test-audit.md). Both cover relative part URIs,
relationship graphs, content-type/relationship XML and image sizing metadata.
DOCX graph cases include cycles/external edges and XML cases distinguish absent,
internal and external target modes. Those invariants can inform the shared
`office-package` targets, but neither format's historical passes close the other
format's cases. No counterpart denominator is added to this map.

DOCX has format-specific image-header tests; the counterpart has different
Pillow/WMF-related paths. The target must characterize PNG, JPEG JFIF/Exif,
GIF87a/89a, BMP and both-endian TIFF with bounded original inputs and retain
per-axis DPI and dimension cases. No host decoder, downloaded fixture or native
runtime becomes a product requirement. Shared security requirements—bounded ZIP,
DTD/entity rejection, safe publication, unknown XML preservation—need additional
original tests beyond these source cases.

## Provenance and limits

Unit **collection only** ran in a disposable Python 3.11.13 environment using
pytest 8.4.2, pyparsing 3.2.3, lxml 6.1.3 and Pillow 12.3.0. Behave 1.3.3 parsed
and matched BDD steps without executing them. An initial collector failed because
macOS resolved `/tmp` to `/private/tmp`; canonicalizing the research root fixed
the collector. No source was patched, warning suppressed or source test rerun.
Historical pass/coverage numbers and their missing raw-artifact limits remain
as recorded in the audits.

The catalog retains pinned source expressions under the separate
[MIT notice](upstream-license-notice.txt), which applies to this derived research
material. Reference-project identities remain in research/plans and standalone
legal notices. There are no product-source, comment, fixture, test-name, output,
branding or README changes.

No downloaded document or cloned binary fixture was read into this map, shipped,
committed or deleted. Existing disposable QA inputs remain available; meaningful
behaviors must become original in-memory regressions before their cleanup.
The source evidence stores code/literal parameters and source hashes, not binary
fixture contents. Canonical unit tests must not depend on any research checkout,
network resource, corpus file or this evidence catalog.
