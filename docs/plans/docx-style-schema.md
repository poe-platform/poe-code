# Style formatting schema integration

Owned integration: operation declarations, transport types, value validation,
formatting option validation, JSON schema and discovery metadata, plus original
style-formatting schema and command tests. Domain implementation belongs to the
parent task; no separate commit or push is made by this delegate.

Read root instructions, format/shared contracts, API/test audits and relevant
inventory records. The operation API uses camelCase JSON fields and ordinary
plural CLI resources; documented neutral object-model spellings remain reserved
by their existing explicit declarations. No model implementation is inferred
from utility coverage. Nullable booleans distinguish inheritance from false;
latent priorities are bounded integers, tab deletion is signed zero-based index,
and insertion uses typed units with JSON transport for its structured value.
Style visibility remains `hidden`; font visibility is `fontHidden`, avoiding a
collision with the style's metadata. CLI and SDK share the same declarations.

## TDD evidence

- Initial new schema suite: 18 failures (unknown flags, missing latent routes,
  missing tab edit options), observed before implementation.
- Added discovery assertion then observed advertised latent editing rejected.
- Updated declarations and closed result schemas: 19 new schema tests pass,
  together with 17 original schema tests; package TypeScript build check passes.
- Three original memfs command tests initially failed: missing latent dispatch,
  extended style dispatch rejection, and unnormalized tab insertion JSON.
  Parent owns dispatch and normalization implementation against these cases.
- Existing command and JSON-schema suites pass (60 tests). The existing discovery
  suite has two exact-list expectations requiring seven new latent paths; parent
  notified to update these owned expectations.

## Agent QA procedure

Run package lint and maintained package unit route after delegated files converge.
Inspect CLI help screenshots for styles latent set and styles set; verify flags
are readable and JSON stdin/stdout contracts remain intact. Do not download or
execute reference runtimes and do not use ambient filesystem I/O in tests.

## Integrated validation

Parent implemented latent dispatch and tab insertion normalization. Original CLI
suite then isolated missing CLI declarations for all 15 added font flags. Expanded
the schema test to CLI, SDK and batch transports, observed 15 failures, added the
missing fields and reran: 19 schema, 3 CLI and 8 discovery tests pass. Parent
assigned discovery expectations to this delegate; updated both exact command
lists after observing their failures. No expected behavior was removed.

A full maintained package unit run and lint were launched after convergence of
utility edits. At that point the concurrently authored formatting model tests
were awaiting their implementation/types; failures were reported to that owner.

## Live model batch integration

Parent delegated a typed batch executor and command receiver validation. Added
original failing memfs cases for owned handles, live font/tab edits, latent
metadata, concrete subtype checks, RGB/theme colors and opaque inherited
part/XML handles. Execution uses an explicit operation registry and constructor
checks before every property or method. No caller-selected member is reflected.
Only registered property names are accessed; all public outputs encode model
references as owned opaque handles, never storage objects.

Root bootstrap follows the declared `DocumentModel` receiver, including reserved
`document` reference. Known unsupported operations raise unsupported-profile;
invalid/foreign handles are usage failures. Existing declared style-class result
narrowing is admitted only for the enumerated style inheritance family; concrete
runtime checks reject invalid narrowing. Character formatting uses the declared
`model.text.run.Font` operation IDs. Inherited XML/part getters return opaque
handles; unrestricted XML mutation is not enabled by these operations.

Extracted the registry into a module independent of command validation to avoid
command/discovery cycles. Added closed batch/per-operation result schemas and
bounded discovery of supported model IDs; unrelated model operations stay
rejected. Maintained unit route passed 49 suites and 1,101 tests at this stage;
subsequent sixth batch test also passed. Parent/other worker lint issues were
reported to their owners. No commit or push was performed by this delegate.

## Helper and declaration reconciliation

Added checked length and formatting-enum batch operations using the owned model
helpers. Length results serialize as `{value: emu, unit: "emu"}`; no numeric
coercion or prototype-dependent behavior crosses the transport. Enum member maps
serialize as ordered `{key, value}` entries and support declared string-key
selection. XML/part identity remains opaque, and arbitrary XML mutation is still
outside this batch subset. Lookup warnings propagate to the command envelope.

Source-nullability reconciliation updates `name` and `style_id` getters/setters
for all five style classes, including inherited rows. Original assertions first
rejected null; declarations and types now retain it. Formatting enum alias
objects retain canonical identities: `MSO_THEME_COLOR_INDEX` admits the canonical
`MSO_THEME_COLOR` symbol and `WD_ALIGN_PARAGRAPH` admits
`WD_PARAGRAPH_ALIGNMENT`, while existing typed alias spellings remain accepted.
An original failing alias assertion preceded matching validator/schema/type edits.

A registry assertion prevents nonexistent helper operation IDs from being
advertised. Existing root command discovery retains its exact direct route list
and separately exposes the supported typed model declarations. Warning results
use the closed `{code,message}` shape. Final maintained test/lint runs were
launched after these changes; parent receives the completion results separately.

## Handle lifetime verification

A final original failing test demonstrated that a guessed nonroot literal ID
could collide with a handle allocated by the current batch. The bounded executor
now accepts nonroot receivers only through named results from the current batch;
opaque descriptors in output are informational and cannot be replayed as new
literal authority. The reserved initial `DocumentModel` root remains the only
admitted literal bootstrap. This removes cross-document ID collisions without
adding ambient randomness or persistent handle state. Nine batch tests and two
batch CLI tests pass after this correction; package TypeScript checking passes.
