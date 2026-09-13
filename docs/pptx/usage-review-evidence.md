# Usage and public-surface documentation review

Documentation-only receipt, 2026-09-13. [Usage](usage.md), the
[exact export catalog](sdk-exports.md) and [pending README](package-readme-draft.md)
reflect the checked private workspace. No product code, test, README or fixture
was authored or changed. Procedures live in the
[agent plan](../plans/pptx-usage-documentation-review.md).

## Complete accounting, partial behavioral evidence

Read both upstream audits and inventories, the corpus manifest, format contract,
shared CLI/SDK contracts, J01–J10 mappings and current reconciliation receipts.
Resolved all 2,700 unit-variant and 973 expanded BDD inventory pointers in
[test-case-map.json](test-case-map.json), with unique pointers, matching source
file/line, exact unit identities and retained expanded BDD steps. Every source
case still has its separate original TypeScript target/obligation. No parameter
or BDD example was discarded or newly declared equivalent to another case.

The central ledger retains 2,585 semantic-review rows, 43 original TS passes,
167 specified-but-unimplemented rows, 877 proposed designs and one deferred
public behavior. These are historical ledger statuses, not today's test-suite
pass census. All relevant cases are accounted for, but **complete original
behavioral adaptation remains unfinished**. Later family receipts supersede only
their reviewed behaviors; this documentation task does not implement those gaps.
The upstream test audit's “adaptation not started” is a baseline statement, not
current package status. This resolves its interpretation without editing the
preexisting untracked audit or its historical hashes.

Every one of 2,409 API inventory records has a destination in the 2,426-row
[public API map](public-api-map.json); every target row has a matching central
acceptance obligation. The extra 17 rows describe bounded XML/package views.
Inherited members, collections, enum aliases, helpers, returned underscore-prefixed
interfaces and APIs with no upstream tests remain in scope. Module export counts
are separate denominators and do not prove those members' behavior.

Input SHA-256 identities at this check:

| Research file | SHA-256 |
| --- | --- |
| upstream-test-inventory.json | 702a7b6aaa2009050583c4ef4c2b363ef5f52bea4a59cc60aa5861e30731fa6d |
| test-case-map.json | 64a66c9adb50530945d94bc1f3ec9d5c79e7220b48afe46950e3dfc5ca9fa3d0 |
| upstream-api-inventory.json | 119a4ba61a96c88f487fb769fa268bc3a5d520b58315b8aa08606540fc92b421 |
| public-api-map.json | e1af75d442ec97a100834db34433d2dbdd3a2bcf7d2a5779789dcd28d08e147c |
| corpus-manifest.json | f4c740aa929eb714b4b83ec63cb7d3641f278d5dffbc4c81303e02aee237169f |

Exact language/security decisions remain in [J01–J10](api-language-mappings.md)
and per-member target signatures: neutral spellings, positional/default/null
semantics, always-async admission/save, owned live handles, checked sequences
versus sparse keys, typed enum/unit/color values, UTC dates, neutral errors and
explicit VFS/metrics/time. Usage records these publicly without reference branding.
The current compiled factory uses `PresentationContext` and returns
`Promise<PresentationModel>`; the inventory's conceptual `OfficeContext` /
`Promise<Presentation>` spelling is not a package import promise. Current model
budgets are also smaller than the proposed format profile; usage lists both.

Existing [MIT research notice](upstream-license-notice.txt),
[test-map notice](test-case-map-notice.txt) and
[API-map notice](public-api-map-notice.txt) remain standalone and unchanged.
No reference implementation, source prose or assets were copied into examples.

## Checked public imports and commands

Maintained `npm run build:workspaces -- --workspace=pptx` passed, building the
selected three-package closure. `npm run lint --workspace=pptx` passed.
`npm test --workspace=pptx` passed: 269 files, 6,874 tests, duration 77.01 seconds.
No test failures, skips or timeout repairs were required.

Local `npm pack --workspace=pptx` produced a disposable archive. Its 351 entries
contained no source/test/corpus directories. Extracted-package runtime keys
exactly matched TypeScript export classification: 274 root runtime values,
244 root type-only names, two `pptx/bytes` runtime values and no byte-entry types.
The catalog preserves exact spellings, including public underscore-prefixed
exports. The main usage SDK imports and example typechecked under strict NodeNext.
Packing here does not publish the private package or qualify a released consumer.

Bounded packed command-engine probes used original text, an in-memory file map,
explicit limits, a read callback and a publication callback. Help returned 0;
replacement without cardinality returned usage 2 with no document read;
create/read/edit/merge returned 0; edited text was `Final coastal survey`.
Template-based creation returned 1 / `unsupported-profile`. The draft initially
included that shared-contract target as executable usage; it now identifies the
unsupported command and uses direct binding on an existing presentation.
The existing original case in `packages/pptx/src/command-create.test.ts` already
covers `--template source.potx`, exit 1, the stable code and no input reads.
No duplicate regression or product fix was appropriate. A separate original
in-memory SDK binding probe changed `{{heading}}` to `Coastal survey` exactly.

The selected existing virtual-shell create/workflow suites passed 62 tests,
zero failures/skips/cancellations, 4.804 seconds. These exercise actual virtual
`.sh` parsing and publication; the command-engine map probes alone do not.
No claim is made that every usage example or API member received a new execution.

## Screenshot inspection

Maintained `npm run screenshot -- --output PATH cat TRANSCRIPT` rendered actual
captured packed-engine help/error/example output. These are transcript screenshots,
not direct interactive sessions; the `cat` heading makes that distinction visible.
Inspected `.cache/pptx-usage-review/help.png`, `error.png` and `example.png`.
Also ran maintained `npm run screenshot-poe-code -- --help` and inspected
`screenshots/help.png` for the host design language. That helper automatically
ran its build/bundle prerequisite (73 successful uncached tasks); no agent
pipeline, corpus campaign, release or product network operation was executed.

All four PNGs are readable with consistent terminal background and monospace
presentation. Error output names the missing cardinality and the three accepted
choices; example output contains only the requested text plus transcript metadata.
PPTX image help has a very long usage line: the auto-sized PNG does not clip it,
but it does not establish acceptable wrapping at a narrow interactive width.
The host help groups commands with cyan and options with yellow; PPTX output is
plain and less structured. Thus design-system consistency is **partial**, not a
visual-conformance pass. This task changes no CLI presentation or screenshot test.
The bounded follow-up is recorded in the agent plan.

No presentation renderer/font/playback check occurred. No corpus document was
read, downloaded, modified or shipped. No corpus finding needed reduction; the
manifest remains the authority for future disposable fixtures. Cache archives,
transcripts and screenshots are not staged. Evidence describes the live working
tree, including unrelated preexisting changes, rather than an immutable release.
