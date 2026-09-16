# Model discovery reconciliation

Task: adapt-upstream-tables-bdd only. Owned discovery tests expose document
section/picture editing and retain public underscore-cell reads without hiding
declarations. Unsupported save transport remains an explicit reject assertion.
The initial maintained focused run showed54 passes and3 stale assertions; the
updated three files now pass all57 tests. No product change was required.
Evidence/provenance: docs/docx/discovery-model-evidence-20260915.
Focused ESLint and Prettier checks pass. Root owns staging/commit; no push.
