# Paragraph public surface

Extend the existing Paragraph model with live owner bindings, runs, text mutation,
clear and font access. Reuse XML merge and text-run formatting domain primitives.
Write original in-memory tests first; no downloaded fixtures or host I/O.
Check paragraph properties survive clear, run handles survive non-destructive
format changes and become invalid after destructive replacement. Record language
mappings and remaining public gaps in docs/pptx/paragraph-public-surface.md.

Completed: live Paragraph/Run and font formatting, existing FillFormat reuse and
ColorFormat binding, destructive generations and transactional bound failures.
Ten original public tests pass; focused established formatting/frame tests pass.
Remaining owner relationship and language enum mappings are recorded as gaps in
docs/pptx/paragraph-public-surface.md. No commits or pushes from this delegated task.
