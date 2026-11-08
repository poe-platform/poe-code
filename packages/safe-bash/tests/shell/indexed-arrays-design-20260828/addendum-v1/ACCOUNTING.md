# Private ledger working proposal (no resource execution)

Accepted R runtime.ts:29–56 defines nonnegative safe-integer B=maxExpansionBytes
and F=maxExpansionFields; defaults B=16777216,F=10000. Existing command/source/
output/loop/depth ceilings remain additional, never refunded or replaced. Numbers
below are proposed logical costs, not user facts, public options, V8 heap or RSS.

## Finite caps

All expressions use checked integer arithmetic before allocation. If a cap
expression would exceed MAX_SAFE_INTEGER, refuse array-ledger admission with an
explicit private-limit diagnostic; do not wrap, round, clamp or change scalar-only
limit acceptance. Increment checks use `amount <= cap-current`. Zero B/F can
refuse all nonempty storage/metadata. No allocation indexed by maximum index.

| Counter | Proposed cap | Meaning / release |
| --- | --- | --- |
| Live array binding wrappers | F | Includes stage, cloned state and saved local wrappers; refund only on actual release. |
| Live sparse Map slots | F | Includes simultaneous old/new/clone maps; empty values still occupy slots. |
| Live payload bytes | B | UTF-8 lengths of distinct retained name/value/output storage identities. |
| Live metadata bytes | 128F | Logical wrappers, storage headers, map slots, scratch, output fields, saved frames. |
| Cumulative allocated bytes | 8B+512F | Every materialized payload/metadata allocation, including immediately discarded copies. Never refunded. |
| Cumulative entry slots | 8F | Every Map insertion/copy and materialized scratch/index/output-field slot. Never refunded; slot reuse without new materialization does not allocate again. |
| Cumulative work units | 32B+256F | Scanning, copying, probing, comparisons and ownership operations below; never refunded. |

Private exhaustion recommendation: existing command-failure path, status 1 with
`indexed array: private <counter> limit exceeded`; existing public Budget failures
remain ShellLimitError. This private diagnostic/category needs root ratification;
do not add public limit keys or label a metadata failure maxCommands.

| Logical allocation | Cost |
| --- | --- |
| Binding wrapper / Map header / saved local frame / scratch-vector header | 64 bytes each; distinct owners pay separately. Binding wrapper includes scope/name reference and version record; frame points to its separately charged saved wrapper. |
| Each sparse entry | 64 bytes, includes numeric index and immutable-value reference. |
| Immutable name/value or output-string identity | 32-byte bookkeeping header + UTF-8 payload; equal contents in independently materialized identities still count twice. |
| Scratch index / field reference | 32 bytes each; vector header additional. |

Choose full-map copies on append, saved-local snapshots and child cloning: every
owner pays header/slots, while immutable string identities share reference counts.
Replacement stages start empty. This is simpler than persistent-map detachment,
but repeated small appends/local calls can exhaust cumulative caps early. Count
reference changes/work even when storage remains shared. A refcount transition
2→1 does not refund bytes; 1→0 releases retained storage only. No hidden unbounded
deduplication table. Transfer stage ownership at publication without copying or
double-charging. If an implementation instead materializes a copy, it must charge
that copy; a COW alias is never a free wrapper/Map/index structure.

## Admission, work and cancellation

Pre-admit headers before Map construction; slots before insertion/clone; saved
frames before local publication; sort/index scratch before creating vectors;
field count before quoted @ arrays; output capacity before join/concat/encoding.
Scan each incoming string incrementally to measure UTF-8 without encoding it:
charge one unit per UTF-16 code unit examined, including the second surrogate;
check signal at entry and before every admission. Retained payload uses the
computed UTF-8 length; joining uses checked sums of cached lengths and separator
count before any joined string exists. Unknown/uncached input must be scanned.

