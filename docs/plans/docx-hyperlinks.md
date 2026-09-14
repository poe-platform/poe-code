# DOCX hyperlinks

Status: bounded implementation complete and verified locally.
Scope: this task only, on main, with a local owned commit and no push or release.
Later pipeline tasks and the unrelated changes to docx-typescript-safe-bash.md
remain untouched. No downloaded fixtures, native reference build or product
network/ambient filesystem authority are introduced.

## Implemented behavior

`editDocumentLinks(bytes, request, context)` implements `links.add`, `links.set`
and `links.remove`; `inspectDocumentLinks(bytes, options, context)` implements
`links.list`. Product behavior lives in packages/docx. The existing optional
safe-bash adapter supplies capabilities and streams to the same command/SDK
engine. Root only retains its existing export wiring.

Add appends explicit text to a selected paragraph, preserving existing runs.
Set changes only the selected link destination, retaining mixed styled label
runs and history. Target changes clear the old separate anchor/document location.
Internal destinations use `bookmark` string names; external targets use `target`.
Exactly one is required. There is no hidden first paragraph selection or implicit
bookmark creation. Body, header/footer and table-cell ownership use the existing
revision-bound location resolver. A link ordinal is one-based within its owner.
The bounded editor requires direct paragraph hyperlinks; ranges, controlled or
tracked wrappers and ambiguous shared header/footer edits reject.

Removal defaults to unwrapping visible label content, with its run properties,
comments, order and necessary namespace bindings intact. `deleteContent: true`
(`--delete-content`) explicitly deletes the hyperlink and all its content. False
or omission unwraps. The paragraph itself remains. Removal results identify the
surviving paragraph; add/set results identify the link. Ordinary mutations require
one explicit resource or `--all` in scope. Stale tokens reject before publication.

External destinations allow absolute HTTP, HTTPS and mailto only. Reject raw
controls/whitespace/backslashes, malformed percent escapes, missing HTTP authority,
credentials, empty mailto paths and other schemes. Preserve admitted target bytes,
including escaped characters, case and target fragments. Internal anchor names
are 1–40 ASCII letters/digits/underscore, beginning with a letter or underscore.
The underscore permits conventional hidden anchors. No target is fetched, opened,
executed, resolved against the host filesystem or sent as mail. Existing unsafe
addresses can be inspected or unwrapped as inert stored data, but cannot be newly
authored by these operations.

Inherited xml:space/xml:lang on a removed wrapper are propagated to label children
without overriding their explicit values. Retargeting also clears a separate
document location when the address itself is unchanged.

Relationships are allocated/reused only in the owning XML part's .rels file and
in its original Strict/Transitional relationship dialect. Editing one shared
relationship creates or reuses a separate matching destination, retaining the
old relationship while another reference needs it. Cleanup visits all stored XML
references in that owner, including inactive compatibility branches, and removes
only retired IDs with no references left. Other owners, relationships, opaque
content and external resources remain unchanged. Namespace declarations on a
removed wrapper are carried to its children only when needed.

## Exact JS/security mappings and documentation reconciliation

The existing upstream-api-audit.md, upstream-api-inventory.json and shared
office-cli.md/office-sdk.md were reviewed. Their historical evidence and complete
public obligations remain visible; utility tests do not promote live model rows.

