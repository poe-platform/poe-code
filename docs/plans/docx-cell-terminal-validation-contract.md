# DOCX cell terminal paragraph validation

Atomic shared-domain validation correction within whole-api acceptance only.
Root owns clean `packages/docx/src/validation.ts`, new
`cell-terminal-validation-contract.test.ts` and this plan. Preserve other work.

## Agent QA procedure

1. Build original small empty-cell and nested-table-only-cell packages in memfs.
   Before code, both core-v1 reports incorrectly return valid true.
2. Validate each active cell's final block as a paragraph, ignoring metadata and
   annotation markers. Use the existing compatibility projection and work budget;
   dormant markup remains outside active semantic validation.
3. Report a located cell-terminal-paragraph structure diagnostic. The model
   transaction and SDK/CLI publication share this existing validator, so removal
   cannot discard the final required paragraph and then publish invalid structure.
4. Check positive terminal paragraphs, nested tables followed by paragraphs and
   trailing annotations, plus original model removal rollback. Run maintained
   DOCX tests/lint and independent review; no separate editor or new CLI route.
5. Commit only owned files/verified plan updates on main; later tasks stay pending.
   No README, ignored assets, native runtime, network, bypass, coauthors or push.

Independent review reduced valid terminal paragraphs in content-control,
custom-XML and insertion wrappers to three original tests. All three failed before
refinement. The validator now traverses admitted block wrappers in reverse logical
order over compatibility content, charging each visited node; metadata/annotations
and empty wrappers do not displace a terminal paragraph. A nested table remains
a table, so its internal cell paragraph cannot satisfy its containing cell.
This is bounded semantic validation, not a full schema or rendering claim.

Verification: maintained `npm test --workspace=docx` passed 222 files / 4,961
cases on the final product candidate. Maintained DOCX lint/TypeScript checks
passed with one unchanged operation-types warning. Independent review passed;
the 71-case cell/table-variant check and 29-case formatted owned check passed.
