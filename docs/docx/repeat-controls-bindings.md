# Bounded repeat and binding utility

Task 64 is verified locally through original TypeScript tests and independent review.
This draft describes the sole [format contract](../specs/docx.md), not published
availability, model parity or downloaded-corpus qualification. The procedure and
owned paths are in [the task plan](../plans/docx-repeat-controls-bindings.md).

```bash
docx controls list form.docx --json
docx controls repeat form.docx --control 1 --data-json '[{"values":[{"binding":"name","value":"Harbor"}]}]' --output repeated.docx
docx controls repeat form.docx --control 1 --data-file records.json --dry-run --json
docx controls bind form.docx --all --binding name --value-json '"Harbor"' --output synchronized.docx
```

Repeat accepts exactly one explicit array source; each record has a values array
with exactly the prototype's declared scalar keys. Native row/block regions use
one admitted structural prototype. Empty data retains a reusable cleared native
placeholder with required row/cell/paragraph structure. Count uses the maintained
matches ceiling plus table, node, work, media and output budgets. Nested repeats,
merge fragments, locks, bindings in repeats and affected unsupported structures
reject. All prior items require admission before replacement.

Bind uses an exact logical control tag and an explicit string, boolean or admitted
numeric scalar. It synchronizes the singleton custom-XML leaf and every recipient
alias within explicit selection/scope. Incomplete selection rejects; all-stories
must be explicitly requested to include other stories. Unsupported same-store
selectors reject when target isolation cannot be established. Binding declarations
remain attached. The selector subset is root-inclusive absolute child QName steps
with explicit stored namespace declarations, singleton resolution and scalar text
leaves. Predicates, axes, wildcards, attributes and arbitrary XPath are unsupported.

The public utility functions are editDocumentControlRepeats and
editDocumentControlBindings, with operation arguments and PublicationContext.
Inputs are admitted bytes; publication uses explicit capabilities, cancellation,
limits and destination rules. Commands obtain input and records only through their
injected VFS/stdin. No ambient host files, native runtime or implicit network is
introduced. No environment variables are exposed by these operations.

Pinned inventories assign no upstream test/API rows specifically to this additive
F29 utility task. Original fixtures and tests qualify only the admitted utility
subset; whole model/API, corpus and independent Word rendering remain pending.
The current repeat picture profile is limited to validated internal inline PNG
pictures with the admitted rectangular DrawingML structure. Shared media retains
its original bytes; unsupported picture formats, floating/vector/effect structures
and external picture links reject when affected. This is separate from future
general image editors and does not claim image-format parity.

Final maintained uncached DOCX unit passed 88 files/2,084 tests. Maintained lint
includes source and test TypeScript checks; the selected DOCX workspace build
closure passed. Portable export and existing engine checks passed 11 tests.
All 10 independently enumerated DOCX Shell test files passed 62 tests with zero
skips/failures through the maintained reporting runner. This is scoped runtime
qualification, not a full virtual-bash workspace gate. Exact integration-input
registration separately passed 515 runner tests; historical seals remain intact.

Independent current-source review approved the bounded utility and explicit
plugin. Renewed clone/repeat tests passed 28; earlier domain and binding/XML
cohorts passed 257 and 71 respectively, retained as separate candidate evidence.
The final full unit suite qualifies the combined corrected revision. Actual root,
repeat and bind help/list, VFS sh filling, dry-run, binary pipelines and failures
were captured; reviewer and root inspected both terminal PNGs for wrapping,
clipping and overlap. This is terminal evidence, not Word rendering.

Original reds exposed unsafe prior-item fields/graphs, crossing bookmarks and
outside-story anchors, opaque Word/comment attributes, incomplete drawing/media,
late traversal reservations and false identity census of arbitrary custom XML.
Corrections independently admit every prior item and comment body, validate
pictures before copies, remap identities/owner-local relationships, preserve
shared media and restrict story census to declared Word parts and owner chains.
Binding original reds additionally qualify same-store unresolved alias refusal,
different-store isolation, enclosing revisions, namespace/type/singleton rules,
false/zero/empty values, scalar CDATA delimiter replacement and resource-error
propagation. Scalar replacement reserves capacity before escaping/copying.

Research inventories and downloaded QA files remain unchanged. Preparation,
reference passes and these utility tests do not promote live model/API rows,
ordered batches, template apply, corpus or full conformance. No README edits,
cache cleanup, push or release occurred.

Local feature commit: `2996c149608eb452762c9cf687665c663f4cd65e`. No remote delivery or release is claimed.
