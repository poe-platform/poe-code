# Bounded deterministic dummy text

Task: `deterministic-dummy-text` only. Later pipeline tasks remain pending.

## Contract and ownership

Read the root and safe-bash guidance, `docs/specs/docx.md` (F45 and lorem
selection/schema/defaults), the shared Office CLI/SDK specifications, and the
DOCX API audit and pinned inventory. Product behavior is in `packages/docx`;
existing safe-bash adapters and root exports continue to wire the same engine.
No reference implementation, downloaded fixture or external generator is used.
All new assets and wording are original; no derived implementation needs a new
legal notice. Existing evidence and unrelated work are preserved.

## Implemented policy

`docx lorem set INPUT --seed INTEGER --paragraph N --output PATH` and
`setDocumentDummyText(bytes, options, context)` share admission, selection,
protection, stale-location checks and publication with preserving replacement.
Use an explicit paragraph, a checked text/owner token, or `--all` in the explicit
scope (body by default). Existing scope, publication and JSON contracts apply.
Unsupported common selectors fail rather than expanding authority.

Seed is required and must be a JS safe integer; map it modulo 2^32. For each
selected paragraph, word i is `amber birch cedar delta elm fern grove heath` at
`(seed + i) modulo 8`, restarting at i=0. `words` is a positive safe integer;
otherwise count maximal nonempty ECMAScript-whitespace-delimited spans in the
selected logical text. Unicode scalar ranges are checked before this count.
Fields contribute their visible cached results, never instruction text. Final
revision visibility and logical hidden-format inclusion follow text extraction;
no style cascade or rendering decides whether text is displayed.

Generate a space-joined string and distribute its ASCII characters into existing
selected `w:t` leaves using each original selected UTF-16 length, placing the
remainder in the last leaf. Run elements/properties remain in place. Literal
whitespace in replaced text is normalized to generated spaces; existing tabs,
breaks, soft/no-break hyphens and other nontext control elements remain exactly
stored and may interrupt the generated string. Unselected text before/after a
checked range remains exact. Required empty paragraphs survive. A computed zero
changes nothing, including an empty story. Explicit words can populate an empty
whole selected paragraph containing only paragraph properties. Other no-leaf
structures reject; a positive count without any selected target fails unless
allowEmpty is explicit.

This is **not anonymization**. Metadata, image bytes/alt text, field instructions,
relationships, inactive/opaque content and unselected text remain stored. Do not
make privacy claims. No wall clock, global randomness, networking or external
generator supplies document changes. Word/materialization, matches, work, XML,
retained bytes and complete result receipts use invocation budgets before any
publication. Affected protection, opaque review, unsafe grouped shapes and
shared stories retain the existing atomic rejection boundaries.

## Exact JavaScript and security mappings

| Surface | Mapping and current disposition |
| --- | --- |
| Utility operation | `lorem.set`, direct flags and closed camelCase operation options; `seed: number`, `words?: number`; always-async owned `Uint8Array` engine returning `TextMutationData`. Version-1 CLI JSON reports directly changed paragraphs and before/after fingerprinted locations. |
| Selection | CLI ordinals remain one-based; checked token ranges remain half-open Unicode scalar offsets. These are utility locations, not live model members or JS collection indexes. |
| Authority | Explicit VFS input identity, staged publication and byte sinks; no ambient filesystem, host identity, time, fonts or network access. |
| Errors | Shared typed usage, selection, unsupported-edit, publication, resource-limit and cancellation errors retain existing categories and CLI statuses 2/1/3/4/130. |
| Whole text setters | `Paragraph.text` and `Run.text` remain separate planned model obligations; this format-preserving utility does not implement or change destructive setter semantics. |
| Inherited and returned owners | `part`/`element` remain their inventoried security-mapped/planned bounded package/XML-view obligations. No unrestricted XML-library or host-I/O API is introduced. |
| Public underscore-prefixed types | `_Cell`, `_Header`, `_Footer` and other documented types retain their existing explicit dispositions; spelling does not hide them or make them private. |
| Collections, enums and helpers | Existing zero-based JS sequence, keyed lookup, iteration, null/inheritance, units and UTC-Date mappings remain unchanged. No model coverage is promoted by F45 utility tests. |

The inventory has no dedicated dummy-text public model member. F45 is an
additive utility obligation. Historical inventory, source-test crosswalk and
proposed command register remain historical/proposed; this record and runtime
schema/help/capabilities provide bounded executed evidence only. The audit's
existing documentation-error resolutions remain intact, including comment
id/date examples and whole-text setter versus preserving-operation scope. This
milestone resolves the former unimplemented `lorem.set` runtime discovery status,
not whole-public-API coverage or generic utility batch execution.

## Validation and failing-test evidence

Before product edits, the original new SDK tests failed with the absent
`setDocumentDummyText` export. Discovery acceptance failed before capability/help
implementation. A later empty-story regression reproduced positive-count
publication without a target before adding the missing-selection guard.
The full package check also exposed exact discovery inventories requiring the
additive command/schema/F45 expectations; existing test names and assertions
were retained. A malformed early QA metadata fixture was corrected to original
property-engine output with an authored image package; no product admission was
weakened. All unit mutations use memfs.

Validation results are recorded below after final checks. Ad hoc screenshots
and logs under `output/docx-dummy-text-qa` are disposable, untracked QA artifacts;
no screenshot test or native reference build is added.

- Maintained `npm run test:unit --workspace=docx`: 144 files, 2,976 tests passed.
- Original dummy-text regressions: 10 passed, including final parser-based
  metadata/image fixture mutation rechecked independently after the full run.
- Maintained selected build closure: `npm run build:workspaces -- --workspace=docx`
  passed, including portable dependencies and design-package export smoke checks.
- `npm run lint --workspace=docx` passed (ESLint and both source/test TypeScript
  projects); the existing unused type-only variable warning remains unchanged.
- Public DOCX Shell command tests plus registration: 151 passed; binary repeat,
  pipe, quoted virtual `.sh`, scopes, dry-run JSON and usage/limit statuses included.
- Maintained runner discovery's `default normal runner` check passed with the
  exact new test file included; no excluded/absent case counted as a pass.
- Narrow ESLint for the owned safe-bash test and runner-discovery assertion passed.
  No test-specific maintained safe-bash TypeScript route exists; no package-wide
  source/type/build change is claimed by these test-only additions.
- Root `scripts/docx-exports.test.ts`: 2 passed. Actual built self-import
  `poe-code/docx` exposes `setDocumentDummyText` as a function.
- Inspected generated help and missing-seed error screenshots through actual
  Shell dispatch. Help succeeded; missing seed retained usage exit 2. Initial
  screenshot-driver mistakes (omitted/partial mandatory archive limits) are
  preserved separately and do not qualify product behavior.

Completion is local only. Commit this atomic F45 operation, its original
regressions and this plan together on main. Do not push, publish or release.
No later pipeline task, general batch operation or whole public API is completed.
