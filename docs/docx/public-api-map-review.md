# DOCX public API map review

The [map](public-api-map.json) is a proposed TypeScript/CLI contract, not an
implemented SDK. It references the source revision
`e45454602b53e8e572b179ccf1c91093ec9f4ed7` and the hashed
[API inventory](upstream-api-inventory.json). It retains all 920 reconciled IDs,
including eight explicit documentation errors, and expands nested enum values
and returned protocols into individual rows. The 1,337 rows are an evidence
accounting snapshot, not a closed public-API denominator.

## Reading a row

`source` points to the pinned inventory and defining source location; inherited
members retain both the visible ID and canonical defining ID. `target` gives the
proposed TS signature, arguments/defaults, getter and setter types, execution
boundary and ownership. Type declarations use their `members` links to the
individual member rows; empty declaration bodies are notation for this register,
not proposed empty implementations. Workflow signatures are usage expressions.

`mapping_rules`, `errors` and `cli.contract` reference shared definitions in the
same JSON file. They are part of each row's contract. The proposed closed batch
schema includes typed argument fields, receiver handles, get/set forms and
results; it is research data, not an installed operation registry or executable
JSON Schema. Every future supported operation must have validated generated
schema/help and a capabilities disposition before it is advertised.

`original_tests` describes independent original acceptance cases and references
the shared case requirements. No test file or passing result is implied. All
1,609 unit variants and 650 BDD cases in the [test inventory](upstream-test-inventory.json)
remain unadapted. These source passes do not close target behavior. There are
zero `implemented` rows and zero passing target evidence records.

## Boundary decisions

- Factories, save and byte/image/part admission return Promise consistently.
  Live getters and model mutations remain synchronous. Input is copied owned
  bytes, an explicit byte source, or a capability-scoped VFS path. No raw path
  string grants filesystem authority.
- Model spellings retain neutral source names. This pin contains no keyword-only
  parameter group; any newly found group requires trailing typed source-spelled
  options. Positional optional parameters can be skipped with `undefined`.
  CLI/operation option fields remain camelCase. The reserved parameter binding
  `package` becomes `owner_package`; it does not create a member alias.
- Sequences use zero-based numeric lookup, `at`, iteration and length; source
  slicing is retained only where supported. Styles and relationships have keyed
  `at`; comments have nullable ID `get`. Relationship `get` and `items` retain
  their source names. The earlier research suggestions `getOrNull` and `entries`
  are superseded, with no parallel aliases added.
- Nullable reads do not imply nullable writes. Next paragraph style reads self
  as fallback but accepts null to reset. Latent default priority/load count can
  read and reset null. Defined-style flags reset to false; latent overrides retain
  null. Core revision can read zero but only accepts positive integer assignment.
- Units use safe integer EMUs and shared half-away rounding. Dates are copied UTC
  instants with whole-second serialization. Byte getters return fresh owned
  copies. Time, author policy, template, fonts, limits and VFS authority are
  explicit; source input acquisition never implies networking authority.
- Safe XML/part/relationship views preserve bounded observable behavior and
  validate mutations. Owner constructors and marshal lifecycle behavior map to
  admitted graph views and fixed validation, not dependency objects or caller
  callback execution. Underscore-prefixed public objects remain accounted for.
- Whole-model text assignment and clearing retain their destructive scope;
  `text replace` remains preserving replacement. Read-only CLI operations use
  noncreating queries where a model getter can create a definition/part.

## Drift and shared contracts

The [earlier reconciliation](upstream-api-reconciliation.md) retains all 23
source/documentation decisions. `Comment.comment_id` and `Comment.timestamp`
remain read-only; `id`/`date` are rejected, not aliases. Linked-image predicates,
per-axis image DPI, strict color parsing, Unicode property lengths and stale tab
views follow the explicit reconciled differences.

The [shared CLI spec](../specs/office-cli.md) controls plural resources, common
flags, one-based scoped selectors, JSON, publication and exit statuses. Its
`allowEmpty` takes precedence over the stale `allowMissing` phrase in DOCX §9;
the map records that correction without adding a compatibility spelling or
editing shared specifications outside this task. Ordinary direct operations
have adapters from flags to typed model behavior; advanced members use closed
batch IDs and explicit handles, never dynamic property invocation.

Source project identities occur only in research provenance and standalone
notices. Future implementations/tests/fixtures/output must use neutral names and
original content. Downloaded documents and reference binaries remain disposable
QA inputs; no such file is staged or promoted to a canonical unit fixture.

## Validation evidence

The [owned task record](../plans/docx-public-api-map.md) contains the agent QA
procedure and the pre-edit failure. Final documentary checks cover unique IDs,
all candidate and enum records, complete row fields, TS declaration parse
syntax, linked mappings/errors, guide accounting, source hashes, unchanged test
inventory and owned-file formatting. These checks validate the register only;
they do not establish runtime correctness, packed exports, complete schema
semantics, visual fidelity or corpus support. Those gates remain later tasks.
