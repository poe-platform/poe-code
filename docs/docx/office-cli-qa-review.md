# DOCX paired Office QA contract review

Status: Documentation reviewed on 2026-09-13; all DOCX recipes remain proposed
and unexecuted. Existing partial PPTX execution is recorded separately in its
[receipt](../pptx/office-cli-execution-20260913.md). No product behavior is
implemented or verified by this review.

The [paired Markdown procedure](../plans/office-cli-qa.md) follows root AGENTS.md;
no scoped AGENTS.md exists under docs. The shared [CLI](../specs/office-cli.md)
and [SDK](../specs/office-sdk.md) contracts govern common behavior; the
[DOCX specification](../specs/docx.md) adds format requirements. Ownership is
limited to that procedure and this evidence. No README, product source, tests,
inventories, specifications, publisher documents or cloned binaries were changed.
No native/reference runtime, implicit network or document host I/O was used.

## Inputs and accounting

Both complete inventories were parsed, including all source cases, inherited
members, returned interfaces, enum values, helpers and collection protocols.

| Input                                          | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [API audit](upstream-api-audit.md)             | `45d96a1bff39d66994194d1c8d66572b0869438d514bd7735465e79d733b9e8a` |
| [API inventory](upstream-api-inventory.json)   | `10955a17b17ac1b334c5854ce7048970f9033ddb0408322bef3e3586d19e44ac` |
| [Test audit](upstream-test-audit.md)           | `63929ceb2e04c57e71cea5dfff379a8f063db103413d89ac0913229e5739d63f` |
| [Test inventory](upstream-test-inventory.json) | `14c609ceb775158cb36c0423d24678b4a3e9f09d429085730b28103a759ad797` |
| [Target API map](public-api-map.json)          | `b5d04eb79f7b24f00fee4abffef9f0a78998a02dfbadb0b2d009b68051dd87b1` |
| [Command register](command-coverage.json)      | `aee52f53c8d4a20e1fb1c2351816801c354f570a11c7a2f68cf607f85631cc06` |

The pin remains `e45454602b53e8e572b179ccf1c91093ec9f4ed7`: 920 API research
records, 262 nested enum values, 11 enum type aliases, 23 documentation/source
resolutions, 1,337 target-map rows and 50 feature mappings. These are different
accounting sets, not additive implementation counts. All 1,609 unit variants
and 650 expanded BDD cases remain `unmapped_not_implemented`. No API without
source tests is excluded; its original acceptance evidence is still required.
Public underscore-prefixed types remain in scope, including returned `_Text`
and `_Cell`; their spelling never establishes privacy.

The [reconciliation](upstream-api-reconciliation.md), [API-map review](public-api-map-review.md)
and [command review](command-coverage-notes.md) are existing local evidence.
This task does not repeat published-source research or certify today's upstream
site. Source-test audit passes remain historical reference results only.

## Exact JS and security mappings

These decisions come from the target map's `mapping_rules`, `errors` and the
command register's `languageMappings`. They are proposed target contracts, not
verified exports. Each member's target/default/read/write/error/ownership row
remains authoritative for its specific allowed subset.

