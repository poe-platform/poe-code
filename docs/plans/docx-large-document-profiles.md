# Bounded DOCX large-document qualification

Scope: only `large-document-profiles`. Later pipeline tasks remain pending.
Work on main; commit explicit owned paths/hunks after maintained checks; no push.
Preserve the pre-existing packing/discovery/OMML work and historical corpus evidence.

## Failing tests before code

Small original memfs inputs demonstrate that the inspection engine ignored trusted
node options (exit 0 instead of 4). A validation spy on an actual original tiny
package demonstrates fixed 32 MiB/4096-part caps in serialization and authenticated
original-byte publication despite larger explicit host capacities. Validate both
branches before fixing; no downloaded content or giant inputs enter unit tests.

Expose optional `documentLimits` on the public engine factory and reuse the existing
lower-only operation ledger. Keep the default XML part bound at 32 MiB even when
an archive member allowance admits larger media. Serialization validation uses
admitted archive/host capacities; XML parsing still independently enforces its
host limit. Existing low-level validation defaults stay unchanged.

## Offline QA plan executed by the agent

1. Read immutable local corpus through explicit QA host acquisition; product receives
   owned bytes only. Retain source hashes and default rejection results. Record
   corpus census (512 MiB/five million) separately from product defaults (256
   MiB/two million), including the 40,415,536-byte main XML annex.
2. Run default admission over all 19 acquired files, then staged archive read,
   admission, validation and round-trip attempts under explicit finite host
   profiles. Count invalid inputs and unsupported edits separately from limits.
3. Generate original stress packages by starting from `createDocumentArchive`,
   replacing only its authored body XML and serializing through the bounded ZIP
   writer. Use repeated original ASCII text and deterministic dense paragraphs.
   Store disposable bytes only under ignored `.cache/docx-performance-qa`.
4. Measure geometric text/density controls, separately timing archive acquisition,
   XML admission, validation, serialization, reopen, SDK targeted replacement and
   actual Shell targeted replacement. Use `performance.now`, `process.memoryUsage`,
   and OS process high-water RSS; report limitations of sampling. Byte counters
   are conservative cumulative reservations, never observed heap/RSS.
5. Require two large/dense successful round trips and targeted edits through public
   SDK and actual Shell. Verify member bytes for round trips, exact changed text,
   output hashes and unchanged input hashes. Exercise default rejection and
   lower-only CLI limits; never infer success from census counts.
6. Record machine/runtime, complete trusted profile, recipes, per-stage measured
   outcomes and bounded scaling controls in `docs/docx/performance.md`. Generated
   data does not satisfy the missing two-input 20 MiB/100 MiB acquisition regime.
7. Run maintained DOCX lint/test/build closure and focused virtual-bash checks.
   Inspect a Shell output screenshot if command output is affected. Commit only
   owned files/hunks; record local hashes without push/release claims.

## Exact JavaScript/security mapping and documentation drift

`createDocxInspectionCommandEngine({ limits, documentLimits? })` accepts trusted
safe-integer camelCase resource settings; `--limit name=value` and typed SDK
`limit` only lower those capacities. Each execution creates its own ledger,
sharing it through acquisition, admission, edits, validation and publication.
Low-level SDK contexts use `DocumentBudget(hostLimits, signal, yieldTurn)`;
byte APIs are always async and use owned `Uint8Array`. Explicit VFS/stream/sink
capabilities replace ambient authority. Invalid settings map to `usage`/exit 2,
exhaustion to `limit-exceeded`/exit 4, cancellation to `cancelled`/exit 130.
No new environment configuration, host clock in product edits, network access,
dynamic invocation, model aliases or private-type exclusions are introduced.

The historical API inventory/audit and their documentation-error dispositions
remain unchanged. Document/Package/Part/XmlPart live owners, inherited interfaces,
public underscore-prefixed types, enums, helpers and collections retain their
existing obligations. This task qualifies byte/utility lifecycle behavior only.
It does not implement the whole model or promote census counts to conformance.
The earlier statement that raising only annex XML removes the input-size blocker
is incomplete for actual product execution: work/retained accounting and semantic
admission must be reported independently. Preserve that historical statement and
record measured correction in the new performance evidence.

Status: bounded task complete. The numeric/per-stage evidence is recorded in
[performance evidence](../docx/performance.md). The annex's raised admission and
semantic rejection stay separate from four original successful round trips/edits.
The 100 MiB and dense inputs pass through package-public SDK and actual Shell;
ordinary/partial-profile failures and all-match superlinear controls are preserved.
No general default-readiness or whole-model conformance claim is made.

Maintained checks passed: DOCX lint/source/test types, 167 workspace test files
(3353 cases), five-stage explicit DOCX build closure, virtual-bash maintained
source/test/consumer typecheck, 17 focused actual Shell DOCX cases and six original
profile regressions. The final small read precondition/regression was verified by
the focused suite after the workspace pass. The actual Shell host-limit diagnostic
screenshot was rendered and inspected; QA fixtures remain locally ignored.

Delivery: local owned commit(s) only; no push/release. Later tasks remain pending.
