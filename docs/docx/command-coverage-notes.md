# DOCX command coverage review

The [command register](command-coverage.json) maps all 50 format features and
all 1,337 rows of the [public API map](public-api-map.json). Its scope includes
all 920 reconciled inventory records, 262 individual enum values, inherited
members, returned interfaces, collections, helpers and guide workflows. These
are documentary accounting denominators, not implementation coverage.

Every operation is **planned**, with zero passing target evidence. The register
does not install commands, generate executable JSON Schema, implement an SDK or
adapt the reference tests. All 1,609 unit variants and 650 expanded BDD examples
remain unadapted in the unchanged [test inventory](upstream-test-inventory.json).
Their recorded reference passes do not count as product passes.

## Reading the register

`features` preserves each F01–F50 requirement, links its direct commands and
related SDK rows, and names original acceptance cases. `operations` defines
exact paths, operation IDs, argument fields/types, option profiles, result and
publication contracts, and proposed help/schema requests. `sdk` accounts for
every API-map row and links its exact signature, defaults, ownership, effects,
errors and original cases through `apiContract`. Local operation references use
JSON pointers. The referenced contracts are part of the mapping, not optional
background reading.

Argument schemas here are closed **typed documentary contracts**, not executable
JSON Schema. Runtime schema generation and validation remain later work. Named
model types resolve through the linked API contracts; input encoding, enum/unit
encoding and capability handling are specified under `schemaEncoding`. Every
batch operation has a fixed discriminator, typed arguments and receiver rules.
Unknown fields and arbitrary method/property dispatch are forbidden. Commands
that acquire independent inputs or publish multiple files cannot be nested in
batch. Model saves stage output for the one final publication.

The shared [CLI](../specs/office-cli.md) and [SDK](../specs/office-sdk.md)
contracts remain authoritative. Direct common edits have flags, including text
replacement, images, properties, paragraph/run formatting, sections and tables.
Advanced behavior has discoverable typed batch operations. Model spellings stay
neutral and source-spelled; operation arguments use camelCase. The register
includes ordinary-edit examples and a complete typed-handle outline-formatting
example, all proposed acceptance targets.

Five additional typed format operations cover paragraph borders/shading,
script-specific fonts/languages, multilevel numbering, explicit section columns
and linked/default styles. These extend the format coverage beyond the reference
model and have their own argument contracts and original acceptance cases.

`languageMappings` carries the exact JS/security decisions from the API map:
async admission/save, synchronous model access, defaults/null/false/zero, indexed
versus keyed collections, units, enums, owned bytes, UTC dates, neutral errors,
explicit context and bounded XML/package views. `sdkBehaviors` gives these
decisions command routes and independent tests. Type/alias/error discovery does
not invent editable constructors. Public underscore-prefixed interfaces remain
accounted for and their members remain reachable.

## Command reconciliation

The existing API map is retained as research evidence. This register refines its
provisional `cli` fields; `documentationDrift.commandResolutions` records the
specific evidence and decisions:

- Combined paths such as `create / inspect` become separate commands. Property
  reads and writes have separate closed model IDs and argument/result contracts.
- Error types are neutral schema/result contracts. A source-branded error ID
  does not become an executable operation or appear in proposed CLI output.
- XML view text/tail setters remain available despite null getter/setter fields
  in their earlier rows; the explicit signatures determine both forms.
- Guide workflows compose real commands/member operations. Empty synthetic
  workflow operations and synchronous labels for I/O do not become promises.
- `allowEmpty` and `--allow-empty` override the stale `allowMissing` wording in
  DOCX section 9; no compatibility alias is added.
- Owner-bound interfaces are discovered through schemas and the live graph.
  Ordinary inspection uses noncreating queries; explicit model getters retain
  documented creation effects and require publication when mutating.
- Indexed getters retain their index arguments. Only Sections, rows and RGB
  colors acquire the documented slicing route. Keyed lookup remains distinct.
- Static factories and enum-type protocols require no fabricated instance.
  Fixed operation IDs identify the declared type, without dynamic lookup.

The 23 prior source/documentation resolutions remain linked in full, including
comment_id/timestamp, style spelling/lookup, image DPI and linked-image behavior.
No source project names are proposed for product code, tests, fixtures or output.

## Preservation and evidence

`preservationOnlySubsets` distinguishes opaque content from supported edits.
Charts, diagrams, complex revisions, native media/fallbacks, unsupported shape
geometry, embedded objects and opaque custom XML/fonts/settings map to inventory
and retention cases. Extraction does not imply semantic editing. Documented
settings and declared binding edits retain their narrow supported subsets.
Signature stripping is explicit and makes no verification/regeneration claim.

Each F-row has a specific original fixture scenario in addition to paired
CLI/SDK and retention assertions. API cases retain the existing per-member
defaults, effects and language/security requirements, including APIs without
reference tests. The tests are specifications, not files or claimed passes.
Implementation must first observe failures in original small memfs/value tests.
Downloaded documents and reference binaries remain disposable offline QA inputs;
no acquisition, runtime execution, cleanup or corpus campaign occurred here.

The [owned task record](../plans/docx-command-coverage.md) contains the agent QA
procedure and documentary check results. Later implementation, screenshot,
packed-consumer, source-test adaptation and corpus gates remain pending.
