# Handout inventory and stored print/view properties

Draft usage for the bounded operation SDK and command interface. This does not
promise printable page counts or a rendered handout layout.

Use `pptx inspect deck.pptx --json` for the ordered `handoutMasters` array of
canonical part URIs linked by the presentation's handout-master list. A detached
handout part can still appear in the general part inventory; it is not promoted
to a presentation handout master.

Use `pptx settings get deck.pptx --json` for `notesWidth` and `notesHeight` in EMUs,
and `printProperties`/`viewProperties`. Each property record is either null or
`{ part: string, xml: string }`. The XML contains stored markup, including unknown
settings; namespace declarations inherited from the source root may be added to
make the returned fragment self-contained. This is not a semantic print-layout
model or a serialization of renderer output.

The package SDK exposes the same fields through `readPresentationSettings(input,
context)`. `readSelectionIndex(input, context)` exposes the handout part inventory.
Input is admitted bytes or an explicit capability; reads do not create absent
notes, handout, print or view structures.

Ordinary slide text operations exclude shared handout text. Supported handout
master text replacement requires explicit `--scope handout-master` with the
common `text replace` operation and explicit first/all selection. Unsupported
placeholder/layout settings remain preserved; explicit text scope does not grant
permission to regenerate the handout layout.

Use the existing `settings set` operation with `--notes-width`/`--notes-height` or
`--notes-orientation` to edit the notes canvas. These fields do not change the
number of printed pages. Read-only print/view inventory does not offer arbitrary
property setters. Common publication, dry-run and error contracts still apply.
