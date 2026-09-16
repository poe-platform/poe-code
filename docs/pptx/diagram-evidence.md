# Diagram resource evidence

This is bounded F40 research and implementation accounting, not a claim of
complete diagram editing or whole-public-API coverage. The model preserves
appearance resources; full automatic layout and semantic diagram mutation remain
unsupported. Validation receipts are recorded in the [plan](../plans/pptx-diagrams.md).

## Contract and language mapping

`readSelectionIndex(input, context)` is asynchronous and returns
`inventory.diagrams`. The configured `pptx inspect INPUT --json` operation uses
the same inventory at `data.inventory.diagrams`. These are detached read-only
records, not live shape-model objects. Resource discovery uses content types or
recognized incoming relationship types, including the drawing fallback type.

Each record has `part`, `kind` (`data`, `layout`, `style`, `colors`, `drawing`),
`owners`, `dependencies`, `missing` and literal `semanticEditing: false`.
Owners are distinct direct incoming relationship owners, not inferred slide
occurrences. Dependencies are the complete reachable existing internal part
closure, excluding the starting resource. Cycles terminate, shared resources
remain shared, and missing internal target names are reported separately.
Arrays use deterministic part-name order. External relationships are retained
as package metadata and are never fetched or included in the internal closure.
Fallback-only drawing resources remain inventory records even without data.

Input bytes use `Uint8Array`; admitted VFS inputs and archive/XML/relationship
limits come from explicit context. There is no ambient filesystem, font lookup,
clock, network, native runtime, rendering or layout engine. Package reads are
bounded; inspecting a missing edge does not create its target. Safe import must
reject an incomplete required closure rather than publish dangling references.
Original resource XML and binary bytes remain opaque during import; relationship
owners/targets may need relocation without rewriting unrelated resource payloads.

Neutral public model spellings such as `shape_type`, `has_chart` and `has_table`
remain distinct obligations. An inventory resource kind does not implement those
getters. Inherited properties, constructors, equality protocol, returned
`_OleFormat` and `PlaceholderGraphicFrame` members remain explicitly present in
[the focused ledger](diagram-case-map.json). Public XML/part views require bounded
views, never unrestricted dependency-library or host access. Source exceptions
need neutral typed JS errors; a missing object and a false discriminator are
not interchangeable. No broad mirror-completeness claim follows from this work.

## Pinned behavioral accounting and drift

The [test audit](upstream-test-audit.md), [test inventory](upstream-test-inventory.json),
[API audit](upstream-api-audit.md) and [API inventory](upstream-api-inventory.json)
use commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. The focused ledger retains
32 unit variants, 11 expanded BDD rows and 60 API entries. Its selection includes
all explicit graphfrm/graphicFrame/diagram/SmartArt mentions and all inherited
members of both graphic-frame interfaces plus the returned OLE interface and
diagram-related enums. Shared generic shape and OPC tests remain obligations in their
existing research ledgers; this selection is not a substitute for those ledgers.

Eleven unit variants concern discriminators: three chart flags, three table flags
and five shape types (chart, embedded object, linked object, table, unknown).
Five BDD examples repeat those input/output distinctions. None establishes
semantic diagram editing. Other adjacent construction/access/shadow/OLE cases
are retained as deferred public behavior rather than relabeled as completed.
No direct diagram-layout unit or BDD case was found in the pinned inventory;
original closure/preservation/security tests supplement that absence.

The pinned `GraphicFrame.shape_type` annotation promises an enum but its source
explicitly returns `None` for unrecognized frames, including diagrams. The JS
model obligation is `MSO_SHAPE_TYPE | null`. `DIAGRAM = 21` is an enum obligation,
not permission to change that return behavior. The existing documentation/source
version mismatch (published 1.0.0 versus pinned package 1.0.2) remains research
provenance, not a runtime compatibility promise.

No implementation or asset was copied for this receipt. Original TypeScript
fixtures/assertions must retain independent wording and bytes. The existing
[standalone MIT research notice](upstream-license-notice.txt) remains required;
substantial derived material additionally requires its applicable standalone
package notice. Reference identities belong only in research/plans/legal notices.

## Original evidence and limits

`packages/pptx/src/diagram-inventory.test.ts` contains two input-order variants
of shared resource closure and one fallback-only case. Literal expected arrays
independently check all five kinds, direct owners, a data/drawing/media cycle,
missing media targets and `semanticEditing: false`.

Import and CLI validation receipts are added to the plan as executed. Corpus
binaries are not unit dependencies. The [corpus manifest](corpus-manifest.json)
records 14 disposable inputs; its two explicit later diagram censuses report
zero diagram elements. This is insufficient evidence of real-world diagram
coverage. This research worker did not download, render, modify or delete corpus
fixtures and makes no visual fidelity claim.

`packages/pptx/src/diagram-api-contract.test.ts` passed nine original cases
(12 ms test execution). Public enum checks cover `DIAGRAM = 21`,
`IGX_GRAPHIC = 24` and placeholder `ORG_CHART = 11`/`dgm`. Seven XML input
families cover chart/table/embedded/linked/unknown/diagram/fallback frames.
The generic reader retains geometry without claiming a preset shape kind and
the ordinary `Shape` constructor rejects these frames with `invalid-value`,
leaving XML unchanged. These cases account for the source discriminator families
at the current security boundary; they do not claim the outstanding source
boolean/enum getter behavior. The ledger preserves that distinction explicitly.

`packages/pptx/src/diagram-import.test.ts` adds thirteen original cases for shared and
fallback-only imports, three missing-closure modes, four required diagram edge
selectors and both retained MCE choice/fallback branches. The import SDK call is
`importSlides(destinationBytes, sourceBytes, { sourceSlides: [1, 2] }, context)`.
Branch preservation remains bounded: identical shape IDs in mutually exclusive
MCE branches are retained, while duplicates within one branch are rejected.
Import preserves local shape IDs to avoid invalidating opaque diagram caches;
unknown branch namespaces remain unsupported.

`packages/safe-bash/tests/commands/pptx/diagram-inventory.test.ts` compares
configured `inspect --slide 1 --json` and SDK output for complete/missing/fallback
cases and checks every unrelated package member after `text replace` byte for
byte. It also asserts preservation-only capabilities. Integrator check receipts,
rather than test authoring alone, establish passing integration status.

The CLI worker subsequently reported six passing configured-command cases,
including collision-forcing `slides import` with independently resolved copied
data/drawing/image edges and byte equality. This adds command import evidence;
it does not close any live graphic-frame model gap.
