# Live slide-run hyperlink owner integration

## Scope and evidence-first change

The original text guide reaches `run.hyperlink.address` from a textbox's returned
run. Two original tests failed because `Run.hyperlink` was missing. The existing
link session/editor already provided URL admission, relationship reuse, action
classification and safe mutation; use that editor, not a duplicate XML writer.

Connect slide shape text frames, paragraphs and runs using an internal WeakMap of
capabilities. Resolve current owning shape and run-properties paths on each link
operation, invoking existing generation checks before access. A cached hyperlink
must not retarget another run after clear/replacement. Add a synchronous session
adapter over current presentation parts; rebuild its selection/relationship view
when changed/deleted parts change and increment model revision on edits.

## Verified behavior

Five original cases in `run-hyperlink-owner.test.ts` cover set/read/null removal,
shared URL relationship reuse, save/reopen, ordinary font edits, rejected active
URLs without mutation, stale cached handles, SDK-backed `links set --path` with
memfs publication, and later slide creation. The original guide test now uses the
same returned owner property. Initial red: 2 cases failed; final focused green:
5 cases passed; the added fifth case checks the actual PropertyAccessError class for detached owners. Existing link action/model/command suites plus these tests:
83 cases passed before the fifth case was added; the final focused file passed all 5. Root coordinates final maintained lint/test checks and commits.

The initial link setter also exposed an authored hyperlink fragment with missing
inherited default binding. Carry that escaped binding into the existing fragment;
keep XML admission and the relationship editor's validation unchanged.

## Boundaries and agent QA

Only live ordinary slide-shape and placeholder text frames receive this capability.
Table-cell/chart-title/notes run owners remain explicit gaps; detached runs raise
`property-unavailable`. No host path, network fetch, arbitrary execution or native
runtime is added. Model hyperlink access may ensure the run-properties container,
matching the lazy owner contract; CLI reads continue using noncreating inventory.

For QA, create fresh original bytes, edit two links to the same inert URL, remove
one, and inspect remaining graph edges and save/reopen text. Reject an active URL
and compare bytes. Retain a hyperlink, replace its owning text, and require typed
invalid-handle failures. Exercise an existing part update/new slide before another
link edit to confirm the session sees current parts. Execute the corresponding
command through explicit memory I/O and compare the reopened owner property.
