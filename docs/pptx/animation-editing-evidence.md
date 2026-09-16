# Animation editing evidence and language mappings

This supplement covers F46's four authored effects and simple main-sequence
triggers. It supplements [the inventory receipt](animation-schema-map.md), whose
read-only limitation remains correct for F45. The pinned baseline is recorded in
[the test audit](upstream-test-audit.md) and [the API audit](upstream-api-audit.md).
The new [case ledger](animation-editing-case-map.json) retains every row in the
focused 48-unit/six-BDD closure and its 48 adjacent public API records.

There are exactly three directly timing-named unit variants, no directly timing,
animation or trigger BDD scenarios, and no correspondingly named public API
records in the reconciled inventory. The new four-effect editor therefore needs
original format-contract assertions; reference suite pass counts cannot establish
its semantics. Generic collection sequence tests are not animation behavior.

## Source behavior and original assertions

The direct timing variants distinguish an absent timing tree, an existing video
and timing without a child time-node list. Existing media behavior cases exercise
insertion into absent, bare-node and extension-only timing structures. A bare
common node is not an existing video, and a nonempty inventory is not an exact
assertion of inserted video count, ID uniqueness or shape-target validity.
The separate original `animation-media-creation.test.ts` regressions now pass
all three variants, asserting exact ID/target lists, indefinite delays and retained
video/extension markup independently of the inventory. These satisfy the byte
operation behavior, without completing the live model. When child lists are
missing, preserving unrelated extensions is the target contract's deliberate
mapping from destructive wholesale replacement.

Track preservation tests cover opaque clip/poster binding aliases, multilingual
caption relationships and bytes, external links as inert metadata and extension
identifiers. They do not establish the three video-creation assertions. The
[track ledger](media-track-case-map.json) remains an independent receipt; this
supplement neither changes it nor counts its tests as animation playback.

Original authoring cases assert fresh IDs, one-slide shape targets, predecessor
references, dependent-effect removal refusal, literal fade directions, a 110%
scale cycle and preservation of opaque timeline siblings. The three passing original `animation-object-lifecycle.test.ts` cases independently
cover fresh shape identity with original timing markup retained, refusal to delete
an effect target until explicit removal/retargeting, and coherent slide import
with editable dependencies. Graph diagnostics supplement these lifecycle assertions. A round trip through the inventory alone is insufficient evidence.
Executed-check receipts belong in [the integration QA plan](../plans/pptx-animation-editing-qa.md).

## Exact JavaScript and security mappings

The operation surface uses camelCase typed options; the documented live model
retains neutral method/property spellings. The authoring operation is not a
replacement for live `SlideShapes.add_movie`, `Movie`, `_MediaFormat` or inherited
shape interfaces. All 48 adjacent API records remain individually retained: four
previous enum values and 44 pending live model rows. Leading underscores,
inheritance, lack of tests and returned-object status do not hide public APIs.
Their complete transitive closure remains in [the public register](public-api-map.json).

Animation kinds are exactly `appear`, `fade-in`, `fade-out`, `pulse`; triggers are
exactly `on-click`, `with-previous`, `after-previous`. Delay and duration are finite
integer milliseconds in 0..2147483647, with no bitwise coercion, seconds conversion
or host clock. Omitted delay is zero; omitted duration is 500 except appear zero.
Appear rejects a nonzero duration. Pulse is one centered 110% scale cycle and
return; a half-cycle duration is an internal encoding, not a changed public unit.

Target lookup is owner-scoped: a structured one-based slide position and unique
shape name, or an emitted selection token. Tokens remain opaque and stale tokens
fail; arbitrary token strings do not become XML IDs. Ordinary JS result-array
indexes remain zero-based. Master, foreign-slide, paragraph, subrun and chart-point
targets are outside this edit contract. With/after-previous require a supported
preceding effect in the same main sequence. Removing its predecessor must not
silently redirect a dependent effect.

Unknown XML, motion paths and complex scheduling stay inert and preserve-only.
Fresh timing IDs cannot collide with retained IDs, and target/condition references
must resolve in the owning slide. The writer may append beside opaque siblings
only when their bytes and dependencies can remain intact; otherwise edits fail
`unsupported-edit`. No XPath evaluation, executable animation code, media playback,
external link resolution, renderer, native runtime or product network is added.

Admission/publication use explicit byte/VFS capabilities and remain bounded and
cancellable. Dry-run has no output manifest or resulting fingerprint. Failed
mutation must not publish bytes or partially change the input. Shared command
errors map usage to 2, document/selection/unsupported edit to 1, I/O to 3, limits
to 4 and cancellation to 130. Force does not bypass semantic validation.

## Drift and evidence boundaries

