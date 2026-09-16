# PPTX public values integration

Implement the collections/values task on existing domain types. Root owns error
categories, Font.language_id, public exports, integration evidence and commits.
Workers own collection protocols, unit/color helpers and enum definitions as
recorded in their separate plans. No README edits, push, release or fixture cleanup.

Use the shared office SDK/CLI contracts and the pinned API/test inventories.
Reproduce each missing behavior before implementation. Keep numeric enum symbols
compatible with existing models; expose immutable metadata and checked conversion.
Language formatting must use the existing run-properties merge used by CLI edits.

## Agent QA procedure

1. Run original targeted tests to establish missing behavior.
2. Run the maintained pptx workspace unit and lint routes after integration.
3. Build the selected pptx workspace closure and check public imports.
4. Check each owned diff for incidental I/O, unrelated edits and source branding.
5. Commit atomic improvements with explicit paths and owned export hunks only.
6. Report hashes and remaining unsupported public surfaces separately.

## Progress

- Five domain error cases failed before their classes were introduced; all pass.
- Fifteen language-model tests failed before Font.language_id was introduced;
  all pass after extending the existing Font and run-properties merge.
- Maintained package tests: 5,903 passed across 201 files. Lint, both TypeScript
  checks and selected workspace build passed. Built public imports verified.
- Separate local commits prepared for enums, helper/color protocols, collections
  and live font language. Whole model graph remains incomplete; see evidence.
