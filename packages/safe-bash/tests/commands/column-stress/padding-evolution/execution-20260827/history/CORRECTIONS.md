# Harness history, not product failures

1. Before the first product execution, `audit.mjs` rejected the committed fixture
   symlink `tests/commands/filesystem-inspection-stress/tree/evidence/final-436bda3/harness/derived/native-fixtures/cycle/inner/back`
   with `AssertionError [ERR_ASSERTION]: No source/module alias: ...`.
   The initial helper is retained here. The correction allows only authenticated
   Git-tracked test fixture links without following them. Product source remains
   regular files; installed locked dev-package links are separately authenticated.
   No fixture was removed, materialized, ignored or edited. The actual Git archive
   remains unchanged, and the corrected full audit passed before the build.

2. After all runtime checks, `finish-audit.mjs` initially required the newer
   `groupAliveAfterRetirement` field in the earlier build capture and failed with
   `AssertionError [ERR_ASSERTION]: /tmp/safe-bash-column-padding-MmS9An/build.json`
   (`actual: undefined`, `expected: false`). Its initial source is retained here.
   That build used the first runner revision, which recorded `groupAliveAtClose:
   false` but not the later field. The correction accepts this exact build record
   only, checks its recorded close observation, and still probes the process group
   retrospectively. The original build capture is unchanged. Every later child
   retains the stricter post-retirement observation. No product outcome changes.

These descriptions transcribe tool diagnostics, not invented raw child captures.
All candidate, negative-control, author, historical and packed result records are
preserved exactly as emitted. No candidate-dependent expectation was corrected.
