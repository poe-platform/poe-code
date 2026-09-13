# Text-frame configuration

Implement only the text-frame configuration task, under the shared office CLI
and SDK contracts. Metadata-only autofit selects document layout policy; it does
not measure text, discover fonts, change font sizes or implement supplied-metrics
best fitting. No whole pipeline, README changes, push or release.

## Ownership

- Domain worker: `packages/pptx/src/text-frames.ts`, related domain/SDK tests,
  and public package exports.
- Command worker: frame command schemas, engine routes, command tests and
  scoped safe-bash adapter acceptance.
- Independent audit worker: original boundary assertions, frame case ledger,
  public API reconciliation and draft usage documentation.
- Coordinator: integration review, disposable corpus QA, maintained verification
  and atomic local commits with explicitly named owned paths.

## Verification procedure

1. Record failing original tests before implementation. Cover absence, explicit
   null/false/zero, margins, anchors, columns, wrapping, vertical text, signed
   rotation and exclusive autofit children. Independently inspect serialized XML
   and retained font, extension and layout metadata.
2. Reconcile every relevant pinned parameter variant and BDD example separately.
   Keep supplied-metrics fit cases assigned to their later tasks, with boundary
   semantics and host-font security mapping visible. Do not count them as passes.
3. Verify the public SDK and actual registered virtual-shell command produce
   equivalent bytes, errors, selectors, dry-run and publication behavior. Inspect
   schema/capabilities and terminal help/error screenshots.
4. Admit only a cached fixture listed in `docs/pptx/corpus-manifest.json`, after
   verifying its hash and length. Apply frame settings through both surfaces to
   memory copies. Compare text and every untouched ZIP member. No download or
   fixture becomes a unit-test dependency or shipped asset.
5. Reduce meaningful QA findings to original small regressions. Run selected
   workspace build, full maintained pptx test/lint routes and affected adapter
   tests. Commit each verified atomic improvement on main; report local hashes
   independently of delivery. No push or release is authorized.

## Evidence

The TDD phases covered missing routes/model, numeric lexical coercion, control
text escaping, bare empty paragraphs, canonical model inset defaults and signed
maximum values. Independent enum cases cover immutable symbols/metadata and
inherited conversion helpers. Metadata setter equality retains existing autofit
scale/spacing-reduction attributes and unrelated font/script metadata.

The frame research ledger retains 148 source rows and 34 public API records.
65 rows have passing original frame evidence; 73 font/metrics cases remain
assigned to supplied-metrics tasks and 10 live-content/owner cases remain visible
gaps. These denominators are separate from TypeScript test counts. No whole
public-model or text-fitting parity is claimed.

### Corpus receipt

The manifest-listed cached template was admitted at 1,202,514 bytes with SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
SDK and actual registered virtual-shell operations selected slide 2, shape
`Content Placeholder 2`; applied left/right/top/bottom margins -1/0/3/4pt,
middle anchor, two columns, wrap false, vertical mode vert270, rotation -90 and
text autofit. They produced equal 1,202,617-byte archives with SHA-256
`446f50b5b9fa8ee895bcaec132105d9b480a446c4a2a57456fe7574374a439ba`.
The complete text projection stayed equal. All 38 members remained present and
the 37 other than `/ppt/slides/slide2.xml` stayed byte-identical. Independent
XML checks verified the literal serialized inset/anchor/column/wrap/vertical/
rotation values. Clearing left margin, autofit and wrapping retained rotation
and the other settings. The input stayed unchanged; outputs stayed in memory.

The first QA invocation used an incorrect numeric SDK selector position; the
documented `{coordinateSystem:"one-based",value:2}` position fixed the recipe.
This was not a product change. No downloaded fixtures or QA driver are staged.

### Maintained checks

Initial integrated verification passed the selected workspace build closure,
all 65 pptx test files (1,760 cases), package ESLint/source/test TypeScript and
88 existing safe-bash adapter cases. Final review identified table-cell resource
isolation and valid unsupported anchor preservation; their new regressions and
final verification are recorded below. CLI screenshots were visually inspected;
see [the CLI receipt](pptx-text-frame-cli-qa.md). No rendered-slide or host-font
measurement claim follows from terminal screenshots.

Final review regressions passed before the final maintained run: shape-frame
resources exclude table-cell bodies and preserve their complete markup; valid
justified/distributed anchors stay readable and survive unrelated edits, while
unsupported enum access reports `unsupported-profile`. Read schemas admit those
tokens; write schemas reject them. Model/API gaps remain explicit in the ledger.

Final verification passed:

- `npm run build:workspaces -- --workspace=pptx` (selected declared closure).
- `npm run test --workspace=pptx`: 65 files, 1,765 passing tests.
- `npm run lint --workspace=pptx`: ESLint and both TypeScript configurations.
- Existing safe-bash pptx create/selectors/inventory suites: 88 passing cases,
  including the virtual script and binary pipeline; edited adapter test lint.
- Owned TypeScript/JSON Prettier checks, `git diff --check` and spec checker.
- Final built `pptx` public import plus registered Shell corpus re-verification:
  identical output hash above, retained text, 37 untouched members and clearing.
- Reviewed `/tmp/pptx-text-frame-reviewed-help-20260913.png`; only disposable
  terminal QA, not a tracked fixture.

The research ledger references the already tracked standalone MIT notice in
`docs/pptx/test-case-map-notice.txt`. Unrelated untracked research and the existing
pipeline-plan changes remain untouched. The configuration implementation,
command/API surfaces and their evidence form one atomic local feature commit.
No push or release.