| Mapping               | Exact target behavior used for DOCX QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M-KEYWORDS / M-CLI    | Retain neutral model spellings such as `add_paragraph`, `core_properties`, `comment_id`, `timestamp`. Preserve positional order; skip optional positions with `undefined`. No keyword-only group occurs in this pin; future groups use trailing typed source-spelled options. Reserved parameter `package` binds as `owner_package`. Operation arguments/options separately use camelCase. No blanket model aliases or evaluated member strings.                                                                                                                                                                                                                                                                   |
| M-VALUES              | Required `undefined` rejects; optional omission uses only its declared default. Null is admitted only by the specific union and differs from false, zero and empty string. No coercion. Formatting flags are boolean/null; underline also admits its typed enum. Core string bounds count 255 Unicode code points, including astral characters once. Nullable getter types do not automatically permit nullable setters.                                                                                                                                                                                                                                                                                           |
| M-SEQUENCE / M-KEYS   | Checked zero-based numeric lookup, live length and `Symbol.iterator`; `.at(-1)` resolves the last sequence item, out-of-range throws `BoundsError`. Sections, rows and RGBColor alone have the documented slice profile: normalized/clamped endpoints, exclusive end and no mutation. Styles/latent styles use string keys; relationship `at(rId)` throws, `get(rId, default_value?)` returns null/default, and `items` retains its spelling. Comments use nullable ID lookup. CLI ordinals remain one-based within owners.                                                                                                                                                                                        |
| M-UNITS               | Immutable Length/Emu/Inches/Cm/Mm/Pt/Twips with safe integer EMUs: 914400/in, 360000/cm, 36000/mm, 12700/pt, 635/twip. Convert once, nearest with half ties away from zero; reject nonfinite/unsafe ranges before and after conversion. Twips accessor uses that rounding. Property-specific negative bounds apply. Numeric line spacing means a multiple; Length means distance. No DOCX centipoint helper is invented.                                                                                                                                                                                                                                                                                           |
| M-ENUM / M-COLOR      | Preserve every documented symbolic value and alias with immutable typed identity; validate membership and setter subsets separately. `from_xml`/`to_xml` reject unmapped values. RGB channels are integers 0..255; `from_string` accepts exactly six ASCII hex digits, case-insensitively, and rejects whitespace, signs and prefixes. String output is six uppercase hex digits.                                                                                                                                                                                                                                                                                                                                  |
| M-BYTES / M-DATES     | Copy Uint8Array before first suspension and each source chunk before next pull; reject detached or shared/racy buffers, return fresh byte copies and account retained copies. Clone Date on admission/get/set; reject invalid assigned dates; normalize UTC and drop fractional seconds, including pre-epoch instants. Invalid/missing source dates return null with diagnostics. No ambient time or timezone guessing.                                                                                                                                                                                                                                                                                            |
| M-IO                  | `Document(input?: Input \| null, context?: DocumentContext): Promise<DocumentModel>`; `Input` is Uint8Array, explicit ByteSource or scoped VfsPath. Omission/null selects original template creation. `save(output: ByteSink \| VfsPath): Promise<void>` and all image/part admission are always async, even for bytes. ByteSource supplies an async byte iterable; ByteSink stages/commits/aborts owned output. Model access/admitted metadata stay synchronous. Raw path strings grant no authority.                                                                                                                                                                                                             |
| M-CONTEXT             | Context explicitly carries VFS, limits, signal, timestamp, author, fonts and template. Empty context grants no host I/O. Creation/comments requiring time reject missing time instead of reading the clock. Source author defaults remain empty strings unless the operation explicitly chooses context author. Admitted metrics replace host font discovery. No network, runtime, identity or template discovery.                                                                                                                                                                                                                                                                                                 |
| M-OWNERSHIP / M-VIEWS | Live handles share owner/revision; snapshots hold live handles. Deleted/replaced nodes invalidate handles; explicit import is required across owners. Tab-stop movement keeps the tab handle but invalidates detached node views. XML/part/package/relationship access exposes bounded owner-aware views with validated namespace/graph mutation. No arbitrary XPath, eval, prototype dispatch, dependency objects, marshal callbacks or external relationship dereference. Read-only CLI queries avoid creating getters.                                                                                                                                                                                          |
| M-IMAGES              | Bounded characterization of PNG, JPEG JFIF/Exif, GIF87a/89a, BMP and both-endian TIFF. Native width/height use per-axis DPI, with missing-axis fallback 72. One dimension preserves aspect; two set extents; numeric dimensions are integer EMUs. Linked-only `.image` fails without fetching. SHA-1 is compatibility metadata; SHA-256 is integrity/evidence identity. No native decoding.                                                                                                                                                                                                                                                                                                                        |
| M-ERRORS              | InputTypeError/TypeError and InvalidValueError/RangeError use `usage`, exit 2. BoundsError/RangeError and MissingKeyError/Error use `missing-selection`, exit 1. OwnershipError uses `conflict`, StaleHandleError uses `stale-selection`, SemanticValidationError uses `invalid-package`, all exit 1. ResourceLimitError uses `limit-exceeded`, exit 4. SourceError/SinkError/PermissionError and PublicationError use their source/sink/permission/unsupported-publication codes, exit 3. CancellationError uses `cancelled`, exit 130. Nullable lookup remains null; messages are bounded and neutral. Diff overrides shell translation: equal 0, different 1 with successful data, failure 2, cancellation 130. |

