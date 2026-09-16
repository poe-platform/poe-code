# Input-aware capabilities evidence

Status: Bounded implementation verified locally; no release claim.

The [shared CLI contract](../specs/office-cli.md) requires optional input for
`capabilities`, explicit support levels, and matching discovery schemas/help.
The existing engine rejected the input with usage exit 2. Static feature records
also omitted levels or operation links. Original format-package and memfs Shell
regressions reproduce these failures before implementation.

## Register and language mappings

This receipt supplements the `capabilities` operation in
[command-coverage.json](command-coverage.json). It concerns the shared discovery
contract, not a port of a particular reference-runtime test. Original cases are
required even where the [test inventory](upstream-test-inventory.json) has no
corresponding CLI behavior.

The [API audit](upstream-api-audit.md), [API inventory](upstream-api-inventory.json),
[test audit](upstream-test-audit.md) and test inventory were read. All 2,409 API
identities still have entries in the 2,426-row command SDK register. Its 60
format-feature rows, 2,700 source unit variants and 973 BDD examples remain
accounted for separately. These totals establish accounting only. Historical
`not_implemented` and adaptation-not-started statements describe the research
checkpoint; later bounded receipts establish current behavior only where tested.

[J06/J08/J10](api-language-mappings.md) apply unchanged: input admission is async
through explicit capabilities; failures carry neutral stable codes and ordinary
Office exit statuses; CLI invokes the format-package SDK engine. Discovery does
not invoke creating model getters, mutate files, fetch relationships or execute
payloads. Neutral model method/property spellings are unchanged. Inherited,
underscore-prefixed, enum, helper, collection and untested public members are not
excluded from the remaining whole-API obligation.

## Remaining contract work

The current engine's feature-keyed object and `io` report predate the proposed
Appendix C feature-array/`host`/`detected`/`unknown` wire shape. This increment keeps
the existing consumer shape and supplies a schema for the actual result. It does
not certify full Appendix C conformance, all 60 feature families, every model API
route, or full semantic editing based on namespace recognition. The proposed
register remains a design authority; it is not substituted for executable schema.

No publisher deck, cloned binary or native Office runtime is needed for these
original reduced fixtures. No QA download was made or deleted. Test fixtures and
product wording are original; research identities remain outside product code.

The agent QA procedure and ownership are in
[the plan](../plans/pptx-input-capabilities.md).

## Implemented behavior and original acceptance

`pptx capabilities [INPUT]` accepts an explicit VFS path or `-` for stdin.
Without input it performs no I/O. `schema capabilities` describes the actual
eight-field envelope; `help capabilities` derives flags and description from
that declaration and explains scopes, limits, publication and support levels.
All 51 existing static capability entries now carry an explicit level and
nonempty operation links checked against the same operation registry as schema.
This is not a count of covered format features or public API members.

Input assessment lists package parts, namespace owners and unsupported content.
It inspects attribute namespaces and both compatibility choice/fallback branches,
including uppercase XML filenames. Unverified namespaces receive `preserve` with
an explicit unverified-semantics reason. Recognized namespaces receive `read`
with an inventory-only qualification. `complete` is always false. No relationship
is fetched, binary part decoded or XML content executed.

Observed signature/macro content types or paths, signature/macro relationships,
and presentation protection mark `xml.set` as affected. This is the tested
restriction subset; other operations are not exhaustively assessed. Empty
`affectedUnsupportedOperations` is not editing approval. The operation does not
certify package validity, safety, visual fidelity or full namespace semantics.

| Original test file                                                  | Independently asserted behavior                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/pptx/src/capabilities-discovery.test.ts`                  | 12 cases: input/no-input discovery, explicit unknown and attribute/fallback namespaces, three signature/macro/protection cases, inert signature relationship, cumulative XML nodes, cancellation, static operation links, closed emitted result schema, and inapplicable selector/limit rejection. VFS bytes remain unchanged. |
| `packages/safe-bash/tests/commands/pptx/capabilities-input.test.ts` | Three memfs Shell cases: quoted filename/stdin parity and no publication; original unknown namespace remains explicit; usage 2 before reads, invalid archive 1, I/O 3 and limits 4. No-input discovery reads nothing.                                                                                                          |

Limits may lower trusted ceilings only: `maxBytes`, `maxNodes`, `maxDepth`,
`maxOutputBytes` (minimum 512). `maxOutputs` and selectors do not apply.
XML bytes/nodes are charged cumulatively and cancellation is checked after
bounded asynchronous yields. Actual output remains bounded by the command engine.

Initial SDK discovery tests failed before production changes; all three Shell
tests independently reproduced the optional-input usage rejection. Subsequent
review added exact security-marker and budget cases. The first maintained build
identified omitted optional fields in the new capability interface; those were
fixed with typed fields. The first full unit run also exposed the newly added
relationship restriction before its implementation was complete. Final results
are recorded in the plan: 6,833 PPTX tests, three Shell tests, package lint,
maintained build closure and all 12,290 configured guarded ESLint inputs passed.

The maintained terminal renderer captured the actual built SDK's help and
inapplicable-selector error at `/tmp/pptx-capabilities-help.png`. Root opened and
inspected it: flags, limit names, scope, support distinctions and incomplete
assessment warning are readable without clipping; statuses are 0 and 2. This
is terminal QA, not presentation rendering. The screenshot stays disposable.
Its SHA-256 is `f2a6b0970de4e689f386014e1a8a7425994ed7e532222aae37a4e9952b2ea145`.
