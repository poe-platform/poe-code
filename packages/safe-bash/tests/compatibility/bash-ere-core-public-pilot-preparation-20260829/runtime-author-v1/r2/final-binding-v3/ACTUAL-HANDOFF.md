# Consumed refusal: missing v3-bound outer owner

Raw refusal is preserved first in `ACTUAL-REFUSAL.txt`; structured accounting is
in `ATTEMPT.json`. This is an execution-preparation defect, not an engine finding,
clock-window failure or invalid-grant finding. The exact command was not run.
All24 ordinary cells remain UNRUN; no coordinator, install, product call or
Worker was launched. No runtime ownership was acquired or retirement inferred.

The existing operational owner in final-binding-v2 hard-codes the old directory,
grant/command hashes and monotonic origin. The v3 binding-only packet seals new
grant/command bytes and an authentication plan, but does not supply an executable
rebound owner. The prior READY statement was too broad if interpreted as a fully
launch-ready execution packet: this outer-owner dependency was not completed.
The current GO forbids new source. We neither modify that owner nor bypass its
capture/ownership requirements, and do not rerun the historical v2 attempt.

The frozen v3 origin268456542 and window remain unchanged. Fresh clock checks,
76-slot checks and source/artifact admission were not reached in this refused
attempt. No claim is made that those checks passed again. A future execution
would require explicit authority for a v3-bound qualified owner (or an already
qualified supplied owner), and new actual-attempt authority because this refusal
consumes the current one. No new window, origin or retry is inferred.

Publication changes only these three evidence files, using explicit paths.
Known administrative roles: one shell, one date, one apply_patch and two Git =5;
no Node helper or native runtime role. No package/archive/census work was done.
The old8317555c late-admission refusal, DATA profile-size STOP, sealed v3 binding,
all prior source/reviewer failures and broader/private OPEN gates are preserved.