Model whole-text setters and clear operations retain their destructive scope;
Q12 tests whole-cell assignment. Q04 tests the distinct preserving `text replace`.
Every supported public behavior must remain reachable through direct flags or
closed typed batch operations and generated schema/help/capabilities, including
inherited members, enums, helpers, collections and APIs with no reference tests.
Unsupported public behavior stays visible and prevents whole-API claims.

## Documentation drift and remaining contract gaps

| Evidence                                                                      | Resolution for this task                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paired plan linked only PPTX registers/review and directed all evidence there | Add DOCX links and route DOCX evidence to docs/docx; preserve existing PPTX receipts and their limited execution status. Q42–Q49 are unrun for both formats.                                                                                                                                                                                                                                |
| Earlier audit calls concrete API/command mapping the next task                | The later local maps now contain documentary mappings. Read those proposals without promoting their unwritten acceptance cases to passes. No later implementation task is executed here.                                                                                                                                                                                                    |
| DOCX §9 says `allowMissing`                                                   | Shared contract wins: use `allowEmpty` / `--allow-empty`, never an alias. Missing-match Q33 checks the shared behavior. This evidence resolves recipe interpretation without revising the specification in this task.                                                                                                                                                                       |
| Earlier generic keyed/collection suggestions                                  | Use the later map's `at`, `get`, `items` and per-type slicing, not obsolete `getOrNull`/`entries` aliases or slices on every collection. Preserve all 23 source/documentation decisions, including comment_id/timestamp, style ownership, strict color parsing and per-axis DPI.                                                                                                            |
| DOCX template data type has no concrete field definition                      | `template.apply` names `DeclaredTemplateRecord` and a record array; this is not an executable schema. Block Q17/Q44 binding setup and ambiguity/expansion cases until fields and binding semantics exist. Do not copy the PPTX Bindings payload.                                                                                                                                            |
| Similar batch syntax suggests identical advanced schemas                      | Q18 has only shared properties.set arguments name/value and the version-1 envelope; these fit both proposals. Advanced receiver/option placement needs each generated schema; no arbitrary invocation or per-item publication is implied. Unknown fields/versions must fail at runtime; this review does not prove that behavior.                                                           |
| Bare creation versus explicit timestamp requirements                          | Fix fixture setup time explicitly. No-argument factory spelling is valid, but DOCX time-requiring creation may reject absent context. Q01 cannot pass by silently taking host time. The eventual schema/implementation must make deterministic creation policy explicit.                                                                                                                    |
| Counterpart SDK language details differ                                       | PPTX proposes step-aware slicing and differently named neutral error classes; DOCX currently records endpoint slices and the classes above. Shared categories, option semantics and exits govern paired checks. Uniform shared language mapping still needs reconciliation where observable semantics differ; do not silently copy either format's details or claim cross-tool conformance. |

## Validation boundary

The plan records the failing pre-edit documentary assertion and the agent QA
procedure. Documentation checks cover source hashes, complete inventory counts
and unchanged statuses, mapping links, recipe IDs, literal shared batch fields,
local Markdown links, scoped maintained formatting and Git whitespace checks.
Actual final check results are recorded after execution below.

- Passed the corrected pre-edit assertion: DOCX register/review links exist and
  evidence routing is format-specific.
- Parsed and checked all counts/statuses above; all 16 language mappings match
  between the DOCX API map and command register. All six input hashes match.
- Parsed the two Markdown documents: 49 unique recipe IDs Q01–Q49 and 24 local
  file links resolve. Q18's literal version/envelope/operation/name/value fields
  match both documentary contracts; this is not DOCX runtime schema validation.
- Scoped installed Prettier and `git diff --check` passed for the owned files.
  No product build/unit/ESLint/runtime gate is applicable or claimed as passed.

No CLI recipe, SDK runtime, screenshot, source suite or product test ran. No
document or binary was acquired, opened or deleted. Future product changes must
first reproduce failures in original small memfs tests. Meaningful publisher or
clone cases must be reduced before cleanup; provenance and independent expected
results survive, downloaded content does not become a canonical fixture.
