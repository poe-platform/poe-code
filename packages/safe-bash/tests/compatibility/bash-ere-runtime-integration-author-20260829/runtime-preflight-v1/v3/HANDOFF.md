# CORE70 completion v3 — concrete additions, specific remaining decisions

## Delivered, not activated

All three newly approved assertions are implemented in `additions.mjs`:

* H08: compare the two independent roots' first request work allowances, require
  both finite positive integers and equality. Existing two Worker/request-count
  and within-root diminishing-work assertions remain unchanged in cell-v3.mjs.
* H03/public-expansion-limit: actual `Shell.exec('[[ ${payload} =~ a ]]',
  {env:{payload:'aa'},limits:{maxExpansionBytes:1}})`, require rejection with the
  actual imported `api.ShellLimitError` and exact `.limit`, require zero Workers.
  The callable is mapped under existing H03; it does not pretend the remainder
  of H03 is complete and does not bypass its top-level admission gate.
* H06: invalid-ERE diagnostic sink throws exactly false without a caller signal;
  require rejection-presence separately from strict reason equality, then
  retirement. Existing 0/readonly-object/caller-wins controls remain intact.

The actual selected public API was authenticated before authoring:
`src/shell/types.ts:18–45` declares maxExpansionBytes and exec.env;
`src/shell/shell.ts:163–165,233–244` selects per-exec limits and environment;
`src/shell/runtime.ts:3932–3945` charges expanded byte length and calls genuine
Budget.fail('maxExpansionBytes') before regexAppend. This is not a guessed
public knob or private-profile status3 test.

EH04 now has three literal public bodies: cleanup-only versus numeric2;
standalone falsy diagnostic versus cleanup failure; caller versus both.
Each requires real context.invoke/registerCleanup capabilities, exactly one
registered callback completion, and original expected reason identity.

EH05 now has exact returned invoke Promise, derived Promise, and structural
thenable bodies; all retain cleanup and diagnostic counts. Exact Promise must
escape with false; the two unmatched provenance wrappers are expected to return
status1 with exact source-derived `shell: line 1: false\n`. Source:
runtime.ts:1032–1051,1130–1133,2328–2330,1764–1796; shell.ts:182–191.
The thenable is the expressly requested adversarial JavaScript return protocol,
not a claim it satisfies the public TypeScript CommandHandler return union.

No actual body ran. The original70 IDs and 210 layout cells remain unchanged.
There are now **65 whole authored bodies /5 incomplete IDs**, plus two newly
identified source-conflict holds among those65. Equivalently195 body cells,
15 incomplete cells, and six additional conflict-held cells—not195 passes.

## Exact per-ID decisions/access requirements

| ID | Source-backed blocker / requested disposition |
|---|---|
| H02 | wire-engine.ts:13 constructs the actual ledger internally; limits.ts:checkpoint has no public progress callback. The parent postMessage/held-reply observer cannot prove an actual matcher checkpoint. Request a fixed worker-local forwarding ledger checkpoint observer, armed only after subject admission, plus one strictly filtered test witness message. Exact wrapper/filter assets must be separately admitted. No new public API, counters, alternate engine or mutable payload. This authority was proposed in v2 and is not assumed granted by approval of the three assertions. |
| H03 | The approved real expansion subcase is implemented. **64-depth public boundary is shadowed by the32-group ceiling:** syntax.ts:88 checks depth, while :161 refuses the33rd group before nested expression can reach depth64. Request SOURCE-only qualification of that unreachable grammar boundary, rather than a fake public test made by lifting the group cap. Proposed remaining public vectors are32/33 groups;4095/4096 literal `a` atoms (sequence node makes4096/4097 nodes);interval255/256; finite `(a|aa){24}` /48-byte subject under public B8192/F1024 for a private-budget refusal. The last vector needs explicit resource-stimulus preseal/finite proof; no current runtime outcome is assumed. |
| H04 | Public strings cannot reveal old private snapshot holds, ticket retirement or simultaneous ledger occupancy. Request read-only forwarding observation around the exact private ArrayOwner.reserve/hold/close and binding retain/release paths, with source-bound ownership identities and no injected counters/lowered caps. Locators: arrays/ledger.ts:181–215,227–233; arrays/state.ts:255–307; runtime.ts:975–985. Without that explicitly admitted instrumentation, public string length alone must not be called private ledger proof. |
| H05 | Runtime target watch precedes session.execute (:943–955), and readonly precedes stale (:972–974,989–991). Request one bounded **parent request-forwarding gate** in worker-observer.postMessage, holding the original request before forwarding while actual context.invoke performs the mutation. It needs no worker-local matcher witness, private state mutation or public option. The currently sealed observer only records then immediately forwards; adding a gate is a concrete observer-role change, not an existing capability to silently assume. |
| H07 | Static literal fault workers may be authored, but the current observer admits only the production worker URL/size/hash; transport/owner.ts constructs that fixed entry. Request an exact per-case production-entry→owned-fault-entry replacement map in the observer, with independently bound static wire-engine imports and positive companions. No blanket alternate URL, new Worker options or relaxed product reply validator. This is a test admission/closure change, not a product API blocker. A fractional ASCII span can test the span validator; it cannot honestly become a non-ASCII UTF8 matching proof under the ASCII-only profile. |
| EH04 | No policy/access blocker: complete three-scenario body is authored, syntax-checked only, actual future execution still required. |
| EH05 | No policy/access blocker: complete three-route body is authored, syntax-checked only; source-derived outcomes remain test expectations, not observed product behavior. |

