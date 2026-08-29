# RegexWorker instrumented v3: UNSAFE_STOP

Preseal **81443d3d9eabcf17040d77eb34c60106fc543ccc**, seal SHA256 **68f824801932f77b07fed4de0597e6c39d6463e304a02d24b179978d36d6421f**. One new authorized harmless run; no retry. V2 remains unchanged.

## Actual results

**19 raw qualifiers / 10 ordinary FAIL / 1 G06.4 UNSAFE_STOP / 25 UNRUN**, denominator55. 30/51 case children launched; four in-process DATA controls unrun. 29 RESULT receipts published, G06.4 RESULT missing. All30 host case children plus supervisor and outer owner naturally closed.

Published receipts record **0 Worker creations / 0 constructor attempts**. Do not promote those completed-only counters to a total: G06.4 has no operation receipt. Its host process is closed, but individual Worker counters/primary are unpublished and unqualified. No target/comparator/guest-engine/C11/semantic execution occurred.

Children observed=retained stdout7444/stderr6732 bytes; outer110/0; total **14286 bytes, zero recorded stream loss**, all capture descriptors closed. This does not override the stop.

## What the repair established

Ten published owned descriptor rows show enrollment, successful open and successful close, with **ERR_ACCESS_DENIED** at fsync: **fsync API is disabled when Permission Model is enabled.** No fsync success is claimed. This is the pinned Node22.22.2 child profile with --permission, not a target defect. Capturing primitive open fixed the earlier guarded writeFileSync/open issue but did not bypass the native permission restriction. No permission was widened.

G05.1 now records NOT_ENTERED and authenticates the exact original682-byte fixture instead of expecting an unperformed mutation. Its remaining exact-worker-count failure stays FAIL; V2 G05.1 stays STOP. Published DATA assertions: **348 mutation-stage predicates** (12 per29 receipts), **319 malformed/pre-refused witness predicates** (11 per29). These are assertions inside existing controls, not extra cases or nested-worker evidence. The G10.4 twelve writer faults plus three physical mutation variants, constructor/publication failures, cross-worker isolation and actual nested-load proof remain UNRUN.

## New blocker and secondary harness defect

The fsync barrier prevents normal Worker setup. At G06.4, case.mjs:156 assumes mutable.rows[0] exists and writes exitCode=0. The retained845-byte stderr records the TypeError; no RESULT was published. The supervisor stopped on missing RESULT and retained the tail as UNRUN. The original operation/primary for this control was not captured; sibling errors and the empty journal must not be used to reconstruct it.

A future correction must publish the raw operation before dependent counter-mutations and require an actual bound Worker row; absent prerequisites remain UNQUALIFIED, never a passing mutant. Apply the same narrow prerequisite treatment to other row-dependent controls. No correction was made after this stop.

## ROOT decision needed

Do not remove --permission, add a native bypass or silently drop fsync. A possible unchanged-permission design is to let the existing trusted supervisor authenticate and fsync exact owned witness/config files after known child retirement, before qualification. This adds no guest/Worker channel or OS child, but **changes durability timing**: in-child writes are closed/visible, not yet fsync-qualified. ROOT must explicitly accept that profile before implementation. If durability before Worker evaluation is mandatory, hold for a separately approved bounded parent-owned publication design; the current four-byte sticky channel must not be repurposed as an acknowledgement channel.

All45 standalone post-stop bindings passed (25v3,3 inherited guard,17 immutablev2). This is source/DATA integrity, not a replacement for the missing final runtime postguard/receipt. Old losses, DU FAILs and W03/W07 caveats remain. See EVIDENCE.json, CAPTURE-INVENTORY.json and publication records for exact bounds and exclusions.