Charge one work unit per Map lookup/insert/delete, reference acquire/release,
slot visit/copy, numeric-index comparison, and copied/emitted UTF-8 byte; combined
actions charge the sum, not whichever is smaller. Literal-index scanning costs
per character. Use cancellable incremental merge-sort over sparse indices,
pre-admitting two N-slot vectors plus headers; no builtin unbounded sort,
Map-constructor clone, Array.from or string.repeat. Chunked concatenation must
charge every actual intermediate materialization; it is not automatically linear.
Check signals at most every 128 units and await the existing cooperative checkpoint
every 128 units in async array work. Recheck after awaits and before publication.
Synchronous literal scanning is at most ten decimal digits. LET's accepted
synchronous 10k/depth64/indirection64 policy is unchanged, not async preemption.

Reserve matching cleanup-work credits before acquiring each owned object/slot
(one release unit each, plus one per reference decrement). They count against W
when reserved and are consumed by release without a second charge. Cleanup does
not await a new admission or throw cancellation instead of restoring locals;
bounded release batches may yield while existing settlement waits. The example
below tracks allocations, not work/cleanup-credit simulation.

Reserve ownership before calling RHS/host work; failed admission makes no new
stage. After failure only actual released live counters decrease; cumulative
allocation/entry/work counters stay spent. Array-produced fields/string/buffers
remain charged through output staging and consumer ownership until a documented
handoff to existing bounded output ownership. Transfer is not premature release:
reserve the destination first, never double-charge identical transferred storage,
and count an encoded copy if encoding materializes it. Native heap details remain
outside this logical model.

## One invocation, including children

Ledger belongs to the root exec invocation; all Runtime descendants, subshells,
pipelines, substitutions, functions, source/eval and interpreter/invoke/shebang
children receive the same reference. R:745,884,1755 pass `this.budget`; cloneState
R:278, processState R:1609 and invokeScoped R:2102 must not reset the new ledger.
There is no accepted `parentBudget` or `newBudget` symbol; inherited Budget object
identity is the existing mechanism. A future clone-local `newBudget` would be a
bypass, not an existing verified defect. Shell.exec B shell.ts:165 creates Budget
per exec. Root must define independent public exec and host-created process
boundaries: a plugin calling a new Shell.exec is not automatically covered by the
current CommandContext.invoke contract. No public cross-exec ledger contract is
claimed needed or supplied here; a broader guarantee would require root design.

## Computable allocation example, not product/native proof

Choose B=1024,F=16: wrappers≤16, sparse slots≤16, payload≤1024,
metadata≤2048, cumulative bytes≤16384, cumulative slots≤128, work≤36864.
One shared one-byte name, old values of lengths 3 and 5; staged append adds length
7. Old, stage and local-save clone share old string identities. A single three-slot
index-list scratch is illustrated (not the two-vector sorting peak).

| Event | Live payload | Live metadata | Live sparse slots | Cumulative allocated bytes | Cumulative slots |
| --- | ---: | ---: | ---: | ---: | ---: |
| Old binding: 2 slots, name+2 value headers | 9 | 352 | 2 | 361 | 2 |
| Append stage: 3 slots, one new value header | 16 | 704 | 5 | 720 | 5 |
| Save old local: frame+wrapper+map+2 slots | 16 | 1024 | 7 | 1040 | 7 |
| Three-index list: header+3 slots | 16 | 1184 | 7 | 1200 | 10 |
| Join output: header+field+new string; 3+5+7+2 separators | 33 | 1312 | 7 | 1345 | 11 |
| Release index list | 33 | 1152 | 7 | 1345 | 11 |
| Failed stage releases its map and unique value | 26 | 800 | 4 | 1345 | 11 |
| Release independent output copy | 9 | 672 | 4 | 1345 | 11 |
| Release saved local clone | 9 | 352 | 2 | 1345 | 11 |

At the stage peak with F=4 instead, five live sparse slots cannot be admitted;
do not construct the fifth slot and then test. With F=16, repeatedly discarded
copies eventually hit cumulative limits despite returning to the same live state.
These hand-computable examples are metadata arithmetic, not semantic simulation.
