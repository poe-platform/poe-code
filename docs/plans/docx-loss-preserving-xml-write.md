# DOCX dirty XML and part preservation

Scope: `loss-preserving-xml-write` only. Starting main revision:
`a6ce1ad1a719898230d2cb3adddcf841db1153ae`.

## Implemented boundary

The original `packages/docx` codec now exports `DocumentXmlEditor`,
`DocumentArchiveEditor`, and `UnsupportedEditError`. The shared XML parser and
ZIP codecs are unchanged. `documentXmlSettings` is an internal DOCX helper reused
for early configuration validation; root exports only wire the new codec types.

`DocumentXmlEditor(bytes, limits?)` acquires owned bytes through the existing
namespace-aware, bounded parser. It indexes the original lexical source against
all ordered parser tokens, including document siblings. A mismatch rejects;
there is no serialization from an element-only projection. UTF-8, UTF-8 BOM,
UTF-16LE BOM and UTF-16BE BOM retain their encoding, declaration and exact
unselected lexical payload. CRLF, character-reference spelling, quote choice,
attribute order, namespace declarations, unknown wrappers/descendants, comments,
processing instructions and significant whitespace are retained.

Supported mutations are `setText(node, text)` for a single existing ordered
text/CDATA/comment/PI token and `setAttribute(element, qualifiedName, value)` for
an existing non-namespace attribute. Attribute selection uses the original
qualified name and preserves its resolved namespace; no prefix rebinding occurs.
The complete candidate is parsed and checked against configured XML limits before
a mutation is accepted. A failure restores all previously accepted edits.
`dirtyNodes` reports distinct directly edited nodes in first-active-edit order;
resetting a value to its original decoded value removes its patch and restores
its exact original lexical bytes. `serialize()` returns an owned byte copy.

The `root` is an immutable **source snapshot**, not the later live model XML view.
Node identity belongs to this editor; foreign nodes reject. Arrays, attributes
and nodes are frozen. Native Map contents cannot be made immutable with
Object.freeze; namespace maps are checked against private copies before any
serialization, including no-op serialization. Direct tampering cannot silently
alter namespace meaning or drop descendants.

Whole-element text replacement, structural insertion/removal, attribute
creation/removal, namespace changes and arbitrary tree replacement are not
provided by this codec. CDATA/comment/PI edits that would change token kind or
lose data through XML normalization reject. Those cases include CDATA terminators,
comment double-hyphens/trailing hyphens, PI terminators/leading data whitespace,
and literal CR in CDATA/comment/PI data. Ordinary text and attributes escape CR
as a character reference; attribute TAB/LF are escaped too. Empty PI insertion
adds a separator without changing its target. Invalid XML scalars, including lone
JS surrogates, reject before TextEncoder can replace them.

`DocumentArchiveEditor(archive, limits?)` owns an existing admitted archive's
payloads, metadata and comment. XML parts are parsed lazily by exact member name;
unopened opaque parts are never decoded. `xml(name)` returns the same editor on
repeated access. `dirtyParts` follows input member order. `snapshot()` returns
owned copies and serializes edited XML only; clean parts retain their exact
uncompressed payloads. Opening an XML part for inspection does not dirty it.
A fresh snapshot is independent of caller mutations to input or previous output.
The existing bounded `writeArchive` remains the sole ZIP writer.

This is a low-level codec, not a complete safe document mutation operation. It
accepts already acquired archives, does not enforce semantic WordprocessingML,
MCE selection, signatures/protection or relationship mutation policies, and does
not publish. Admission, those semantic gates, aggregate invocation budgets and
capability-scoped publication must surround it in the later operation engine.
No new filesystem/network/clock authority, environment variables, dependencies,
CLI commands, schemas, help, model factories or generic dispatch were added.

## Limits and language/security mappings

The constructor and every staged candidate use the existing `DocumentXmlLimits`
settings/defaults from the namespace-reading task: 32 MiB XML bytes/text,
256 depth/namespaces, 2,000,000 element/content/attribute counts, 128 attributes
per element and 512 Mi parser-work units. Output byte size includes escaping and
encoding. An oversized supplied string rejects before escaping; the candidate
must also satisfy cumulative text, bytes and parser-work ceilings. Limits are
trusted codec configuration, not untrusted CLI overrides. Unknown keys, nonobject
configuration and nonpositive/unsafe numeric limits reject. Undefined optional
values use defaults.

The source index and patch application are bounded by admitted bytes/nodes;
patch ordering is bounded by the number of original tokens. These synchronous
operations do not claim cooperative cancellation, invocation-wide work/retained
accounting or a wall-clock SLA. The later context/transaction task remains
responsible for cumulative budgets over repeated edits and multiple parts.