The requested observer changes above have **not** been implemented behind an
assumed capability expansion. H03's remaining source classification is also
explicit. There is no210-ready claim or released actual command.

## Additional source finding: preserve EH01/EH02

Original v1 uses33 groups as its status3 private-resource stimulus. Actual
selected syntax.ts:161 throws EreUnsupportedError('32-group grammar ceiling');
transport reports semantic unsupported, runtime.ts:959–962 returns2. Numeric
status3 is instead reserved by runtime.ts:1684–1688 for typed private limit errors.
This is a **SOURCE-proven fixture/input mismatch**, not a newly observed product
failure. Original scripts and expected statuses are preserved unchanged, with
additive admissionHold metadata. Request a genuine bounded private-limit stimulus
or a separately classified fixed profile-limit fault reply for control-flow-only
proof; do not silently change their private-limit goal into a grammar test.

## PURE evidence and literal failures

The first reader retired exit1 because it compared nonexistent manifest `.size`
against actual length; the authenticated selected catalog uses `.bytes`.
read-v2 validates the real schema and exact SHA/byte count. Both executable
versions and raw stdout/stderr remain. This ordinary helper error was not a
content-hash mismatch; no expected source digest changed. Ten selected source
files were subsequently authenticated against the exact305-source seal.

prepare.mjs made three exact source edits into a NEW cell and preserved all70
IDs. It syntax-checked additions.mjs, prepare.mjs and the generated cell without
evaluation. No stub Shell outcomes were counted. It staged an unchanged copy of
v2's owner controller, which replayed its18 defined checks:3 syntax-only,
13 synthetic,2 harmless actual Node children. Their exact new results/capture
and close receipts are retained separately, not merged into old results.

A final SOURCE-only patch replaces inherited `primary` truthiness in cell-v3
with an explicit failure-presence flag. It prevents an unexpected raw-falsy
failure being serialized as PASS. The original v1 remains unchanged; the
generated-before-this-patch source is reproducible from sealed prepare.mjs.
**The final patched cell has not received a new syntax execution or whole-cell
fault test.** The three syntax PASS records refer to its pre-presence-fix version;
do not extend those records to the final bytes or call whole-owner CORE admission
closed. This change does not alter the separate owner controller just replayed.

## Binding, census and remaining gates

Exact305 source da4e1cc187022255521879b00db2ac77674f79d9 and package
4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e remain
unchanged and unexecuted. No B35/Node/HEAD overlay, build, pack, install or inflate.
The admitted source SEAL is b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95;
the independently retained compiled-manifest digest is
f42f0008bf5939f28ccb7cd038b9f462a03efa38238709c97a7daab7c98e3035.
Source scope and package are not inferred to have been wholly reread from the
ten-file audit. Existing closure counts stay29 relative imports +1 Worker
URL +4 builtins, separate domains. Additional instrumented assets are not admitted.

Four PURE Node roles total: failed reader, corrected reader, preparer, owner
controller. Two harmless Node children; zero product imports, Workers, loaders,
compiler/npm/native/network/private engines. All tool calls retired synchronously.
Administrative source reads/patch/copy/hash/Git roles are distinct from runtime
counts; no process reservations are reported as measured starts. The command
ledger is in CENSUS.md; no historical/transitive PID census is invented.

Private T1 plus six separately qualified nonpublic variants precede relevant
public claims. The seven deferred public variants remain mapped to CORE70, not
a circular all60 gate. Different CORE preexec review and fresh actual ROOT GO
are still mandatory. No old staging is cleaned, no prior result is rescored,
and only this new v3 namespace is staged/committed.
