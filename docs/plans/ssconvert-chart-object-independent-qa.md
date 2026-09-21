# Chart object independent QA

Independent reviewer scope: `packages/ssconvert/src/objects/index.ts` and
`model.test.ts`. Root retains command exports, integration, Git and layout ownership.
Follow-up scope includes independent `layout.ts` review and additional tests.
Review uses original inline XML, injected byte I/O and memfs. No native command,
LLM, host file fixture or macro/script execution is used by unit tests.

## Reproduced and repaired

- Qualified attribute projection lost `q:Name` and `xml:lang` despite codec retention.
  The original failing test observed missing `qualifiedAttributes`. Projection now
  retains namespace-aware qualified attributes separately from schema lookups;
  qualified names cannot replace the unqualified object name.
- Objects without `ObjectBound` crashed with `Invalid A1 address`. The failing
  graph/control/image ordering fixture reproduced this. Released primary source
  `out/ssconvert-lifecycle/gnumeric-1.12.61/src/xml-sax-read.c`, object-reader code
  around lines 2643–2657, explicitly initializes a default before reading optional
  ObjectBound. Projection now omits unknown range instead of parsing an empty string.
  Matching native default geometry itself remains unmeasured.
- XML tab/newline/carriage-return offset separators projected empty offsets.
  Original encoded-whitespace fixture failed with `[]` versus `[0,0,1,1]`.
  The same source reader uses `sscanf` with whitespace-separated doubles.
  Projection now recognizes the four XML whitespace characters without regexes.

## Verified coverage

`npx vitest run packages/ssconvert/src/objects/model.test.ts`: 7/7 pass after
all repairs. Tests verify historical drawing retention, nested chart links,
graph/image distinction, source object order, foreign namespace exclusion,
qualified metadata, invalid nonfinite offsets, offset whitespace, bounded depth
and work, exact cancellation reason identity, and memfs engine round trip.

`npx vitest run packages/ssconvert/src/objects`: 14/14 pass across two files.
Layout review matched released `sheet-object.c` anchor-to-points and
cell-offset multiplication code. Added stress verifies cancellation inside an
admitted metrics callback prevents later callback admission, absolute anchors
never access cell metrics, and finite metric arithmetic overflow is rejected.
Metrics remain explicit trusted capabilities; no host filesystem is consulted.

The memfs case also asserts that standalone transformed workbooks are rejected
by another engine ownership set and produce no output file. Renamed books enter
the writing engine through injected XML reimport. Existing formula serialization
quotes renamed sheet names; the mistaken initial expectation was corrected to
`'Renamed'!$A$1`, with no product serializer change.

Compact XML and pretty XML have different structural whitespace in passive
payload text. The test separately verifies identical semantic graph/anchor/name
and exact full payload stability after canonical serialization and reimport.
It does not claim byte-identical input XML round trips.

`npm run lint --workspace=@poe-code/ssconvert` passed after model offset repairs;
root must rerun final maintained checks after the subsequent two layout stress
tests and root integration edits.

## Remaining limitations

These tests do not establish native chart painting, axis/font/color/style visual
fidelity, every plot plugin or optional GOffice extension, object conversion in
XLS/XLSX/ODS/SXC/PDF/SVG/HTML codecs, native graph export bytes and diagnostics,
comments/controls default geometry, numeric offset dialects accepted by C doubles,
or complete source-reference behavior through resize/merge/recalc/update.
The projection currently derives only retained Gnumeric XML object records;
it is not a complete shared import/export object implementation across codecs.
Opaque preservation and external-object nonexecution are not globally certified
by this scoped review. Native default geometry and structural whitespace behavior
require an explicitly separate oracle measurement. Unsupported and unmeasured
cases are not passes.