| Surface | Mapping and current disposition |
| --- | --- |
| Utility input/publication | Owned Uint8Array; always-async Promise<LinkEditData> or Promise<LinkListData>; explicit limits, cancellation and injected file/stream authority; existing version-1 envelopes, JSON and exit codes. No environment settings or new runtime dependencies. |
| Hyperlink constructor | Owner-bound `(element, parent)` live view remains planned; no no-argument factory or copied XML-library object interface is introduced. |
| Hyperlink.address / fragment / url | Proposed synchronous readonly strings retain neutral spelling. Utility inventory implements the values: address is unchanged relationship target or empty string, fragment is the separate anchor or empty string, url is empty for internal-only links and otherwise address plus `#fragment` when present. An embedded address fragment is not removed or combined with the separate anchor. No read follows a target. Live getters remain planned. |
| Hyperlink.text / contains_page_break | Proposed synchronous readonly string/boolean. Utility inventory reads label run text, tabs and line breaks; stored rendered breaks set contains_page_break without adding a newline. These values do not measure/recompute layout. Whole live getter coverage remains planned. |
| Hyperlink.runs | Retain `readonly runs: ReadonlyArray<Run>` with zero-based JS indexing, length and Symbol.iterator; live Run objects and this property remain planned. The editor preserves stored run order/properties; it does not claim live wrapper identity or collection implementation. |
| Hyperlink.part (inherited) | Retain its public neutral name and inherited coverage. Map to a bounded owner-relative XmlPartView, never ambient filesystem/network authority. The inventory's security-mapped disposition remains; link utility locations identify part ownership without claiming this live getter. |
| Paragraph.hyperlinks / iter_inner_content | Retain readonly ordered hyperlink sequences and `IterableIterator<Run | Hyperlink>` in the live model; both remain planned. Utility listing adds a real link location kind without replacing paragraph traversal or hiding missing live APIs. |
| History metadata | Preserve the stored flag during edits; utility inventory maps omission to true and XML false tokens to false. This is XML metadata, not browser history or a new public-model alias. |
| Values/errors | Primitive strings/booleans without coercion; absent destination values reject, null is not a target. Invalid arguments/ranges use existing usage errors (exit 2), stale/missing/ambiguous selection or unsupported edits exit 1, publication failures exit 3, limits exit 4 and cancellation exit 130. Paths and bytes use explicit capabilities. |
| Grammar drift | `bookmark` on links.add/set is destination data, not a sibling numeric selector. Correct both direct selection validation and the declared batch argument schema/type, which previously incorrectly required a positive integer. Other resources' numeric bookmark selectors stay unchanged. |
| Removal contract gap | The previous links.remove row had no explicit deletion policy. Document default unwrapping and optional deleteContent in spec, typed input, help and result schema. |
| Discovery drift | Advertise only this bounded links list/add/set/remove subset as read/edit, with F21 limitations. Reject inapplicable selectors rather than accepting and ignoring them. Preserve existing exact discovery inventories and add the four paths/F21 explicitly. |
| Batch/live model | Link operation batch argument schemas are reconciled, but the current batch executor still implements only its existing style model subset. Link batch execution and all listed live Hyperlink/Paragraph APIs remain pending. Public underscore-prefixed types, inherited members, enums, helpers and collections elsewhere remain in the full register and are not reclassified as private. |

No reference-project names/assets or derived implementation were added to product
source, tests, fixtures, identifiers or output. The new regressions use original
coastal labels and in-memory OOXML. No additional legal notice is required for
this independently authored implementation.

## Test-first evidence and QA procedure

1. Before implementation, the first 17 tests produced 13 failures: missing editor
   exports plus malformed URL acceptance. The four already rejected scheme cases
   were preserved as passing boundary coverage, not reported as new failures.
2. A further failing internal-to-external case exposed absent relationship access;
   the implementation now handles internal links without dereferencing an edge.
3. Initial CLI tests failed because the operation was unsupported and discovery
   did not advertise it. Subsequent red cases exposed ignored selectors and the
   batch bookmark integer drift before each corresponding fix.
   Final review added two further red regressions for wrapper-inherited XML
   whitespace/language and same-address document-location clearing before fixes.
4. Additional original regressions cover both dialects, owned headers, nested
   table cells, mixed styles, shared relationships, fragment separation, namespace
   unwrapping, cached breaks, no-op preservation, inactive XML branches, stored
   unsafe links, missing/stale selection, shared headers, limits and wrappers.
   Every unit fixture mutation uses memfs; no test depends on downloads.
5. Supplemental actual Shell tests extend the existing registered tables.test.ts
   memfs publication fixture. Exercise output/in-place/dry-run, listing/retargeting,
   explicit content deletion versus unwrap, rejected forced publication preserving
   destination bytes and throwing fetch spies across the link lifecycle. These
   workflow tests supplement the pre-code failures; they were not authored red.
6. Execute the actual command engine for links.remove help, successful add dry-run,
   rejected javascript target and missing link selection. Render its terminal
   output using the maintained terminal-png renderer and inspect both images:
   `/tmp/docx-hyperlinks-help.png` and `/tmp/docx-hyperlinks-workflow.png`. Both
   inspected: clear applicable options, explicit removal behavior, exit 0/2/1,
   no clipped diagnostics. These disposable images are not staged. The optional
   docx command is not a root poe-code route; no root CLI route is added for QA.
7. Run maintained DOCX tests/lint and selected workspace build closure; portable
   export checks; existing safe-bash DOCX tests and exact active-test inventory
   gate. Commit explicit owned files only after checks pass; do not push.

