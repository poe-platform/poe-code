# Sections and page settings

This bounded milestone adds utility `sections list/add/set`. It does not complete
the live Section/Sections model, advanced section-column batches, header/footer
content editing, pagination or rendering. Exact mappings and test/check evidence
are recorded in the [owned plan](../plans/docx-sections-page-settings.md).

Section ownership follows document order: a paragraph's section properties end
that section, and the final body's section properties own the final section.
Edits retain both forms and leave unselected section properties intact. Adding a
section preserves preceding content and geometry and keeps a final body section.
Orientation alone never swaps width and height; supply dimensions explicitly.

Geometry, margins/gutter, header/footer distances, columns, start type,
page-number metadata and display policy are structural metadata. Missing direct
geometry is not fabricated from the previous section. Continuous-break page
inheritance is layout-sensitive and does not establish measured page boundaries.

Default, first and even header/footer bindings are inspected separately. Absent
bindings inherit recursively from the previous section; initial absence remains
empty without allocating parts. A local first-page display flag does not change
following section flags or remove story definitions. Even/odd policy is
document-global and requires explicit `all:true` / `--all`; a local selection
cannot silently change it. Binding content editing remains pending.

Utility option names use camelCase in SDK input and kebab-case flags in the CLI.
Unknown fields and malformed tokens fail before acquisition; stale tokens fail against admitted input. Shared selection, stale-token,
dry-run, JSON, publication and exit-status rules continue to apply. Safe-bash
calls the same engine; there is no host filesystem or network fallback.

Lengths in `items[].direct` are integer twips (`units: "twip"`). Missing dimensions
and margins remain null. `equalWidth` distinguishes custom column definitions;
their count is read from the child definitions and their common gap is null.
Custom unequal columns are preserved; a geometry or gap edit requires an explicit
column count to convert them to equal columns. Unresolved continuous-section
page dependencies reject isolated geometry edits. Existing document-level
`gutterAtTop` determines the axis used to validate content extent.
