# Initial harness omission, preserved before correction

The first independent run (08:55:45–08:56:48 UTC, August 27, 2026) passed
12 scoped invariants, including the exact six-diagnostic delta, runner mutation
negative and all canonical inclusion controls. Its archive command included
`src`, `tests`, configs and package files but accidentally omitted `benchmarks`,
which genuine tracked tests import. Consequently its clean candidate had 24
harness-induced missing-module/implicit-any errors (30 with the parent config).
These are NOT product defects or legitimate candidate-global evidence. No
diagnostic is waived. The complete initial outputs, fixture freeze and original
harness are preserved in `attempt-01/`; its scratch tree remains untouched.

Correction: archive the immutable candidate's `benchmarks` as well; do not alter
product code, compiler options, test fixtures or any original producer data.
Use a fresh owned scratch tree and retain the original independent fixtures.
Also capture CLI noEmit before/after/negative commands alongside compiler API
diagnostic/file censuses, verify live automatic discovery is unaffected by the
hidden scratch tree, and bind rootdist hashes before/after. No benchmark runtime
or comparator suite is executed and no dependency is installed.

The initial live gate separately failed with ten actual foreign diagnostics,
not these 24 archive-induced errors. Its source/config/input bytes stayed equal
but foreign HEAD/index/status moved; retain that provenance qualifier.

The second attempt stopped correctly at the live-input stability assertion:
the foreign `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts`
changed during measurement (SHA-256 `d0e0fe79ab9b5f26cf8b50af995755dc05113af4c66c7f2bd8ed4e6d15554bdb`
to `67fbeed3ae12b1c2cc4ecdcc0e9060895f8ca1d5a466086cb1526922fa04e5b8`).
The second CLI run returned eight diagnostics, but this raced capture is not a
frozen matched-input proof. Those bytes belong to another worker, not this
configuration change. `attempt-02/` preserves only its actual outputs and inputs;
candidate controls were not reached. Do not wait for unowned changes: the final
attempt uses `--isolated-only`, with live gates retained as separate evidence.
Before/after source drift remains reported rather than attributed to this leaf.
