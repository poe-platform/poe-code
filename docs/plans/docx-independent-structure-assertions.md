# Independent DOCX test assertions

Task: `independent-structure-assertions` only, completed 2026-09-14.
Later tasks remain pending, beginning with `fixture-reduction-workflow`.
The pipeline file has unrelated user edits; this owned completion record does
not stage or rewrite them. Earlier fixture and research records remain history.

## Owned changes

- `packages/docx/tests/assertions.ts`: independent, test-only assertions.
- `packages/docx/tests/assertions.test.ts`: original positive and negative controls.
- This task record.

No editor, package manifest, exports, adapter, CLI, SDK, README or dependency
change. The maintained root Vitest configuration already discovers these files.
The original 23 fixture tests and their original names/data remain unchanged.
The assertions import no product parser or editor. The fixture producer still
uses the shared ZIP writer, while the assertion reader uses its own ZIP framing
checks and bitwise CRC calculation, Node zlib inflation, Node SHA-256 and saxes
namespace-aware XML parsing. These built-ins perform only in-memory computation;
there is no host filesystem admission, networking or reference runtime/build.
The one simulated extraction mutation uses memfs.

## Checks and limits

| Assertion | Classification | Evidence and boundary |
| --- | --- | --- |
| ZIP | Container integrity | Checks ZIP32 single-disk central/local signatures, flags, methods, names, sizes, CRCs, count, contiguous nonoverlapping member ranges and full archive extent. Stored/deflated payloads are decoded independently; inflation must consume all compressed bytes. Maximum 1 MiB archive/expanded total, 256 KiB per part, 128 members. ZIP64, descriptors, directory entries and other profiles are outside this small assertion reader and reject; this is not the future product reader. |
| Part hashes | Byte integrity | Exact membership plus SHA-256 for every uncompressed part; the negative control uses independently known `abc` digest bytes and rejects changed/missing/extra expectations. |
| XML | Syntax and structural comparison | Fatal UTF-8 decode, namespace-aware expanded element/attribute names, ordered children, text, comments and processing instructions; DTDs reject. Prefix spelling and attribute order are insignificant; text whitespace is significant. This is not full XSD validation or QName-valued extension-attribute normalization. |
| OPC links/types | Scoped semantic checks | Content declarations and duplicate IDs, internal targets resolved relative to their owner, main relationship/type, known Word part types/edge roles and story relationship references. External targets remain inert. This fixture-oriented subset is not a complete OPC URI or schema validator. |
| Word references | Scoped semantic checks | Original fixture paths for styles/numbering/notes/comments; concrete-to-abstract numbering and level references, style references, unique drawing IDs per part, note kind isolation, paired ordered bookmark/comment ranges per story. No style resolution engine, arbitrary part discovery, grid editor or numbering renderer is duplicated. |
| Preservation | Exact bytes / structural semantics | Unedited parts and complete part membership must match exactly. Each explicitly dirty XML part must match a caller-authored expected XML structure; an unknown dirty part rejects. Add/remove operations require their own explicit inventory assertions in their owning tasks. |
| Images/tables | Payload and values | Complete image bytes, including a corrupted pixel and truncation control, not a name/tag check. Exact physical row/cell text arrays, with nested tables checked separately rather than flattened into parent rows. Logical merged-grid resolution and image characterization remain later product tasks; original fixture tests independently retain the BMP header/pixel expectations. |
| JSON | Result semantics | Parse the entire JSON output and compare the entire expected value. Check forbidden strings across all raw and decoded output, including escaped strings and trailing leakage. This is an assertion against a caller-owned result, not the future closed operation-schema validator. |
| Visual | Not executed | No renderer, page layout, repair-warning or CLI screenshot evidence. No CLI visuals changed. Structural success is not visual fidelity or schema certification. |

Every exported assertion has a positive control and a negative control. Malformed
outputs cannot pass merely because a search returns no matching tags. Dirty XML
comparison retains ordered content and rejects dropped comments, changed namespace
URIs/attribute namespaces and changed significant whitespace. No downloaded file
is required or modified; all regression data is original and held in memory.

## Red/green and maintained checks

1. At 00:54 local, wrote the acceptance suite first. The focused maintained
   Vitest command failed with `ERR_MODULE_NOT_FOUND` for `./assertions.js`.
2. Implemented the assertions; 17 new tests plus the 23 original tests passed.
3. Before strengthening the helper, added eight malformed-output controls:
   absent owner relationships, wrong main type, wrong styles edge role, wrong
   root edge role, duplicate drawing IDs, missing list level, duplicate abstract
   levels and a reversed bookmark range. At 00:56 the two containing tests
   produced all eight expected “function did not throw” failures using soft
   assertions, so no first failure concealed unexecuted controls.
4. Added the missing assertions; all 20 new tests and 23 original tests passed.
   A separate CRC control proves that corrupt CRC values in both header copies
   still fail against the independently computed payload CRC.
5. Fixed the local Node declaration mismatch for zlib's `info: true` result with
   an explicit test-only return type. Runtime controls and strict typechecking pass.

Final checks:

- `npx vitest run --config vitest.root.config.ts packages/docx/tests`: 43 passed,
  2 files, approximately 1.5 seconds overall; every case below 700 ms.
- `npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext
  --moduleResolution NodeNext packages/docx/tests/assertions.ts
  packages/docx/tests/assertions.test.ts`: passed, including imported fixture/codec
  source closure.
- `npx prettier --check packages/docx/tests/assertions.ts
  packages/docx/tests/assertions.test.ts`: passed.
