# DOCX inspection and byte validation

This records the bounded inspection/validation utility milestone. It does not
establish a document object model, complete schema conformance, rendering or
editing support. Later tasks in the main implementation plan remain pending.

## Entry points and authority

`inspectDocument(input: Uint8Array, context: ArchiveContext)` always returns
`Promise<InspectionData>`. It admits owned package bytes, inventories the package
and hashes exact bytes with SHA-256. `validateDocument(input, context, options?)`
always returns `Promise<ValidationData>` and reuses `validateDocumentArchive`.
Byte admission proves the container check; the decoded-member API continues to
report that check unvalidated. Semantic failures return `valid: false` and
located diagnostics; malformed ZIP or unsupported container profiles throw the
existing neutral typed errors. No repair occurs.

`createDocxInspectionCommandEngine({limits})` plugs into the existing explicit
safe-bash `docxCommands({engine})`. Its request carries cwd, a scoped filesystem,
stdin/stdout/stderr, cancellation and optional cleanup registration. It calls the
same byte SDK. `DocumentIo.readBytes` collects owned bounded chunks without
admitting them, allowing validation to diagnose malformed document XML/graphs.
It retains the existing cleanup and reused-chunk guarantees.

There is no ambient filesystem, network, font, clock or identity lookup. External
relationship targets and field instructions remain data. Reads never call
creating header/footer/style getters. No product code writes source files.
There are no environment variables. Explicit archive limits and shared invocation
budgets bound input, expanded bytes, XML, retained buffers, work and output.

## Result interpretation

Inspection inventories the whole package. Selectors narrow command location
details, not package counts. Arrays are deterministic; relationships retain XML
order inside canonical owner order. Properties retain their owning part and
core/extended/custom group. Property values are typed, with invalid values null;
cached producer metadata is explicitly marked. Dates normalize to UTC ISO strings
without guessing a local timezone. This read-only surface reports writable false;
future property mutation APIs remain pending.

Counts cover active understood markup, including nested physical table rows/cells
and all inventoried stories. They do not count both MCE alternatives or fabricate
logical merged-cell copies. Image occurrences are distinct from stored media
parts. Note separators do not count as user notes. Annotation inventory includes
classic comments and tracked-change metadata; it does not interpret author/date
strings as instructions or create annotation models.

The public `InspectionData` extends the original base shape with these required
fields (also exposed by schema):

- `sizes`: exact archiveBytes, expandedBytes and mediaBytes.
- `contentTypes`: declared defaults and overrides in canonical order.
- `counts`: runs, rows, physical cells, sections, comments, footnotes, endnotes,
  fields, controls and equations in addition to paragraphs/tables/images and
  nullable cachedPages.
- `pages`: rendered is null; cachedBreaks counts stored layout break markers.
- `fonts`: references, themeReferences and embedded part names; installed is null.
- `signatures`: inventoried part names; verified is null. `signed` means presence.
- `media`: part records with names, declared content types, exact bytes and hashes.
- `annotations`: owning part, kind, ID, author and stored date (nullable metadata).
- `protection`: owning part, kind, nullable enforced state and edit mode; no
  password, hash, cryptographic parameters or verification claim is exposed.
- `warnings`: stable codes and bounded public messages. Partial validation,
  cached layout and font availability are always explicit; signatures, protection,
  invalid metadata and opaque extension warnings appear when relevant.

Properties additionally carry `part` and `group`. Story records carry the existing
fingerprinted locations, readonly properties/references and read support.
Feature levels describe only the named inventory subset. No absent tag proves
full support. Media types come from OPC declarations, not a decoder assertion;
image header characterization and resource editing remain later tasks.

## JavaScript and security mapping

This is an operation SDK: neutral camelCase operation data is separate from the
planned model's retained snake_case spellings. Bytes are Uint8Array; arrays are
readonly typed data, not Python collections or live model proxies. Part and
relationship object-model spellings remain unchanged. Inspection uses detached
records and existing generation-zero location tokens based on the input SHA-256.
Unknown rendered pages, installed fonts and verified signatures use null rather
than zero/false. Properties retain false/zero versus missing/invalid distinctions.

The existing model audit/inventory remains unchanged. No model getter, inherited
member, enum, helper, collection or public underscore-named type is relabeled
private or implemented by this task. Earlier documentation-error resolutions
remain authoritative; this utility introduces no accidental model aliases.

## Validation limits

`core-v1` remains partial. Exact check IDs and understood namespaces are exposed
in schema/capabilities. Protection enforcement, signature cryptography, extension
semantics and rendered layout remain unvalidated. A successful validation is not
a certification or a statement that arbitrary edits would be safe.

The command uses the shared version 1 result envelope and ordinary statuses.
Invalid validation has ok false and data null, with located errors; the direct
SDK retains the detailed failed report. Human output is a count/profile summary,
not a dump of document text, authors or external targets. JSON explicitly exposes
requested inventory data. Diagnostics go to stderr.

## Evidence

Original in-memory unit regressions cover minimal, complex, invalid, Strict and
template packages, nested tables/shared image occurrences, notes/comments,
revisions, protected/signed metadata, MCE, cached values and no network access.
Inputs remain byte-identical. New fixture mutations and command files use memfs.
Original tests were retained; no downloaded fixture or native reference runtime
is required. Maintained checks and visual review are recorded in the
[owned plan](../plans/docx-inspect-validate.md).
