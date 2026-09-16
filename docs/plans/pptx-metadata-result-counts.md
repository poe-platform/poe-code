# Metadata mutation result counts

The maintained PPTX suite exposed a result-schema mismatch: mutation envelopes
report positive affected counts while metadata schemas inherited const 0 from
read-only text inspection. Validate the field independently with original tests
for all six metadata mutation operation IDs. Accept nonnegative integer counts;
reject negative and fractional counts. Preserve read-only const 0.

## Agent QA

1. Observe failing schema validation for affected 1 before the fix.
2. Add the explicit mutation result property override, without changing existing
   metadata operation data definitions, command behavior or output presentation.
3. Run metadata-result-schema.test.ts and maintained package lint/unit checks.
4. Stage only this plan, the original test and the single owned schema override
   using a cached patch. Preserve unrelated working-tree metadata changes.
5. Commit locally with a Conventional Commit. No push or release.
