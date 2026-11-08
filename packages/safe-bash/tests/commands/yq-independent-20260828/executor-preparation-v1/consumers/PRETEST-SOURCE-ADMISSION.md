# Source-Only Admission Clarification

Written after the first 36/36 synthetic run and before the second run. The initial `PRETEST-SEAL.json` and first evidence directory remain immutable. No product policy changes or execution occurred.

`authorizeSources` also accepts the exact five-key source-only receipt: `schema`, `sourceBase`, `acceptedLength`, `candidateCommit`, `sourceAdditions`. It authenticates that immutable source before a future root-owned build, without requiring output hashes or a future build-receipt hash that cannot yet be known. Its result has `expected: null` and cannot be used for materialization/import. This removes a circular pre-build prerequisite from the first harness draft.

After the separately authorized build, the root routes a newly hashed full candidate receipt using the original full schema. `authorizeCandidate` reauthenticates its source, build receipt and complete output map before allowing a copied/moved import capability. No partial/full receipt is inferred from live HEAD, and missing full-candidate output fields remain a refusal.

The valid fake-tree control now also checks a three-baseline-file plus four-authorized-output composition, retaining the exact fake README and permitting an explicitly enumerated uncompiled module README. Counts are relative to the supplied baseline, not 846. The synthetic job denominator remains the original 36; this is additional guard coverage, not additional semantic cases. Import-hook registration cleanup now covers registration failure as well as callback failure. Receipt ancestry is checked for symlinks.
