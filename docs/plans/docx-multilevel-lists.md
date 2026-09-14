# DOCX multilevel lists

Status: bounded list utility implemented and verified locally. No push or release.
Scope: this list task only, on main. Later pipeline tasks remain pending. Preserve
all historical inventories and the unrelated pipeline-plan changes observed at
entry. No push, release, downloaded fixtures or native reference build.

## Behavior and ownership

`editDocumentLists(bytes, request, context)` owns `lists.add` and `lists.set` in
packages/docx. The optional command engine calls this same SDK, and the existing
safe-bash adapter only passes capabilities and streams. Root export wiring and
runtime dependencies are unchanged.

Add appends one paragraph to the body or a selected supported block container,
or after an explicit paragraph anchor. It accepts the existing six kinds:
bullet, decimal, lowerLetter, upperLetter, lowerRoman and upperRoman. New abstract
definitions contain nine levels (0–8); every level uses the supplied kind. Defaults
are level 0, start 1 and empty text. With no explicit start, an adjacent selected
list can continue when its effective target-level format matches the requested
kind; it retains the complete existing level semantics. A different kind at an
unused level can create a mixed ordered/bulleted list: only a fully matched simple
nine-level definition is eligible. Census all supplied XML paragraphs and style
references first; if that instance already uses the level, create a separate list.
Otherwise clone/reuse the complete new abstract semantics and rebind only the
anchor instance. Other instances sharing the original abstract remain unchanged.
Custom level formats, style links and full-level overrides are never guessed or
rewritten by this creation path. An explicit start always
creates a separate concrete instance, including an explicit 1. New abstract
reuse requires full expanded-name/content/attribute equivalence with the original
generated definition, not merely a matching numFmt tag. No unrelated definition
is overwritten to obtain a familiar ID.

Set targets existing list paragraphs and retains their text, mixed runs, other
paragraph properties and reference comments. Omitted level retains the resolved
level. Restart is false by default; start requires restart true. Explicit starts
are nonnegative safe integers, including zero. An omitted restart start uses the
effective level definition's start, or 1 when absent. Each original concrete
instance gets a separate restart instance for its selected paragraphs. Selected
nested levels retain one common instance with independent level overrides;
unselected paragraphs and other instances retain their original bindings.

Paragraph numbering resolves direct properties, paragraph/default-style
inheritance and level-to-paragraph-style associations. Numbering-style links are
traversed with bounded cycle checks. Restart materializes the effective abstract
reference and merges inherited full-level overrides with local start overrides;
styles and prior definitions remain byte-identical. Existing mixed formats,
paragraph styles, indentation and run properties on supported levels survive.
The utility does not expose the later advanced `lists.levels.set` model setter,
edit arbitrary level-text/indent/style-link definitions, or complete live Paragraph and
NumberingPart owners; these declared APIs remain visible and pending.

Numbering parts are found by their relationship from the actual main part, in
the input dialect. New part names and relationship IDs use the package allocator.
Abstract IDs and concrete instance IDs use separate sets; definitions and stored
references are reserved before allocation. IDs are deterministic, numeric and
bounded, and concrete ID zero remains the paragraph-numbering removal sentinel.
New abstracts precede concrete instances; cleanup metadata remains last.

Unsupported schemes, picture bullets, foreign extensions and ambiguous graphs
are never interpreted as a supported scheme. Affected edits reject. Unrelated
numbering subtrees, picture definitions, relationship bytes and media bytes are
preserved. Malformed/cyclic graphs already rejected by core-v1 admission retain
its invalid-package diagnostics. Editor-specific unsupported graphs use
unsupported-edit. Missing levels, duplicate properties, excessive nesting,
stale locations, tracked list edits and shared-story ambiguity reject before
publication. Section-ending paragraph anchors require a block-container insertion;
no section properties are silently duplicated or moved.

## Exact language/security mappings and documentation drift

The source inventory and public API map remain historical research evidence.
The following is the current bounded execution record, not a promotion of the
whole proposed model surface:

