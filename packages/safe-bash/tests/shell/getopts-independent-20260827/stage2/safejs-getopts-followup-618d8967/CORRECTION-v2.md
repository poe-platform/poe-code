# Explicit harness correction, not a new product profile

Frozen attempt01 executed G1 once in the real engine and stopped:0/2 passes,
one infrastructure nonpass and one blocked. Actual getopts entries=4, engine
imports=63; printf was not registered on either host Shell. The original surface04
host fixture explicitly calls innerShell.use(product.standardCommands()). The
reviewer omitted that existing setup. Guest check `script status` threw inside
real run after a127 script result; no completed guest assertions marker exists.
Original execution-attempt-01.log, evidence-v1/RESULTS.json and logs remain intact.
This is not a product defect or an ASCII/readonly policy result.

child-v2.mjs differs by EXACTLY these two existing host setup calls, before
runtime construction: outer.use(product.standardCommands()) and
inner.use(product.standardCommands()). It does not add a guest module, builtin,
capability, fallback, new bridge option or production change. The guest source,
expected observations/assertions, original import/private/capability guard bytes
and builtin witness remain unchanged. All original freeze files stay untouched.

New regular copies reside ONLY in the explicit .scratch/run-v2 sibling. The
original immutable snapshot is rechecked with exactly this declared append
excluded; the new root has its own append-aware immutable digest and import map.
Old root inputs are not rewritten. Source/package identity remains full618d8967.
FREEZE-v2.json plus its commit bind corrected executable inputs before execution.
The original cohort remains0/2; the corrected cohort is scored separately.
At most two more guest executions, G1 then G2, stopping on any nonpass; no further
retry. Total maximum three actual engine runs for two distinct useful probes.

The first v2 preparation command failed parsing an extra closing parenthesis in
the source-copy loop, before executing the module or accessing private inputs.
preparation-v2.log preserves it. The loop expression was assigned to sourceEntries
and then iterated; preparation-v2-02.log is the subsequent preparation capture.
This syntax correction precedes the v2 freeze and adds no engine run.