| Boundary | Exact JS disposition |
| --- | --- |
| XML/package bytes | Owned `Uint8Array`; synchronous in-memory codec; `writeArchive` remains always-async with caller sink/context. No path or stream guessing. |
| Selection | Original object identity for XML tokens; exact qualified string for existing attributes; exact archive member name for parts. No XPath, callback registry, dynamic classes or native XML runtime. |
| Collections | Readonly arrays, zero-based lookup, `.length` and standard JS iteration; namespace scopes are `ReadonlyMap<string,string>`. Codec source snapshots are not live model handles or CLI location tokens. |
| Values | Strings only, including empty strings; null/undefined/numbers/booleans are not coerced. XML scalar checks precede encoding. Source text/tail becomes distinct ordered text tokens, never concatenated across element boundaries. |
| No-op | Decoded original values restore original lexical spelling. Unedited XML and opaque payloads retain exact original bytes. No pretty printing or whitespace stripping on save. |
| Errors | InputTypeError/InvalidValueError → `usage` (future ordinary exit 2); InvalidXmlError → `invalid-xml` (1); UnsupportedEditError → `unsupported-edit` (1); ResourceLimitError → `limit-exceeded` (4). Messages contain no source document text. |
| Authority | No ambient filesystem, networking, external target resolution, macros, field execution, default author/time or native reference execution. |

Read the root AGENTS.md, DOCX/shared CLI/shared SDK specifications, API audit,
920-record inventory, XML/package mappings in the API reconciliation, and the
77 crosswalk rows assigned to this task. No applicable scoped AGENTS.md exists
under `packages/docx` or `docs`. Neutral model spellings, inherited members,
enums/helpers/collections and APIs without source tests remain required. Public
`.element`, `._drawing`, `.part` and underscore-prefixed types remain public
pending obligations; this low-level snapshot is not reported as their completion.

## Crosswalk and documentation drift

Historical audit/inventory files remain unchanged. Their suggested implementation
path `packages/office-package/tests/loss-preserving-xml-write.test.ts` is superseded
for this bounded codec by `packages/docx/src/xml-write.test.ts`.

The crosswalk's broad descriptor/child API assignments are not evidence of passing
model coverage. One-based row dispositions within this task's 77 rows:

- Rows 1–22: ordered child lookup/insertion/removal remain pending structured XML
  views and model editing; this task rejects structural changes rather than
  claiming child-transition parity.
- Rows 23–24: saving uses owned bytes and preserves lexical XML/Unicode. Pretty
  display remains a later `xml get --pretty` concern; it must not become the save
  serializer. Original encoding/no-op tests cover the byte/Unicode preservation
  invariant, not native pretty-printer identity.
- Rows 25–35: private line parsing/equality machinery is not a product API.
  Original tests compare each uncompressed payload and the exact expected edited
  XML, separately from ZIP metadata. No line-based equivalence routine is copied.
- Rows 36–77: generated descriptors, child choices, creating getters, required/
  optional attributes and their domain-specific validation remain pending in
  structured creation/model/XML-view work. This task's string attribute update
  and coercion regressions establish codec safety only, not those typed setters.

This clarifies ownership drift without removing records or promoting pending
public API behavior to passes. The shared contracts still require plural
resources, `text replace`, common selectors/flags/versioned envelopes/statuses,
schema/capabilities, and direct or typed batch access to supported model behavior.
No alternate CLI surface or model alias is introduced. Every later pipeline task
remains pending. The already modified main pipeline plan is unrelated owned work
and is not included in this commit.

## Red/green evidence and verification

All tests are original, deterministic and independent of downloads. File
mutations use memfs. Existing original test/fixture files are unchanged.

- Initial 12 preservation regressions failed before writer code existed:
  `/tmp/docx-xml-write-red.log`.
- The first implementation exposed lone-surrogate replacement. Additional tests
  reproduced missing PI separation and an attribute handle masquerading as text
  (three failures before fixes): `/tmp/docx-xml-write-boundaries-red.log`.
- Seven archive-editor configuration cases failed before extracting shared DOCX
  settings validation: `/tmp/docx-xml-write-options-red.log`.
- The shared unsupported-edit code regression failed before adding the proper
  error category: `/tmp/docx-xml-write-error-red.log`.
- Complete original package tests initially rejected fixture ZIP extra fields
  because their test context allowed zero bytes; the test context now admits
  the fixture's existing metadata. No product admission check was weakened.
- Final focused suite: 27 cases passing, including no-op and targeted edits in
  original Transitional, Strict and template packages, all-part byte comparison,
  both stored/deflated repacking, opaque invalid-XML/binary retention, UTF encodings,
  namespaces, lexical resets, mixed content, failed staging and ownership.

Maintained checks passed:

- `npm run build:workspaces -- --workspace=docx`: the declaration-derived
  three-package build closure passed; `/tmp/docx-xml-write-build.log`.
- `npm run test --workspace=docx`: all 235 tests across eight files passed;
  `/tmp/docx-xml-write-tests.log`.
- `npm run lint --workspace=docx`: ESLint plus production and test TypeScript
  checks passed; `/tmp/docx-xml-write-lint.log`.
- A built ESM consumer verified both editor exports, exact opaque-subtree
  preservation, the unsupported-edit error and an empty archive snapshot.
- `git diff --check`: passed.

Scope is DOCX-only, so the maintained package checks were selected. Shared
codecs and consumers were not changed. No CLI visual behavior changed, and no
renderer or screenshot fidelity pass is claimed. No downloads, native reference
builds, ignored fixtures, generated dist files or unrelated work are included.
The implementation and this plan form one owned atomic improvement on main.
No push or release is authorized or performed.