Two newly authored error expectations were corrected to the existing shared
contract: missing resource selection and a range supplied to a whole-resource
operation are usage errors, not ambiguous-selection/invalid-value codes. Original
tests and product error categories were not weakened. The first full package
run also exposed three expected additive discovery-inventory updates, retained
as failures before their explicit expectation updates.

## Verification

Verified on 2026-09-14 against the owned working tree:

- `npm test --workspace=docx`: 64 files, 1,671 passing tests, including 36 original
  link/CLI regressions. Final run includes both review fixes.
- `npm run lint --workspace=docx`: ESLint, source TypeScript and test TypeScript
  all passed after the final changes.
- `npm run build:workspaces -- --workspace=docx`: maintained five-workspace
  dependency closure and native postbuild checks passed after the final changes.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  40 tests passed. The extended tables.test.ts was repeated after the final
  preservation fixes: all 13 passed, including three new Shell workflows.
- `npx vitest run scripts/docx-exports.test.ts`: two portable export/dependency
  closure checks passed (run with the discovery and CLI cases, 15 total).
- The maintained integration-inputs.test.mjs case named
  `default normal runner passes every discovered active file` passed. The extended
  Shell file retains its exact existing active-test registration.
- `git diff --check` passed. Both disposable terminal screenshots were inspected;
  no QA assets, test downloads or unrelated plan changes are staged.

Later tasks remain pending; no whole-public-API, full-root suite, remote-main
delivery or release claim is made by this milestone.

## Independent task verification, 2026-09-14

Reviewed implementation commit `25cb8fae4`, the original tests, shared CLI/SDK
contracts, and the hyperlink/inherited-member API inventory. The earlier
test-first account above remains historical evidence; separate raw logs for
those implementation failures were not available in this verification. The two
saved terminal screenshots were available and inspected directly. No native
reference runtime or downloaded document was used.

One new defect was reproduced before correction: target validation rejected
ASCII whitespace/controls but admitted raw U+00A0, U+2028, U+0085 and U+009F.
Four original memfs SDK regressions actually published these targets instead of
returning usage errors. Two added variants of the original CLI error case
attempted input reads and returned exit 3 instead of exit 2. The shared validator
now rejects ECMAScript whitespace and the complete C0/DEL/C1 control ranges.
Ordinary Unicode path text and percent-encoded targets retain their exact bytes.
This enforces the existing documented contract without adding schemes or I/O.

Fresh red evidence is `/tmp/docx-link-unicode-red-confirmed.log` (four failures)
and `/tmp/docx-link-unicode-cli-red.log` (two failures, original case passing).
The first SDK red capture hit a test-result pretty-printer getter; the confirmed
capture projects the result to `published` or the error code and proves the
publication defect directly. The initial package run overlapped addition of
these tests: 1,671 passed and only the six new regressions failed. It is not
reported as a clean frozen baseline. Focused green evidence is
`/tmp/docx-link-unicode-green.log` (42 tests), before the supplemental encoded
target preservation case. All earlier evidence remains intact.

Manual QA executes the actual command engine with explicit limits and rejecting
input capability for both Unicode rejection cases, captures diagnostics and
exit/read counts, and renders them through the maintained terminal-png renderer.
The inspected `/tmp/docx-link-unicode-verification.png` shows the complete
diagnostic, exit 2 and zero input reads for both. An initial QA invocation omitted
the required engine options; it failed before execution and was corrected to
supply explicit fixture limits. This was a QA setup error, not a product pass.
The optional DOCX command is not a root CLI route; no root route was invented.

Final maintained checks after the correction:

- `npm test --workspace=docx`: 64 files, 1,678 tests passed, including all
  original tests and seven added variants/cases.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: all five workspaces in the
  maintained dependency closure and native postbuild checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  40 passed, none skipped; actual memfs shell workflows remain intact.
- `npx vitest run scripts/docx-exports.test.ts`: both checks passed.
- The maintained integration-inputs test selected by
  `default normal runner passes every discovered active file` passed; this is
  an exact discovery/runner gate, not execution of all 1,126 discovered files.
- `git diff --check` passed. Final logs use the
  `/tmp/docx-link-verification-final-` prefix; the inventory gate log is
  `/tmp/docx-link-verification-inventory.log`.

Scope gaps remain explicit: live Hyperlink/Paragraph APIs, link batch execution,
shared-story mutation and whole-public-API conformance are not completed by this
task. Word/LibreOffice rendering, full-root tests and remote delivery were not
run. No unrelated plan status, index entry, README or historical evidence is
changed; disposable logs/screenshots stay outside the commit.
