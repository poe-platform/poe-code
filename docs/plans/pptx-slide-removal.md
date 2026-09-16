# Slide removal and reverse references

Implement F07 deletion through the bounded byte SDK and shared command engine.
Root owns slide-removal.ts, its domain tests, errors.ts/index.ts, this plan and
removal research/usage. Delegated cli_remove owns command-engine.ts,
command-schema.ts, new command removal tests and scoped safe-bash acceptance.
Preserve all unrelated work. No whole pipeline, README changes, push or release.

Require explicit referencePolicy=remove for known affected memberships and links.
Reject unresolved/opaque references. Delete selected slides and exclusively owned
notes/comments only after reverse-reference analysis; retain shared resources,
masters, layouts and themes. Empty selection needs allowEmpty; missing selectors
are never permission to delete. Original memfs tests independently unzip and parse
output; no downloaded fixture dependency. Account for source variants and public
API obligations in supplemental research without claiming live-model parity.

## QA procedure

1. Run focused failing domain/command cases before implementation.
2. Run maintained pptx tests/lint/build closure and scoped safe-bash acceptance.
3. Verify hashes before reading manifest-listed cached QA inputs. Write only
   ignored, enumerated qa-slide-removal outputs. Inspect member retention and
   relationships independently; reduce meaningful failures to original cases.
4. Capture actual command help/results with the maintained screenshot runner;
   inspect resulting PNGs. This is structural/terminal QA, not rendering proof.
5. Review/stage explicit owned files and commit locally with Conventional Commits.

## Implementation and TDD receipt

Added the byte SDK removeSlides and command slides.remove with shared selectors,
explicit referencePolicy=remove, dry-run/publication envelopes, schema/help and
capabilities. Removed source locations remain source-fingerprinted. The root only
exports the package API; existing safe-bash adapter wiring is reused.

The first domain/command runs failed because removal was unavailable. Additional
red cases exposed ignored foreign elements/attributes, unresolved relative-action
targets, an opaque DrawingML extension wrapper inside the presentation extension
list, and an unknown action URI. Original regressions now cover all of these.
The extension check distinguishes actual extension wrappers from geometry a:ext.
Known section extensions use a bounded child/attribute grammar. Unknown wrappers,
foreign ignored markup, custom-show/history navigation and unresolved references
are conservatively rejected. No implicit repair, evaluation or target guessing.

Original domain tests independently unzip packages and parse XML with Saxes.
They cover first/last/nonconsecutive/all removal, exact remaining IDs, owned notes,
shared notes backlinks, retained themes/media/orphans, section/show memberships
and empty containers, named/relative/inert actions, stale/duplicate/missing
selectors, explicit no-op and opaque rejection. Tests use original in-memory
assets with memfs and no downloads. New command tests replace only zero-delay
scheduling with setImmediate, preserving actual domain/serialization behavior.

## Research and limits

The supplemental slide-removal-case-accounting.json retains exact canonical
parameter/BDD evidence for 52 unit cases and 72 BDD examples, and 51 relevant
public API records. Existing slide-order accounting remains the source for
collection/identity obligations. Removal is additive to the format contract:
the pinned public slide collection has no deletion method. Byte-operation evidence
is partial evidence for the wider action/collection model, not proof that live
getters/setters/enums/protocols are implemented. No underscore-prefixed or
inherited public members were reclassified as private. Exact JS mappings and
documentation drift are recorded; full public API parity remains incomplete.
The existing committed standalone slide-insertion-notice.txt retains the required
MIT research notice. All new product source and test assets are original.

The user's explicit policy requirement supersedes the spec's older implicit
membership-removal wording; the draft usage documents referencePolicy=remove.
Only slides and proven exclusively owned notes/comments are collected. Other
shared resources remain. Unknown extension families and custom-show action
resolution are deliberately unavailable; no general garbage-collection or full
OOXML conformance claim is made.

## Verification receipt

- npm test --workspace=pptx: 25 files, 789 tests passed.
- npm run lint --workspace=pptx: ESLint, source and test TypeScript passed.
- npm run build:workspaces -- --workspace=pptx: maintained selected closure passed.
- Existing safe-bash pptx create/selectors/inventory tests via node --import tsx
  --test: 56 passed. This includes actual shell in-place, binary pipeline,
  dry-run, independent retained-ID assertions and SDK-byte equality.
- Owned safe-bash test ESLint and git diff --check verified before staging.

## Disposable QA receipt

Verified exact manifest SHA-256 hashes for IXPE-Presentation-Template.pptx and
WWL-template-1slide.pptx. First/all deletion attempts with explicit remove policy
returned dangling-reference before publication because retained structures contain
unresolved extensions. Independent ZIP/XML inspection confirmed creation-ID
extension payloads. No output deck was written, no download occurred and no
fixture entered staging. These are documented conservative rejections, not
successful real-world edit or application-rendering claims.

Actual command help, a successful authored-deck dry-run and a missing-selector
error were captured and rendered with the maintained npm run screenshot route.
Both inspected PNGs are readable and unclipped. Ignored artifacts are exactly
.cache/pptx-corpus/qa-slide-removal-{help,result,error}.txt and
.cache/pptx-corpus/qa-slide-removal-{help,result}.png. They remain disposable.

## Local delivery

One atomic feature commit includes domain behavior, command parity, original
regressions, this plan and scoped research/usage. The local hash is reported in
chat and Git history. No push, remote-main verification or release was attempted.
Unrelated existing changes and untracked research/spec files remain untouched.
