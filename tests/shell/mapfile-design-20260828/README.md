# MAPFILE / READARRAY follow-on — design only

August28,2026. Owned scope is this new directory only. No implementation,
builtin registration, runtime/parser/private-array interface edit, test execution,
native invocation, build, product import, comparator, private engine, permission
probe or XAN work occurred. Metadata/source reads are not product observations.

The accepted scalar/stream baseline is coherent78 logical tree
`8437e4eda904e1248c25eeef0d9d455b1d251495` / full pack
`6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`,
root accepted via633f6c82. Runtime/shell remain the selected d2502aae blobs.
Indexed arrays are **currently being implemented by Faraday**, not accepted or
part of that baseline. Their ratified policy is a future prerequisite, not an
available API. Dirty runtime/parser work was not used as an accepted source.
Historical13/54 versus47/54 results remain unchanged; this task rescored nothing.

## Recommendation

Implement the genuine shell builtin pair only after the array foundation is
accepted and selected into an explicit composition. Support default `MAPFILE`,
one named indexed target, `-n`/`-s`/`-O`/`-t`/`-d`, proper no-origin clearing,
per-record publication and shared-input remainder. Initially refuse `-C`, `-c`
and every `-u` before this builtin pulls input or changes its target. Do not
pretend callbacks are argv-safe child invocations or silently ignore descriptors.
These two builtins would not increment the aggregate plugin inventory.

The smallest input prerequisite is a PRIVATE byte-record operation on the
existing shared ShellInput cursor. Existing `line` is not adequate unchanged:
it lacks a record-present bit, strips NULs, has distinct UTF8 decoder profiles,
and allocates under the existing input phase. Do not write an independent
iterator that loses read-ahead, prematurely returns borrowed stdin, or evades the
array ledger. `PROFILE.md` specifies proposed semantics and exact open choices;
`SOURCE-BINDINGS.json` binds all accepted/prospective/native-source evidence.

## Open ROOT decisions

1. Approve the initial callback/FD refusal profile, including `-u0` and standalone
   `-c`, or authorize a separate callback/descriptor design before implementation.
2. Select numeric grammar/domain and extra-operand policy after neutral native
   observations. Recommendation: ASCII unsigned decimal (leading zeros allowed),
   counts/skips through4294967295, origin through2147483647, invalid syntax2 versus
   invalid numeric value1; no arithmetic/index evaluation.
3. Approve first-byte ASCII delimiter support and explicit non-ASCII delimiter
   refusal; Unicode data remains supported. Decide malformed UTF8 and embedded
   NUL policy after observations. Recommended source-matching NUL-prefix behavior
   is a SOURCE INFERENCE, not an observed native result.
4. Approve target-entry clear/convert before skip/read; row-by-row checked writes,
   no rollback of earlier rows/consumption, final readonly-before-stale checks,
   and whether index overflow consumes the next pending record (recommended) or
   rejects before discovering whether one exists.
5. Approve the proposed private cursor/ledger handoff and logical accounting.
   Existing producer-owned/whole-chunk input remains E; every NEW mapfile-owned
   record, decoder carry, staging token and retained array value must be privately
   admitted. No RSS, total-input-memory or opaque-read preemption claim.

`OBSERVATIONS.json` freezes32 neutral GNU5.3 recipes, no expected outputs and no
scores. `OBSERVER-PROTOCOL.md` describes a NEW supervisor's required bounds and
fixes for all five old static gaps. There is **no executable observer here**.
Root must approve a named packet, then a different reviewer must inspect a
future observer and its synthetic controls before native execution. The old
array supervisor is neither reused nor repaired/requalified by this task.

No implementation GO is requested by this design seal. Required next step is
policy selection and different design review, then accepted-array API/source
reconciliation, independently frozen runtime/ownership tests and an explicit
write window. See `PROFILE.md` for proposed future source paths only.
