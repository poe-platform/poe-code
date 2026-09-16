# Internal XML compatibility view

The internal `interpretCompatibility(part, understoodNamespaces)` function in
`packages/pptx/src/compatibility.ts` interprets an admitted immutable XML part.
It is not a public package export, presentation factory or CLI operation.
The namespace list is explicit, copied on entry, and matches namespace URIs,
not prefix spellings. No environment variables, host I/O, network or native
runtime are used. The existing byte/node/depth limits apply during XML admission
and re-admission after merges.

The optional third argument lists opaque element names. A fourth trusted
TypeScript predicate, `expandOpaque(element)`, can opt selected opaque containers
back into traversal while retaining their inherited compatibility rules. Text
extraction uses this for table graphic data; unrelated graphic data and extension
payloads remain opaque. The predicate is retained across `merge` re-admission.
It is package implementation configuration, not a serialized command option or
an expression evaluated from document content.

`dialect` reports `strict`, `transitional`, or `null` from the original root's
PresentationML/DrawingML main namespace. It does not infer a whole-package
dialect from filenames or convert namespaces. Other part roots are neutral.

`children(element)` and `attributes(element)` return frozen inspection arrays
for processed elements. Ignored elements and MCE wrapper elements remain in
`part.root`, but do not become ordinary processed handles. These are element
and attribute views, not a text-extraction API or a live owned model graph.
`alternatives` records encountered AlternateContent elements and the selected
Choice/Fallback (or null). Unselected and unknown branches stay byte-exact in
the underlying part, including nested branches not traversed by the view.

Selection uses the first Choice whose entire Requires list resolves to understood
URIs, then Fallback, then no effective content if both are unavailable. Ignorable
and ProcessContent rules inherit resolved URIs/name pairs across prefix rebinding;
ProcessContent supports both local names and namespace wildcards. Understood
ignorable namespaces are processed normally. Required support is checked on
processed content, not discarded subtrees or unselected alternatives. Malformed
branch controls and unknown MCE controls fail. Unknown nonignorable namespaces
fail this conservative admission profile rather than claiming semantic support.
Legacy PreserveElements/PreserveAttributes declarations are syntax-checked and
retained; preservation does not depend on their presence.

`merge(element, update)` uses the same bounded structured XML merger, then checks
that every outermost AlternateContent subtree is lexically identical and appears
in the same order. Any addition, removal or change to an alternate representation
fails with `unsupported-edit`, including changing the selected fallback alone.
This deliberately rejects synchronized branch edits too until a model-level
operation can prove consistency. Direct edits to ignored handles also fail.
No-op and unrelated ordinary attribute edits retain all representations and the
original encoding. Failure leaves the original immutable part unchanged.

The internal codec additionally exposes `resolveNamespace(element, prefix)` and
`markup(element)` for owned snapshot elements; foreign/stale elements fail.
They expose bounded XML metadata/text only, with no external resolver or evaluator.
The raw codec remains a lower-level primitive; it does not itself enforce the
compatibility view's edit policy. Future model operations must use the validated
view and package-level relationship/publication checks.

This is partial F03/F04 infrastructure. It is not schema validation, full MCE
conformance, extension semantic support, whole-deck validation, SDK/CLI parity,
public J09 view completion or visual-fidelity evidence. Model-specific synchronized
alternate edits remain future work. The complete public API and BDD obligations
remain open.

Research used the pinned ECMA-376 Part 3 fifth-edition text, sections 7.1–7.7
and 9.2–9.4, recorded by `standards-sources.json`. The official
[standard archive](https://ecma-international.org/wp-content/uploads/ECMA-376-3_5th_edition_december_2015.zip)
defines compatibility syntax and processing; the
[vendor introduction](https://learn.microsoft.com/en-us/office/open-xml/general/introduction-to-markup-compatibility)
also explains why destructive preprocessing can change saved content. This
implementation keeps the raw XML separate from the effective inspection view.

Validation and disposable QA procedures/results are in
[the implementation plan](../plans/pptx-markup-compatibility.md). No source
implementation, reference test wording or downloaded asset was copied.