- `npm run lint:eslint`: guarded traversal complete, exit 0, zero errors,
  12 warnings in unrelated `.cache/pptx-usage-review/example.mts`;
  12,364 configured subjects linted. No lint bypass or warning suppression.
- Owned whitespace and staged-path review before commit.

These focused runtime/type checks cover this test-only addition; no product
build, full workspace runtime gate, public API pass or corpus QA is claimed.

## Shared contracts and research status

Read `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md`, the API audit,
parsed API inventory and existing reconciliation decisions. The parsed inventory
has 920 records with `planned`, `language-mapped`, `security-mapped` and
`documentation-error` dispositions. None is promoted by helper tests. Inherited
members, enums/aliases, collections, helpers, returned underscore-prefixed public
types and APIs without source tests remain in the future implementation scope.

The exact governing mappings remain those in
[the reconciliation](../docx/upstream-api-reconciliation.md#language-and-security-decisions)
and [the format contract](../specs/docx.md#92-javascript-values-and-authority):

- Factories, save and image admission always return Promises; admitted model
  access stays synchronous. Owned bytes are `Uint8Array`; paths require explicit
  VFS capabilities, with no ambient I/O, clock, identity, fonts or network reads.
- Neutral snake_case model names and positional order remain; keyword-only
  parameters become trailing source-spelled options. Operation JSON uses camelCase
  separately. Omission/undefined uses documented defaults; allowed null retains
  absence/inheritance, distinct from false, zero and empty string.
- Sequences use zero-based access, `.length`, `Symbol.iterator`, documented `.at`
  and supported `.slice`; keyed styles/comments/relationships retain key/ID
  semantics. Owner/node equality replaces wrapper allocation identity.
- Safe integer EMUs use 914400/in, 360000/cm, 36000/mm, 12700/pt and 635/twip,
  nearest/half-away rounding. Dates are UTC with whole-second XML precision.
  Typed enum values/aliases and RGB channel/hex validation remain required.
- Type/value/index/key failures map to neutral input-type, invalid-value or
  semantic-validation, bounds and missing-key errors; nullable lookups stay null.
  Bounded owner-aware XML/package views replace unrestricted dependency/host APIs.
- CLI uses plural resources, `text replace`, shared flags/selectors, schemas and
  capabilities. CLI positions are scoped and one-based. The version-1 envelope
  has `version`, `operation`, `ok`, `data`, `warnings`, `errors`, `affected`,
  `locations`. Ordinary exits remain 0/1/2/3/4/130; diff uses 0/1/2/130.

Existing drift resolutions remain authoritative: `comment_id`/`timestamp`,
`table_direction`, `priority`, keyed style lookup, per-axis image DPI and the
documented nullable setter distinctions. No aliases or unsupported-as-private
reclassifications are introduced. Audit wording that SDK implementation is not
started still matches the actual tree. Earlier records describing independent
assertions as a later task remain historical; this record supplies the new state.

## Delivery

One atomic Conventional Commit on main containing only the two owned test files
and this record. Local hash is reported after commit. No push or release.

## Verification follow-up — 2026-09-14

Reviewed committed task `639229901`, its recorded red/green sequence above,
the actual assertion/fixture sources and fresh maintained runtime outputs.
The historical red runs are documented evidence, not newly replayed runs.
At 01:03:15 local the unchanged baseline passed all 43 tests. The helpers check
actual in-memory ZIP payloads and original XML/media/table data independently
of the product read path. The classifications and bounded profiles above remain
applicable; this review does not expand them into full schema validation.
Direct in-memory inspection of the museum output found a 3,133-byte ZIP with
eight method-8 (deflated) parts and a 62-byte BMP. The passing suite compares
all decoded payloads exactly to the authored part map and separately checks
the bitmap's original header/pixel values. No renderer was involved.

Found one concrete false pass in complete JSON absence checking: reserializing
parsed JSON escapes newlines, quotes and backslashes again, concealing forbidden
decoded strings. Added three original memfs cases, each checking a nested value
and a nested property key. At 01:03:26, before changing the helper, all six soft
negative controls failed with “expected [Function] to throw an error”; the
original 20 assertion tests still passed. Each case also checks that the raw
output lacks the decoded spelling and permits a truly absent phrase.

The correction walks parsed string values and object keys directly, preserving
whole-value equality and raw-output checking. No second document editor or
product behavior was added. At 01:03:41 the maintained focused suite passed
46 tests (23 assertions and all 23 unchanged original fixture tests), with
every individual test below 700 ms. Strict NodeNext typechecking of both assertion
files and their source imports passed. Prettier initially flagged the new test;
after formatting that owned file, the check passed for both files.
`npm run lint:eslint` completed with exit 0, 12,364 configured subjects linted,
zero errors and 12 unrelated unused-variable warnings in
`.cache/pptx-usage-review/example.mts`. The maintained guarded route has no
file-scope argument; no lint bypass or warning suppression was used.
Owned whitespace checks passed. No full workspace test/build pass is claimed.

Parsed all 920 API inventory records: 410 planned, 378 security-mapped,
124 language-mapped and eight documentation-error records. None is implemented
by these helper tests. The exact shared language/security decisions and resolved
documentation drift linked above remain unchanged. CLI/SDK consumers, schema
generation, capabilities, corpus edits and whole-public-API coverage remain
pending. No native reference build, downloads, networking, renderer, repair-warning
checks or visual QA ran; no CLI visuals changed. Only test helpers, original
regressions and this additive evidence record are owned by this correction.
