# Text-reading research and case accounting

This feature is structural text extraction through an operation-level SDK and CLI.
It does not implement the live `TextFrame`, `_Paragraph`, `_Run`, `_Cell`, shape,
notes or collection object model. Leading underscores in documented returned
interfaces do not remove those interfaces, inherited members, constructors,
properties, enums, helpers or untested public APIs from the outstanding contract.
The complete obligations remain in [the API inventory](upstream-api-inventory.json)
and [the public API register](public-api-map.json).

## Provenance and scope

The read cases were inspected against the pinned
[python-pptx source](https://github.com/scanny/python-pptx/tree/278b47b1dedd5b46ee84c286e77cdfb0bf4594be)
and [unit/expanded BDD inventory](upstream-test-inventory.json), including the actual
parameter fixtures in `tests/text/test_text.py` and getter scenarios in
`features/txt-paragraph.feature`, `features/txt-textframe.feature`,
`features/txt-text.feature`, `features/tbl-cell.feature` and
`features/sld-slide.feature`. Source code and downloaded presentation assets are
research inputs, not product dependencies or original test fixtures. The required
[MIT notice](upstream-license-notice.txt) remains standalone. No source fixture
wording or source-project branding is needed in the implementation.

[The per-case accounting](text-reading-case-accounting.json) retains separate
identities for relevant parametrized unit variants and expanded BDD examples.
It conservatively includes public owner, sequence, placeholder and chart text-frame
reads to make unsupported neighboring behavior visible. Exact source identity and
line are provenance, not product test names. Live-model status is separate from
any extraction-semantic test evidence: inspecting cell text does not implement
`_Cell.text`, and flattening shape order does not prove the entire shape collection.
Formatting setters, fitting, mutation and other features remain in the complete
inventory; they receive no coverage credit from this extraction slice.

## Observed text semantics

The source paragraph getter has eight variants: one run; adjacent runs; a break
between runs; a cached field between runs; a break followed by a field with leading
whitespace; paragraph formatting nodes surrounding a run; a field alone; and a
break alone. A soft break is U+000B. Field content participates in the source flat
string, but extraction must retain a separate field record and its cached text.
The source getter does not evaluate a date, slide number or any other field.

The text-frame getter has one-paragraph and three-paragraph variants with U+000A
between paragraphs. Paragraph collection tests cover zero, one and two members.
The run collection test preserves three consecutive runs; the run getter retains
its text exactly. The expanded BDD getters add two paragraph cases (zero or two
soft breaks), two frame cases (one or three paragraphs), whitespace-preserving
run text and ordinary shape/cell text. These are distinct source cases even where
an original TypeScript matrix exercises equivalent observable behavior.

Original edge coverage must additionally preserve empty text frames, empty
paragraphs, empty runs, empty fields, Unicode and whitespace without truthiness
filtering. Group contents follow depth-first shape-tree order; table cells follow
row-major XML order. Slide-list order is independent of ZIP part names. Hidden
slides remain inspectable. Repeated placeholder identifiers or equal strings
must not collapse separate shapes. Notes, layouts and masters require explicit
owner scope and must not appear merely because their relationships are present.
These are structural extraction semantics, with no claim of visual reading order.

## Exact JavaScript and security mapping

[J01–J10](api-language-mappings.md) remain the detailed public-model decisions:

- Neutral snake_case model properties stay direct properties. Operation options
  remain camelCase. This feature's operation data is a readonly TypeScript snapshot declaration,
  not a substitute spelling for a live model accessor.
- Paragraph/run tuples become readonly membership snapshots containing live
  handles when that model is implemented. Iteration uses `Symbol.iterator` and
  collections expose `.length`. Numeric sequence lookup and sparse placeholder
  key lookup stay distinct; table rows, columns and cells reject negative indices.
- `null` is explicit absence; `undefined` selects a documented default. Empty
  strings, zero, absent fields and a present field with an empty cache stay distinct.
  JS strings preserve Unicode; soft breaks and paragraph separators retain their
  separate U+000B/U+000A meanings. A cached field is never converted to an ordinary
  run merely because both contain strings.
- Optional notes reads are noncreating. The eventual `notes_slide` model getter
  can create structures, but a read command must not call it to inspect absence.
  Likewise, chart title/text-frame creating getters are not covered by ordinary
  shape text traversal. Their public API and BDD obligations remain unsupported.
- Byte admission is always async and bounded. Paths require the supplied VFS
  authority. No implicit host filesystem, runtime, font lookup, current time,
  external relationship fetch, embedded execution or field evaluation is allowed.
  Any future text fitting requires supplied admitted metrics rather than native
  font discovery.
- Public `element`, `part` and inherited owner access remain bounded-view API
  obligations. Raw XML constructors, unrestricted XPath and host callbacks do not
  become available through extraction. No underscore-name privacy exemption applies.
- Source sequence errors map to typed bounds/key errors in the future model;
  operation selection and CLI errors follow the shared office contracts. Existing
  exceptions and collection defaults must be tested, not inferred from a flat
  successful extraction.

## Documentation reconciliation

The upstream audits' statements that SDK implementation had not started describe
those audits' historical snapshots. They are neither a current repository-wide
status report nor evidence that this extraction implements the live model. The
upstream pass counts remain reference-only evidence, never TypeScript test passes.

The proposed `TextData` register previously used flat segments. Its closed result
structure in `command-coverage.json` and the format specification Appendix C now
includes the paragraph/run/break/field and location definitions; proposed count
and string limits remain explicit. The executable
`text.get` result schema is authoritative for the supported command subset; a
closed data-definition update does not implement proposed selectors, batch
operations or the whole live model. Consumer examples should be checked against
that schema rather than copying the older flat shape. The shared contracts still require `text`/`text get`, common
selectors, the version-1 envelope, bounded diagnostics and honest capabilities.

Planning and QA execution procedures belong in `docs/plans`; this document is a
research receipt. Corpus fixtures remain disposable inputs governed by
[the manifest](corpus-manifest.json), never shipped files or download-dependent
unit tests.
