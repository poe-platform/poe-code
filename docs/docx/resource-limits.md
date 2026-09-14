# DOCX invocation resource accounting

The package primitives share `DocumentBudget`. This implements the resource
foundation in specification section 7. It does not implement the later CLI,
document model, diff or ordered-batch operations. Their adapters must reuse this
ledger; creating a budget for each step would violate the invocation contract.
No environment variables, configuration files, host filesystem or networking
are used.

## Host and operation boundaries

`new DocumentBudget(hostLimits?, signal?, yieldTurn?)` establishes trusted host
ceilings. The host can explicitly raise defaults for a qualification profile.
`budget.lower(operationLimits)` validates operation overrides and returns a view
of the same counters. It rejects unknown names, accessor properties, nonnumbers,
nonfinite/fractional/unsafe values, negative values and increases. Zero is allowed
only for media bytes, matches, inserted nodes and batch operations. All other
ceilings require positive capacity. Limits and usage snapshots are immutable.
Validate these options before acquiring any input.

The existing `ArchiveContext.limits` is an explicit **trusted host** codec
configuration, not an operation options object. Without a supplied budget its
archive/expanded/member/retained values establish the corresponding ceilings for
that primitive invocation. With a budget both bounds apply; legacy codec values
cannot widen its ceilings. Pass `context.budget` through every phase of a larger
invocation, and pass the same budget to XML parsing, editors and validation.

| Public name | Default | Scope |
| --- | ---: | --- |
| compressedInput | 67,108,864 | Per acquired document |
| expandedPackage | 268,435,456 | Per acquired document |
| zipEntries | 10,000 | Per document |
| xmlPartBytes | 33,554,432 | Per XML part |
| xmlNodes | 2,000,000 | Cumulative parsed elements, attributes and retained content nodes |
| xmlDepth | 256 | Per XML tree |
| embeddedMediaBytes | 67,108,864 | Per media item, also within expanded/retained bounds |
| retainedBytes | 536,870,912 | Invocation reservations, including copies |
| serializedOutput | 268,435,456 | Invocation serialized archive output |
| batchOperations | 1,000 | Invocation |
| matches | 100,000 | Invocation |
| insertedNodes | 1,000,000 | Invocation |
| tableCells | 100,000 | Per table |
| tableRows | 10,000 | Per table |
| tableColumns | 1,024 | Per table |
| diagnosticBytes | 65,536 | Invocation diagnostic payload |
| work | 536,870,912 | Invocation work units |

`work` makes the spec's implementation-defined finite work ceiling explicit.
Other names match the command register. Future `--limit NAME=VALUE` parsing must
use these same names and lower-only validation, including duplicate-name
rejection, before calling the engine. Discovery must report actual host settings.
No CLI/schema/capabilities coverage is claimed by exporting this register.

## Charges and ownership

`charge(name, amount)` checks a nonnegative safe integer debit before accepting
it. A rejected debit leaves that counter unchanged. `check(name, amount)` checks
a per-item bound without debiting. `table(rows, columns)` checks all three table
bounds without overflowing multiplication; empty dimensions are invalid.

`document()` creates a fresh document-local input/expanded/entry scope but shares
all invocation counters. `readArchive` does this for each input: two reads keep
separate per-document ceilings and charge both inputs to retained bytes and work.
`usage` reports aggregate accepted debits, including both input documents.
Lowered operation views share counters; they cannot reset earlier work, matches,
insertions or output. Ordered callers must charge each batch item and every
match/insertion before executing or retaining it. Actual batch/diff integration
belongs to their pending implementation tasks; the foundation tests exercise
shared-step and two-input accounting, not nonexistent operations.

Archive reading reserves input/snapshot/metadata/scratch before codec acquisition
and expanded payloads before inflation allocation. Writing reserves source copies,
codec/output/sink copies and compression workspace before copying payloads. The
remaining output ceiling constrains the codec before serialization or sink calls.
Archive editors charge owned copies and snapshots; XML editors charge decoded
source, patch expansion and serialized copies. Returned package lookup,
allocation and traversal methods retain their invocation budget. Creation charges its original
inserted XML nodes and joins only admitted output buffers.

Reservations are deliberately conservative and never refunded during an
invocation, including failed edits, discarded parser snapshots and scratch
workspace. XML parsing reserves 16 times source bytes for copies, decoded strings
and parser storage; editor indexing reserves another 8 times source bytes.
Repeated parsing consumes the node/work/retention ledger again. This may reject
an invocation whose eventual live buffers would fit. These are deterministic
accounting bounds, **not process RSS isolation**, GC measurement, or exact heap
sizes. Native codec internals and arbitrary trusted host callbacks are not a
sandboxed memory domain.

## Work and cooperative execution

Archive input reserves 8 work units per compressed byte and inflation reserves
64 per expanded byte. Writing reserves 64 per input byte plus 8 per metadata
byte. XML decoding charges bytes and the parser charges its reported scanning
and namespace work, plus retained-node traversal. Compatibility scope processing,
semantic attribute/child scans and editor indexing/encoding also debit work.
These units are conservative algorithmic counters, not milliseconds or CPU
instruction measurements.

`parseDocumentXmlAsync` uses the same generator and limits as synchronous parsing.
It decodes in 4096-byte pieces and the parser normally yields scanning steps of
at most 512 units. `checkpoint` yields through the supplied scheduler every 4096
cooperative units; the default scheduler uses a timer turn. Admission prepares
metadata and XML parts cooperatively and reuses those parsed roots during graph
and dialect checks. The existing ZIP codec retains incremental CRC/compression
and bounded chunk yields (output chunks at most 64 KiB).

Model-only parsing/editing/validation remains synchronous as required by the
shared SDK contract. Synchronous tree/graph checks and individual allocations
are bounded by counters but are not preemptible; this is not a hard latency or
timeout guarantee. Cancellation from either the invocation budget or archive
context remains effective at cooperative boundaries. Budget consumers must use
one ledger for the entire ordered invocation, not independent ledgers per phase.

## JS and error mapping

Limits are exact JS safe integers without coercion. Inputs and outputs remain
owned `Uint8Array` values. Existing method/property names and synchronous return
types are preserved; the additional async XML parser always returns a Promise.
Editors accept a trailing budget after the existing limits/profile arguments;
validation and XML parsing accept a trailing budget after their options.

Invalid settings produce `InvalidValueError` (`usage`, ordinary exit 2); actual
resource exhaustion produces `ResourceLimitError` (`limit-exceeded`, exit 4).
Cancellation remains `CancellationError` (`cancelled`, exit 130). Future diff
adapters retain detailed codes while mapping non-cancellation failures to exit 2.
The low-level validator fails on diagnostic exhaustion rather than returning a
silently partial validation result; ordinary CLI diagnostic rendering and its
explicit truncation marker remain part of the pending adapter.

The API audit's language/security mappings and documentation-error dispositions
remain authoritative. This foundation does not promote any inherited member,
enum, collection, helper or underscore-named public model view to implemented.
Original tests and API spellings remain; no external runtime or corpus fixtures
were needed for the budget regressions.