| Surface | Exact mapping and disposition |
| --- | --- |
| Utility input/output | `Uint8Array` input; always-async `editDocumentLists(...): Promise<ListEditData>`; existing camelCase operation options; existing version-1 mutation envelope and neutral errors. All file/stream publication uses explicit capabilities. |
| Values and selectors | Zero-based stored numbering levels 0–8 versus one-based CLI paragraph/table ordinals. IDs are scoped XML integers; start accepts 0 through Number.MAX_SAFE_INTEGER without string coercion. Omission applies only the stated default; false and zero survive. No null option was added. |
| List kind parsing drift | The generic numeric parser incorrectly treated the literal kind `decimal` as a numeric type because it matched a substring. The original failing command case now parses the symbolic kind and produces the same bytes as the SDK. Numeric decimal-multiple validation remains intact. |
| XML numbering | ECMA-376 Part 1 §17.9, CT_Numbering, CT_AbstractNum, CT_Num and CT_Lvl, as pinned by the existing standards register. Transitional/Strict w and relationship namespaces remain separate; source prefixes are retained on existing content. This is graph editing, not glyph rendering or certification. |
| `_NumberingStyle` | Public despite its leading underscore. Retain inherited name, style_id, type, builtin, hidden, locked, priority, quick_style, unhide_when_used, delete, element and part; equality maps to `equals(other: unknown): boolean`, owner/node identity rather than wrapper identity; inequality is `!equals(other)` with no duplicate alias. Existing style-model evidence is unchanged; this task adds relationship resolution, not a new private exclusion. |
| `DocumentPart.numbering_part` | Retain its neutral spelling and creating-getter obligation in the live model. Utility add creates a missing part only during an explicit mutation. No live getter is claimed implemented by this task. |
| `NumberingPart.numbering_definitions` | Proposed synchronous `readonly numbering_definitions: NumberingDefinitionsView`, with bounded owner-bound views and `readonly length: number`; pending. Internal graph maps are not advertised as this public collection. |
| NumberingPart inherited/public closure | Keep after_unmarshal, before_marshal, blob, content_type, drop_rel, load, load_rel, package, partname, part_related_by, relate_to, related_parts, rels, target_ref, element, part and new in the register. Bytes map to Uint8Array, package/XML handles are bounded owner-bound views, supplied loading/publication is async, model-only access stays sync. No ambient filesystem, networking, clock, template download or arbitrary XML-library interface. These model members are not promoted by utility tests. |
| Advanced model operations | `lists.levels.set`, numberingStyle links and per-level format/text/start/restartAfter/paragraphStyle/indent/hanging authoring remain declared typed-model obligations. Existing mixed definitions and links are preserved/resolved by the utility; their presence is not setter coverage. |
| Discovery drift | Help/schema/capabilities now identify lists.add/set as bounded edit operations. Help shows applicable selectors and defaults; later model batches remain explicitly pending. The original exact discovery inventories were extended, not replaced with implementation-derived expectations. |

No new blanket aliases, arbitrary method invocation, dynamic evaluation, host
font access or resource downloads are introduced. Low source test coverage does
not erase inherited/public members, enum/collection/helper requirements or the
advanced model obligations above.

## Test-first evidence and manual QA

1. Ten original tests failed before product code because editDocumentLists was
   absent. They independently walk paragraph → concrete instance → abstract
   definition → effective level/override, in both dialects and nested cells.
2. Further failing tests exposed symbolic-kind parsing, default-style lookup,
   inherited full-level override loss, level/style association, grouped nested
   restarts, reference-comment retention, numbering prolog/epilog loss and
   misleading list help, mixed-level creation and unverified counter attributes. Each was corrected after its original regression failed.
3. Reopen authored in-memory packages and assert exact untouched numbering
   subtrees, mixed level formats, scoped IDs, starts/restarts and picture-bullet
   relationship/media bytes. Every unit-test file mutation uses memfs.
4. Run actual optional safe-bash Shell commands for dry-run, in-place and output
   publication. Check failed forced publication retains existing destinations,
   JSON reports no effects, and invalid/ambiguous selections leave input unchanged.
5. Inspect terminal screenshots of actual command-engine help, successful dry-run
   and invalid nesting output. The optional docx command is not a root poe-code
   CLI route; use the maintained terminal-png renderer rather than add root wiring.
   Initial `/tmp/docx-lists-cli.png` exposed irrelevant selectors and a long help
   description. Keep it as disposable historical QA evidence; inspect the final
   capture separately. Do not stage either image.
6. Run maintained DOCX tests/lint/selected build closure, safe-bash DOCX tests,
   portable export checks and the existing exact test-inventory gate. Commit
   explicitly owned paths only, including this plan. No push or release.

## Verification

Verified on 2026-09-14 against the owned working tree:

- `npm test --workspace=docx`: 57 files, 1,480 passing tests, including 25 new
  original list regressions. Original test names/data remain except additive
  discovery expectations; no downloaded fixtures are canonicalized.
- `npm run lint --workspace=docx`: ESLint, source TypeScript and test TypeScript
  passed. No suppressions, ignored-file commits or verification bypasses.
- `npm run build:workspaces -- --workspace=docx`: the maintained five-workspace
  dependency closure and native postbuild checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  all 27 tests passed, including two new actual Shell list workflow cases.
- `npx vitest run scripts/docx-exports.test.ts`: both portable export/browser
  closure checks passed; there is no product networking or ambient host I/O.
- The maintained `integration-inputs.test.mjs` case named
  `default normal runner passes every discovered active file` passed. The
  existing literal registration of the extended Shell test file is retained.
- `git diff --check` passed. `/tmp/docx-lists-cli-final.png` was inspected:
  applicable selectors, short help text, explicit defaults/mixed-list behavior,
  successful dry-run and rejected level 9. The initial capture remains separate.

The first broad check exposed three additive discovery inventory updates. The
new forced-output test initially expected exit 4; the shared CLI contract assigns
unsupported-edit exit 1 and reserves 4 for resource limits, so its expectation
was corrected without changing product exit mapping. These earlier failures are
not counted as passes. No full-root suite, complete live model, advanced arbitrary
level setter, downloaded corpus, document glyph rendering, remote delivery or
release is claimed.
An independent read-only Shell review passed its eight focused tests and found no
adapter authority defect; its failure-coverage gaps were addressed with an
additional forced-destination/ambiguity regression. It correctly retained the
advanced model boundary above.
