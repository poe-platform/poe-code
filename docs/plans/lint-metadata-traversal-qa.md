# Full-scale lint metadata traversal QA

The maintained posttest exercises configured metadata exhaustion and a mixed, nested namespace with 256 entries. Run this larger case manually when changing lint traversal, metadata admission, or directory decoding; it is too slow for a unit gate under concurrent builds.

1. Use the existing `model` fixture in `scripts/lint-eslint.fixtures.ts` with in-memory files only and observation mode `opens`.
2. Create a namespace beneath 19 nested directories, with 64 sibling groups of 256 files. Every sixteenth member is an `.mjs` file containing `export const value = 1;`; the remaining members have a `.data` extension.
3. Run `lintRoot` with that fixture's guard, configuration, and receipt binding.
4. Confirm completion, 1,029 linted subjects, 15,365 unconfigured subjects, fewer than the default 8,000,000 metadata operations, equal opens and closes, and no receipt-leaf payload reads.
5. Inspect the recorded diagnostics and unprocessed entries. Purge temporary logs and evidence in `/out` after inspection. Never raise the unit timeout to accommodate this case.

The full-scale case was executed while verifying issue 3578: it completed all assertions with 1,209,401 metadata operations, but exceeded the unit timeout under concurrent builds. Namespace mutation and alias rejection remain covered by the maintained adversarial tests; this scale check uses an immutable namespace.
