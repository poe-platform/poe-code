# Version 2: remove the obsolete next-method mutation

Root's updated coordination note, read before phase handoff, explicitly requests
replacing the invalid method swap with a finite stateful producer. Version 1
already made the originally acquired next method finite and produced a fully
settled baseline-02, but left the now-redundant swap in its prepared executable.

Version 2 removes that exact swap and its restoration from the prepared copy.
It retains version 1's stable stateful next implementation, identical first
pending/chunk/second-EOF schedule, and every original assertion-call line. No
frozen file, previous preparation, previous run output, production or author
file is changed. Both prior executable hashes and all results remain available.

`prepare-fixture-v2.mjs` records all four exact transformations, checks the
original immutable source hash, and checks identical assertion lines. Version 2
is committed before the new baseline-03 execution and any candidate inspection.
The new cohort is separate from baseline-01 and baseline-02, regardless of counts.