The audit's historical “adaptation not started” phrases describe its original
checkpoint. They do not erase later bounded implementation, and new operations do
not complete the whole public API. `add_movie` returns `Movie`, correcting the
source annotation; neutral `add_movie`, `media_format`, `media_type`, `poster_frame`
spellings and nullable model-poster defaults remain distinct from the command's
explicit poster policy. These adjacent obligations are unchanged by F46.

The new tests/assets are original. No reference implementation or binary fixture
is copied into the product. The standalone [retained MIT notice](upstream-license-notice.txt)
remains the legal provenance location. Corpus use is disposable QA only, governed
by the manifest and [accounting/QA procedure](../plans/pptx-animation-editing-accounting.md).
No UI playback or visual-fidelity result is claimed by semantic graph checks.

## Primary schema interpretation

Microsoft's [scale behavior documentation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.animatescale?view=openxml-3.0.1) describes scaling around the element reference point and permits explicit
from/to values. The writer encodes 100000→110000→100000 on both axes, dividing the
full integer duration into floor/remainder halves so odd millisecond durations
remain exact. No position animation is authored. Treating the element reference
point as its center is the chosen format interpretation; the cited page does not
independently specify that point's location, and no playback measurement is claimed.

The [trigger enumeration](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.triggereventvalues?view=openxml-3.0.1) confirms distinct XML event spellings `onBegin`, `onEnd` and `onClick`.
These links were consulted September 13, 2026. Their remarks cite the first
ISO/IEC 29500 edition; they support the element interpretation, not complete
fifth-edition schema conformance. The current writer uses explicit predecessor
references rather than conflating begin/end with the onBegin/onEnd spellings.

## Atomic dependencies and click-group structure

The authoring suite now includes a parallel click-group structural assertion:
with-previous uses `onBegin` and remains in its predecessor's group; changing it
to on-click creates a separate group. Explicit 250/251 millisecond phase assertions
cover a 501 millisecond pulse without rounding the full duration. Unsupported
external references to a removed scale phase and unknown text payloads fail.

`mutateAnimationsBatch(input, operations, context)` accepts a dense bounded
array of declared add/set/remove options and returns the final admitted bytes.
Original selector tokens are resolved against the original input, then rebound to
their unchanged owner/shape identity for each sequential edit. An original SDK
regression changes the dependent trigger before removal and verifies the resulting
graph; reverse ordering fails without changing the original input. This is an
explicit typed operation surface, not arbitrary property or method evaluation.
The CLI batch uses the shared version-1 operation/arguments/options envelope,
with `--ops-json` or capability-scoped `--ops-file`, one publication after success,
and none after a later failed operation. Empty batches validate without publication.
The SDK operation limit is `min(1000, context.xmlLimits.maxNodes)`; sparse arrays,
accessors and executable array forms fail. Per-operation results contain metadata
only, never intermediate bytes.

## Executed verification

Root reports the maintained `pptx` package test route passed 150 files and 3,938
tests in 43.67 seconds. Package lint passed ESLint and production/test TypeScript
checks; the selected workspace build passed its declared three-workspace closure.
At that checkpoint the focused new suites contained 14 authoring/SDK, three
lifecycle, three media creation and ten command cases. A subsequent test-only
audit added five target-admission variants; the final focused 19-case authoring/SDK
suite and ESLint passed. The 3,938-case maintained result precedes those additions
and is not relabeled as a larger run. Supplemental scoped strict TypeScript and
safe-bash's expanded animation/batch script plus discovery passed. These numbers
do not imply whole-public-API completion.

Disposable QA on manifest-owned inputs found a supported template pulse with a
501 millisecond duration, six unique timing IDs and no diagnostics. Unsupported
complex/incomplete timelines rejected without changing fixture hashes. Adding a
fade on the first slide of the 32-slide deck preserved all existing timing XML.
An empty unrecognized timing root found during corpus QA became a small original
regression. Another original case distinguishes imported indefinite timing from
invalid caller input: it is preserve-only `unsupported-edit`.

Root inspected the actual animation/batch help screenshot at
`/tmp/pptx-animation-editing-help.png`; it was legible and exited successfully.
These are structural/CLI observations, not application playback. The first local
atomic test commit is `6ba90179a`; no push or release is claimed. Detailed QA and
check commands remain in `docs/plans`.

The final target-admission cases independently reject ambiguous shape names, slide
tokens, subrun-shaped locations, stale tokens after an intervening edit and targets
outside the selected slide. The atomic batch regression now also asserts every
per-operation fingerprint equals the original input fingerprint. Root validated
source and test TypeScript against the isolated staged package after correcting
index-only patch placement, while preserving unrelated shared-file edits.
