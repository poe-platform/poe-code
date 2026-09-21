# Seeded selected dummy text: current verification

Scope: `deterministic-dummy-text` only. No later task is executed by this record.

The implementation already exists in local ancestor commit
`e52cdfd43a38b3bad7dda2a744944e325192a528`. Its original failing-test evidence
and policy record remain accessible in Git at
`e52cdfd43:docs/plans/docx-deterministic-dummy-text.md`; the later cleanup commit
`314ba0299` removed that document. This record does not recreate removed history
or claim a new code implementation. The task register's open status is stale.

## Contract and exact mappings

`lorem set` and always-async `setDocumentDummyText(bytes, options, context)` use
the same domain editor and explicit byte/VFS publication capabilities. Required
`seed` is a JavaScript safe integer mapped modulo 2^32. Per selected paragraph,
word i indexes `amber birch cedar delta elm fern grove heath` at `(seed + i) % 8`.
The sequence restarts per paragraph. `words`, when supplied, is positive;
otherwise maximal nonempty ECMAScript-whitespace-delimited logical spans set
the count. A computed zero preserves the paragraph, including empty stories.

Generated words are space-joined. Existing selected text-leaf UTF-16 lengths
determine distribution, with the remainder in the final leaf. Tabs, breaks,
hyphen controls, run properties, field instructions, relationships and nontext
data survive; checked Unicode scalar ranges preserve neighboring text. Logical
final-view extraction governs eligibility, including directly hidden-format runs:
this utility does not resolve style inheritance or render visibility. Explicit
counts can fill an admitted empty whole paragraph. Unsafe affected structures
reject before publication. No clock, random source, network or generator is used.

This is **not anonymization**: metadata, images, cached nonselected content,
instructions and unselected text remain stored.

CLI ordinals are one-based; token ranges are half-open Unicode scalar offsets.
Utility options retain camelCase SDK/JSON names, common publication flags,
version-1 results and statuses 2/1/3/4/130 for usage/selection or unsupported
edit/publication/limits/cancellation. Schema, help and F45 capabilities expose
the operation. No ambient host authority is introduced.

The pinned API inventory has no dedicated dummy-text model member: F45 is
additive utility behavior. Neutral model spellings, destructive text setters,
inherited members, returned package/XML owners, enums, collections, helpers and
public underscore-prefixed types keep their independently recorded obligations.
No historical inventory row or whole-model coverage is promoted by this task.
Existing documentation-error mappings remain unchanged. Current runtime schema
is authoritative for actual utility support; historical batch-pending statements
are not a claim about later independently implemented batches.

## Current checks

- `npm run lint --workspace=docx`: passed ESLint and both TypeScript projects;
  one existing type-only unused-variable warning, no errors.
- Original public Shell regressions:
  `node --import tsx --test packages/safe-bash/tests/commands/docx/dummy-text.test.ts`:
  2 passed, covering binary repeats, pipes, script files, JSON/statuses and
  unchanged virtual files.
- `npm test --workspace=docx`: 247 files and 5,160 tests passed, including
  all 10 original dummy-text regressions.
- Optional `npm run test:schemas --workspace=docx`: unavailable because the
  explicit pinned `DOCX_SCHEMA_ROOT` prerequisite is absent; 10 cases did not
  execute. This is not a schema-conformance pass. No downloads or native builds
  are performed to manufacture that prerequisite.

No product edits require new red/green tests: existing original regressions cover
repeatability, non-Latin text, selections, empty stories, limits and retained
metadata/image bytes. No new screenshots are required for documentation-only
changes. Delivery is a local documentation commit only; no push or release.
