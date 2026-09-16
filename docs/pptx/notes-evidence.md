# Notes behavior and public API accounting

This receipt covers bounded F48 operations and notes graph preservation. It does
not claim whole-public-model coverage. The original pinned test audit describes
its historical baseline; its blanket adaptation status is not current package
status. The focused [case ledger](notes-case-map.json) retains all 35 notes unit
variants and 11 expanded BDD examples. The [API ledger](notes-api-map.json) retains
all 70 notes-named public type/member/protocol records, including inherited and
untested members. Broader shared shape/text/enums remain in the full API inventory.

No source implementation or binary fixture was copied. Behavioral assertions use
original text/assets. Existing standalone package and research MIT notices remain
in place. Research identifiers never enter product source or tests.

## Exact language and security mappings

The bounded byte operations are asynchronous and accept only supplied bytes or
explicit input capabilities. No ambient host paths, network, native runtime,
clock or identity is consulted. Operation records are detached values, not live
NotesSlide/NotesMaster objects; they cannot count as those implemented members.
CLI positions are one-based; opaque locations are fingerprinted and owner-scoped.
Speaker body absence is null and existing empty body text is the empty string.
Reads never create missing notes. Explicit add/set may create original parts;
this is distinct from the still-planned creating model getters.

Primary model spellings remain notes_master, notes_slide, has_notes_slide,
notes_placeholder and notes_text_frame. The ledger retains exact proposed
signatures, inherited declaration locations, defaults, errors and side effects.
JS collections retain explicit iteration/length/at mappings, without equating a
placeholder key with its sequence position. XML/package access remains bounded
and capability scoped. Underscore-prefixed shared public types remain public
obligations in the full register. These mappings do not erase implementation gaps.

Direct notes operations edit the BODY placeholder only. Slide image, numbering,
date, header, footer and ordinary note shapes remain distinct. Explicit text
frame operations with notes or notes-master scope address other authored text;
format-preserving text replace remains separate from destructive text setters.

## Multiple master constraint

The [documented PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)
permits at most one Notes Master part. Import cannot promise arbitrary competing
master support by emitting additional default IDs. Existing rejection stays
visible and is tested; preservation of unsupported input is distinct from
creating a standards-conforming merged package. A future import reconciliation
would need explicit appearance/inheritance behavior before relaxing this guard.

## Independent disposable corpus census

Manifest SHA-256 verified for CERN-intro-2025-v2.pptx and WWL-template-1slide.pptx.
Independent ZIP/XML inspection found 15 notes parts with empty BODY text in the
first input, despite nonempty slide-number fields. The second has one notes part,
98 raw BODY text characters across four paragraphs (101 logical text characters
including three separators), empty slide image text and a one-character
slide-number field.
This demonstrates why aggregate note text must not be labeled speaker text.
Product SDK inspection matched 15 empty bodies and one 101-character body.
An in-memory speaker edit on each deck changed exactly the selected notes XML
part; every other uncompressed package member remained byte-identical. Readback
matched the explicitly supplied original QA text, with affected count 1.
No input/output binaries were written, fetched, committed or deleted.
QA procedures and ownership are in [the plan](../plans/pptx-notes.md).

## Review findings reduced to original regressions

- Master placeholder text was copied into new notes; original clone tests failed
  before creation began clearing inherited placeholder text and reassigning IDs.
- Text-like XML inside opaque extensions was read as speaker content; an original
  extension regression now proves only direct paragraph/run/field text is read.
- Non-record read/mutation options and explicitly invalid selections were accepted as
  omissions; twelve original parameter cases now require typed failure before I/O.
- Existing direct note shape/master scopes were verified independently; no new
  competing editor or host capability was introduced.

The case ledger keeps inherited placeholder geometry and basename helpers as
explicit gaps. All 70 live-model members remain incomplete, including creating
getters, live ownership/collections and inherited interfaces. This work does not
claim every public notes API or every relevant behavioral adaptation complete.

## Final maintained verification

- `npm run build:workspaces -- --workspace=pptx`: selected declared build closure
  passed (pptx and its two required workspace dependencies).
- `npm test --workspace=pptx`: 157 files, 4,113 tests passed on the current
  workspace, including 52 new package notes cases.
- `npm run lint --workspace=pptx`: ESLint, source and test typechecks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/pptx/notes.test.ts`:
  all seven public CLI cases passed against the final built package.
- Focused safe-bash test lint passed. Help/error screenshot was captured through
  the maintained generic screenshot runner and visually reviewed. The root
  poe-code CLI does not expose this injected utility, so screenshot-poe-code
  cannot exercise it; `.cache/pptx-notes-cli.png` is disposable and uncommitted.

Checks include the existing unrelated working-tree changes, which are preserved
and excluded from this task’s staged changes. No whole pipeline, push or release.
