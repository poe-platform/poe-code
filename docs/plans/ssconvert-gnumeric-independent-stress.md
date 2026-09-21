# Independent Gnumeric XML codec stress procedure

Execute as an agent after implementation. Product unit cases use original
in-memory fixtures only. Native ssconvert is a separate QA oracle, never a
product dependency or fallback. Do not edit README files, commit or push.

1. Read root and scoped AGENTS instructions and coordinate runtime ownership
   with the root integration owner. Keep runtime edits with that owner unless
   ownership is explicitly transferred.
2. Execute `npx vitest run packages/ssconvert/src/codecs/gnumeric-independent.test.ts`.
   Preserve failing assertions; validate repairs against source or oracle evidence.
   This focused developer invocation does not replace maintained uncached package
   and cross-workspace delivery gates.
3. Inspect the authenticated Gnumeric 1.12.61 SAX reader for shared expression
   ownership and relative references. Compare absolute and relative expression
   references, sparse cells and cached-result omission after export.
4. Use the separate Docker context `colima`, container `ssconvert-statistics-qa`,
   executable `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert` and exact
   explicit environment from `docs/ssconvert/gnumeric-xml-reference-profile.json`.
   Put original input bytes and channel/status captures only under owned
   `out/gnumeric-xml-independent`. Export through `Gnumeric_XmlIO:sax:0` to inspect
   object/encoding semantics directly. Never invoke native utilities from unit tests.
5. Check cancellation before execution and during cooperative XML parsing;
   compressed input/decompressed bounds; external entities; foreign namespaces;
   XML and gzip determinism; retained print, conditional style, solver and object
   records; SDK style/axis updates; and malformed imported XML element/attribute
   names. Distinguish semantic subtree preservation from byte identity.
6. Record failures and coverage limits, then remove owned temporary evidence
   after reducing it into maintained audit evidence. Do not remove other agents'
   captures.

## Observations, September 20, 2026

The initial independent seven-case cohort had six passing assertions and one
failure: a reused shared formula `=A1+$B$1` at C2 incorrectly stayed unchanged
instead of becoming `=A2+$B$1`. Source `xml-sax-read.c` lines 2318–2430 stores
expression AST references; native export uses shared ExprID shorthand.

The expanded 12-case cohort had seven passes and five failures. Additional
validated failures were retained source Styles overwriting an SDK `0.0000`
format update with `0.00`, retained Rows overwriting SDK row size/hidden updates,
and two malformed imported record names accepted as element/attribute syntax.
Preaborted and midparse cancellation, namespace isolation, external entity
refusal, bounded decompression and plain/gzip determinism passed this cohort.

Three native oracle invocations returned status zero under the recorded profile.
Declared ISO-8859-1 XML containing `café` exported as UTF-8 with the value intact
and empty stderr. An unknown `custom:extra` child of CellComment was dropped;
stderr was exactly:

```text
Unexpected element 'custom:extra' in state : 
	Workbook -> Sheets -> Sheet -> Objects -> CellComment
```

Two additional regressions cover those measured behaviors. These findings were
delivered to the root runtime owner. This is an independent initial stress report,
not a final pass declaration. Native byte identity, all legacy versions/encodings,
every style/object handler, array-formula follower generation, full command
diagnostics and the complete SAX element/attribute audit remain outside this
small cohort. Unsupported and unmeasured cases are not passes.

After coordinated runtime repairs, the expanded 18-case rerun passed 16 cases;
the v10/v14 unknown-sheet-attribute cases still exported `Bogus="yes"`, although
native output drops it. Both native version cases silently ignored Bogus and
the unknown cell Mystery attribute, and warned only for the unknown Cells child:

```text
Unexpected element 'g:Unexpected' in state : 
	Workbook -> Sheets -> Sheet -> Cells
```

The repaired shared references, SDK axis/format changes, XML-name refusal,
Latin-1 declaration decoding, object descendant warning/drop and retained rich
records passed that rerun. Added UTF-16LE and UTF-16BE BOM/declaration cases both
preserved `Ω 😀`. Focused ESLint and the package test TypeScript project passed
after the initial 16-case cohort; root retains maintained delivery gate ownership.

The final independent 20-case cohort passed all 20 assertions after two
independent runtime repairs. A retained Rows container attribute name containing
XML syntax had bypassed local-name validation; the shared XML grammar validation
now covers that path and retains only declared axis-container attributes. A
cyclic retained SDK record previously exhausted the JavaScript stack; recursive
record emission now rejects depth above the importer limit with resource-limit.
Both repairs were preceded by concrete failing tests. Runtime ownership returned
to root after these narrow repairs. This 20-case result establishes only the
enumerated assertions, not complete native workbook byte identity or every
delegated object/metadata descendant.

The follow-up independent review verified calculation boolean decoding against
`gnm_xml_attr_bool`: ASCII case-insensitive false and the exact string `0` are
false; other values are true. Six additional original regression families found
and repaired nonzero integer row flags, newline/tab XML encoding declarations,
modern-version SheetNameIndex admission selected by literal `gnm`/`gmr` prefix
declarations, Version-element admission independent of prefix, reserved XML
attribute prefix emission, and prohibited xmlns-namespace SDK data. All repairs
followed failing cases. A generic `g` prefix without Version remains in the
native legacy unknown-version mode and can omit SheetNameIndex; the distinction
is source-validated in `xml-sax-read.c` lines 501–583 and 851–860.

The follow-up runtime cohort passed 28 independent assertions and 11 root codec
assertions (39 total). The reserved XML-namespace cases establish well-formed
SDK serialization, not native preservation of arbitrary unknown attributes.
The additional multiple-prefix native capture returned status zero but emitted
a libgsf warning containing volatile PID/time about namespace redeclaration.
That diagnostic remains a documented mismatch; no speculative runtime repair
was made. Remaining bounds review found no further reproduced failure beyond
the admitted cases; that is not exhaustive memory/cancellation qualification.

The final independent read-only review confirmed native Zoom four-significant-
digit serialization while leaving default 17-digit cell formatting unchanged.
The final focused cohort passes 29 independent and 21 root assertions (50 total).
Cleanup, array, date, and repeated-calculation follow-ups are described with
reference captures in `docs/ssconvert/gnumeric-xml-verification.md`. Root
completed the maintained uncached package run (143 files, 3,961 tests), rebuilt
Safe Bash public integration (49 tests), package lint and the fresh selected
18-workspace Safe Bash build closure. These results do not qualify every
native delegated object, metadata or gzip byte family.
