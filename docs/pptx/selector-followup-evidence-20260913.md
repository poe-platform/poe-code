# Empty simple text selection evidence

The SDK previously threw `missing-selection` while resolving an absent slide or
shape before replacement could honor `allowEmpty`. The same defect propagated
through `text replace --allow-empty`. The domain replacement operation now treats
only missing non-token selection as an empty collection; shared text reading
behavior and opaque token validation remain unchanged.

## Original paired acceptance

`packages/pptx/src/text-replacement.test.ts` and
`packages/pptx/src/command-text-replace.test.ts` use original small decks and
memfs. Both exercise missing slide 9 and exact shape label Absent with first,
all and occurrence 2, checking failure by default and zero effects with explicit
empty intent. No scope is widened. SDK output bytes equal the input. CLI dry-run
never publishes; a normal explicit destination receives the original bytes and
retains the source.

Controls cover invalid positions 0 and 0.5, ambiguous labels, missing identity
tokens and stale fingerprints. CLI invalid positions fail with status 2 before
reading. Missing/stale tokens remain failures despite empty intent.

Red: four new paired cases failed, 55 tests passed, before implementation.
Green: final focused run passed 64 tests across both files in 2.58 seconds.
Command: `npx vitest run packages/pptx/src/text-replacement.test.ts packages/pptx/src/command-text-replace.test.ts`.

Maintained package lint passed: `npm run lint --workspace=pptx` (ESLint, source
typecheck and test typecheck).

Root additionally ran the actual shell selector and chart-editing integration
checks after the maintained PPTX workspace build closure: 49 tests passed.
An additional original manual check used the built SDK with the actual Shell
and its explicit memory filesystem: first/all/occurrence 2 each returned zero
effects for an absent shape with empty intent, and source bytes stayed identical.

Root captured and visually inspected actual command-engine human output in
`screenshots/pptx-selector-followup-20260913.png`: zero validated matches and exit
0 with empty intent; `missing-selection` and exit 1 without it. Manual QA steps
are in `docs/plans/pptx-selector-followup-20260913.md`.

## JS and security mapping

The bounded operation remains asynchronous:
`replacePresentationText(input, { find, with, first|all|occurrence, allowEmpty,
select?, shape? }, context)`. One-based operation selectors are explicit
`position: { coordinateSystem: "one-based", value }`; model collection indexing
remains a separate zero-based contract. CLI flags map mechanically to the
existing SDK options. Returned bytes are `Uint8Array`; missing targets use the
neutral `SelectionError`/`missing-selection` category unless this explicit
non-token no-change policy applies. No native runtime, implicit network,
ambient host authority or XML identifier is added to routine editing.

The four upstream audit/inventory documents were read. Inventory properties
`TextFrame.text`, `_Paragraph.text` and `_Run.text` describe assignment semantics;
this preserving literal replacement policy is additive shared-contract behavior,
not an assertion of those setters' equivalence. Underscore-prefixed documented
types retain their public accounting. Historical inventory statuses do not
prove current implementation absence or completion; this receipt establishes
only the bounded selector correction, not whole-public-API or upstream-suite
parity. No publisher content, cloned binaries, or imported fixtures were needed.
