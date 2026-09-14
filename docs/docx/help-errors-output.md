# DOCX discovery and diagnostic evidence

Current follow-up: [inspection/validation evidence](inspection-profile.md) adds
inspect and validate to root help/schema and exposes the core-v1 profile. The
record below preserves the earlier four-command discovery milestone.

This milestone implements help, schema, version and input-free capabilities in
the injected command engine. It does not implement document feature operations
or the documented object model. Later feature and exhaustive discovery tasks
remain pending. The original API inventory and model coverage statuses remain
unchanged; private-looking documented types are not hidden from targeted help.

## Maintained declaration and public behavior

`getDocxDiscovery(invocation, budget?)` is a synchronous read-only SDK operation.
The command engine invokes it for declared discovery operations. CLI parsing and
SDK validation retain the same operation IDs and camelCase option names. Root
help/schema list only the four implemented discovery operations. Explicit target
help describes declared flags and labels unavailable operations; targeted schema
uses `support: reject` and specifies failures without inventing success results.

Description, input fields, transport, feature IDs and discovery result schemas
are attached to the existing operation declarations. Help options and schema
inputs are derived from those fields. Discovery results retain the eight-field
version-1 envelope; schema always emits structured output, even without `--json`.
The version comes from the package's statically imported JSON metadata, inlined
by the existing root bundle. No runtime filesystem search is used.

Input-free capabilities reports effective limits and no document feature claims.
Its conservative host fields describe this engine: no document read/publication
implementation and an explicit binary-capable stdout sink. Document-specific
capabilities remain delegated to the injected handler. The full F01–F50 feature
assessment and model support register are still later tasks.

## Exact language and security mappings

- Discovery is synchronous and performs no input acquisition, mutation, clock,
  font, author, host filesystem or network discovery. Command stream writes stay
  async through the supplied byte sinks.
- Invocation validation rejects accessor-backed argument objects. Human fields
  use `toolcraft-design/escape-terminal-text`; C0/C1/DEL and bidi formatting
  controls become visible Unicode escapes, while ordinary Unicode is preserved.
- JSON retains original message data with JSON escaping. Binary handler output
  is forwarded unchanged. No banner, progress or second JSON value is appended
  after a stdout transport failure.
- Output limits apply before discovery returns in SDK and before CLI writes.
  Parsed help aliases retain their lowered budgets through private object-keyed
  provenance, without changing their public invocation option shape. The SDK
  combines that provenance with its host ceiling using the lower value.
- Human diagnostics are bounded in encoded bytes including prefix/newline and
  escape expansion. Long messages end with ` [truncated]`; tiny ceilings use
  `.`. JSON diagnostic framing is included when it fits; at ceilings smaller
  than the mandatory error-object framing, only the message fits the tiny
  allowance while the canonical envelope remains intact. This unavoidable
  framing overhead is distinct from document/result output.
- Existing parser usage/source/limit and diff exit mappings remain intact.
  Injected operation handlers retain responsibility for semantic results,
  postpublication failures and their existing statuses. No new operation editor
  or postpublication exception handler is added.

The model keeps the documented neutral names, inherited/collection/enum scope
and language/security decisions from the API reconciliation. This task adds no
model implementation evidence and adapts no reference binary or copied fixture.

## Verification

Final results and local commits are recorded in the
[owned task plan](../plans/docx-help-errors-output.md). Original regressions live
in `packages/docx/src/discovery.test.ts`, `command.test.ts`, the existing
safe-bash `docx-registration.test.ts`, and the design escaping leaf tests.
