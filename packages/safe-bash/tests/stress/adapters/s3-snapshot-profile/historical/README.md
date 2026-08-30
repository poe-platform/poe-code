# Immutable pre-migration seal

Root approved a fixture-only profile split. This commit precedes any fixture edits.

- `classification-report.md.data` is the exact surviving /tmp report.
- The prior /tmp archive/repro/raw logs had already been deleted. They are unavailable; no reconstructed historical raw is presented.
- `remote-safe-workflows.test.ts.data` preserves the exact unconditional fixture from frozen b494675c and the identical pre-edit working file. It is captured data, not a runnable canonical test.
- `manifest.json` authenticates the original repository raw failure, routing and evidence manifest by exact path/hash; those immutable artifacts remain unchanged.
- `author-start-inputs.json` records source/config/helper/fixture hashes and repository/index status before authoring; it is not runtime acceptance.

Historical 16520/307/13 remains RAW UNQUALIFIED. New replay evidence must be labeled fresh and stored separately. Do not modify or relabel this seal.
