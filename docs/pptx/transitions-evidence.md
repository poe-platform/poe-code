# Transition subset research and mappings

This receipt covers F44 only. The pinned test audit's historical “adaptation not
started” checkpoint is not a current package status. No transition-specific
source tests or API members were found in the complete inventories; the exact
search denominators and input hashes are in [the case map](transitions-case-map.json).
The source baseline is python-pptx commit
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. Existing package/slide/model cases retain
their prior obligations. No inherited member, enum, collection, helper or
underscore-prefixed public API was removed or marked private by this work.
Whole public API coverage remains partial.

## Format evidence

Consulted 2026-09-13:

- [Slide transition extensions, MS-PPTX 2.2.1](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/22ebe6b5-2ade-43d9-977a-98fa194725c2)
  identifies compatibility Choice/Fallback transition content, Morph, and the
  duration extension. Complex branches require retention, not replacement by a
  newly inserted competing direct transition.
- [Duration, MS-PPTX 2.3.2.3](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/9032bdb2-b273-470b-8ac4-c98a8c944494)
  defines the duration extension; its namespace is
  `http://schemas.microsoft.com/office/powerpoint/2010/main`.
- [Presentation transition metadata](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.transition?view=openxml-3.0.1)
  identifies unqualified `advTm` in milliseconds, `advClick`, namespaced `p14:dur`,
  sound actions and transition effect children.

The utility's creation defaults come from the local format contract: fade/push/
wipe duration 500 ms, cut duration zero, click advance true and no automatic
advance when advanceAfter is absent. Existing speed-only metadata does not
establish an exact millisecond duration. Zero automatic delay is immediate, not
absence. Unsupported effect variants and compatibility branches remain
preserve-only. Sound bytes and relationships are never fetched or played.

## JavaScript and security mapping

The new operation SDK is additive, not a renamed upstream live transition object.
It accepts admitted `Uint8Array` bytes, typed options and explicit context limits;
read/mutate boundaries return promises. Results are detached records/package
bytes, not live source proxies. CLI flags use kebab-case and typed operation
options use camelCase. No ambient filesystem, process, network, clock or font
capability is introduced. The existing neutral OfficeError/SelectionError
categories remain the error boundary; unsupported edits fail before publication.

Duration and automatic delay use JavaScript integer numbers in 0..2147483647;
nonfinite, fractional, negative and oversized values fail without coercion or
seconds conversion. `undefined` means omitted; no null-as-false coercion occurs.
The selected slide operation uses the existing one-based slide selector and
identity tokens, not the proposed zero-based live model collection API.

The public API audit's recorded documentation-version drift remains unchanged:
source 1.0.2 versus published 1.0.0 does not establish new transition members.
No source implementation, test wording or binary asset was copied. No additional
derived-material MIT notice is required; existing standalone notices are retained.

Executed tests and corpus findings are recorded in
[the implementation plan](../plans/pptx-transitions.md) and
[the corpus QA plan](../plans/pptx-transitions-corpus-qa.md). These receipts do not
claim renderer/playback fidelity or complete API parity.

The exported synchronous `validateTransitionOptions(action, options)` helper
validates the closed authoring option record before byte admission. It returns
`void` or throws the same neutral `OfficeError`; it performs no I/O or mutation.
Its boundary behavior is exercised by the pre-read SDK and CLI rejection cases.
`readTransitions` returns one detached record per selected slide, with `kind: null`
for absence; CLI list/get filters absent records into the required empty items
list. Wrapped transition records are explicitly unsupported and do not claim
branch-effective timing metadata.
