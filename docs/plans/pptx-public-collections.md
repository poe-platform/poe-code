# PPTX live collection protocol completion

Scope: existing TableRows, TableColumns, TableCells and GradientStops. Follow root AGENTS.md, shared Office SDK/CLI contracts, format specification and J03/J08 inventory mappings. No standalone document editor or host authority is introduced.

1. Read reconciled API/test audits and collection protocol inventory.
2. Establish original failing tests for missing table `at` and gradient numeric lookup.
3. Implement checked lookup, preserve type-specific negative bounds, and reject numeric membership replacement/deletion/definition.
4. Remove undocumented gradient slicing and complete inherited bounded `index` search.
5. Run maintained package lint and original focused table/shape tests. Record evidence in docs/pptx/public-collections-evidence.md.

Agent QA procedure: execute the focused tests listed in the evidence, inspect failed-before/pass-after output, and inspect the owned diff for ambient I/O, invented models and unrelated edits. CLI rendering is unchanged; no screenshot check applies to these object protocols.

State: implemented and verified within this bounded scope. Sparse placeholders and other missing live collection types remain a separate domain-model obligation. Parent agent owns staging and commits; no push or release is authorized.
