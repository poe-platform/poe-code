# Text, style and document adaptation

Status: in progress. Only `adapt-upstream-text-style-document` is authorized;
all later pipeline tasks remain pending. No push or release.

## Ownership and baseline

Root owns `packages/docx/src/highlight-xml-contract.test.ts`, the highlight
mapping in `packages/docx/src/run-properties.ts`, its matching getter in
`packages/docx/src/formatting-model.ts`, the corrected exact expectation in
`packages/docx/src/run-properties.test.ts`, this plan, and the additive evidence
`docs/docx/text-style-document-adaptation.json`. Main was confirmed, with an
empty index. Preserve all pre-existing working-tree changes, including the
pipeline plan, specification, API audit, packing/extraction and discovery work.
No README changes, external assets, disk fixtures or reference runtime.

Read the root instructions and DOCX, shared CLI and shared SDK specifications;
parse both DOCX inventories and the existing per-case research map. Read the
DOCX test/API audits, API reconciliation and crosslinked counterpart test audit.
No package-scoped AGENTS.md exists in packages/docx. Substantive safe-bash work
would require delegated leaf implementation and independent review under its
scoped instructions; this serializer correction requires no adapter change.

The existing map assigns source cases to earlier feature owners, with no rows
assigned directly to this residual adaptation task. Earlier utility evidence
must not be promoted to live Document/Paragraph/Run/Section/story/hyperlink/
page-break/Comment/Settings conformance. The residual task remains open until
all of these public owners, inherited members, collections, enums and helpers
have applicable original passing evidence. Underscore-prefixed public owners
remain in scope. The pinned inventories retain research statuses.

## First atomic improvement: highlight XML

The typed enum declares `WD_COLOR_INDEX.AUTO` as XML `default`, and the mapped
font AUTO setter case requires that exact value. The common serializer instead
emitted `none`; its matching model getter translated `default` to that invalid
serializer value. Original tests first reproduced three failures: live Font
and both document dialects. Sixteen other highlight members passed.

Correct AUTO to `default` and match model reads directly against the declared
XML names. Keep null as deletion/inheritance. Test all 17 representable members
with exact expanded-name/attribute assertions, retain explicit-false bold and
Unicode text, and verify null removes only the highlight. Test selected document
operation publication in both dialects, preserving RTL false and source bytes.
Product tests use original wording and memfs, not copied private mocks.

Model `highlight_color` retains its neutral spelling and typed enum/null union;
operation `highlight` remains the shared camelCase options surface on `runs.set`.
No bare numeric/coerced enum values or spelling aliases are introduced. Invalid
XML highlight values still fail the model read; unrelated retained markup is
not rewritten. The existing SDK-backed command uses the corrected serializer.

## Agent QA procedure

1. Run the focused original test file before code changes; retain exact red
   failures in the additive evidence, then rerun with the formatting boundaries.
2. Run maintained `npm test --workspace=docx`,
   `npm run lint --workspace=docx`, and the explicit selected closure
   `npm run build:workspaces -- --workspace=docx`.
3. Inspect exact output XML in both dialects, check unrelated properties/text
   and source-byte retention in memfs. No renderer or visual CLI claim follows
   from these structural checks.
4. Check owned diffs and whitespace, explicitly stage only the six owned
   paths, and make one atomic Conventional Commit on main.
5. Continue residual family adaptation; do not change later task states or
   claim full model/API/format coverage from this correction.

## Verified highlight receipt

- Original red: 3 failed and 16 passed before product changes.
- Focused green: 55 passed in 2 files.
- Final maintained DOCX suite: 3,245 passed in 162 files, no skips, 143.71s.
- Maintained lint: ESLint and both TypeScript checks passed; one warning in
  unchanged operation-types.test.ts.
- Selected maintained build closure: all 5 tasks passed.
- Built SDK-backed command: AUTO publication emitted exact default XML; dry-run
  exited 0. Inspected the maintained result screenshot in
  /tmp/docx-highlight-qa/result.png, with readable unclipped output. Screenshot
  preparation built 76/76 uncached tasks and the root bundle successfully.
- Exact XML and source retention are structural evidence. No document renderer,
  downloaded corpus, whole-model parity or complete residual adaptation pass
  is claimed. This task stays in progress and later tasks remain pending.
