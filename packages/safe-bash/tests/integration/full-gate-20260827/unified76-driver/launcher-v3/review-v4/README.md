# Version4 scoped build/type entrypoint and outer transport observer

This additive driver revision keeps product candidate
`f5e9fc49b6abb38e180cc9de16c95fced102ff75`, profile, cleanup256, native49+2
and expected full package `c109372f…` unchanged. Driver2713 and independent
19PASS/3HOLD followed by21PASS/1A10HOLD remain historical. No prior report or
fixture is rewritten. This packet does not release the full gate.

## Shared implementation, explicit review

`review-build-types.mjs --candidate f5e9fc49b6abb38e180cc9de16c95fced102ff75 --review-build-types /tmp/unified76-build-types-review-UNIQUE`
uses the pinned Node24.11.1 runtime. Remove ambient GIT_PAGER as required by the
existing injection guard. Importing the module is inert. Full `run.mjs --run`
still requires a matching root release receipt; review options cannot substitute
for release or produce a whole-gate verdict.

Both actual full execution and the review entry call `runBuildTypes` and the
same `createPhaseRunner`: same cold prerequisite78, actual npm typecheck:all,
one production build, source/build delta checks, authenticated declarations,
natural child cleanup, output bounds and approved-build receipt. Review supplies
only the two allowed phase names; it cannot execute canonical/native/runtime
consumers or SafeJS. The production compiler subprocess is observed through a
hash-bound preload inherited by the real typing process; receipt builds1 alone
is insufficient. Zero/multiple production invocations reject. Consumer types
must bind the actual resulting declaration set. Test-owned builds of other
projects are not counted as builds of this source root.

This first review implementation uses the existing conservative committed-input
closure:37,397 entries/2,382,440,321 bytes, streamed into an isolated temporary
directory, not buffered as an archive or committed as evidence. It is not a
compact typing closure claim. Exact candidate index entries support inventory
checks without copying Git history or using object alternates. Existing main
and benchmark dependencies plus npm/tool identities are authenticated. Only
the build may add dist, then full input inventories freeze. Setup has a600s
outer deadline; each of the two phases retains the1800s limit and256MiB output
cap. The outer supervisor retains the existing cleanup qualifications. A type
failure or incomplete cleanup remains nonzero even if a build succeeds.

## Contained transport observer

The optional outer observer is an explicit inherited IPC capability, not a
fallback that swallows ps EPERM. It binds the actual owned requester PID/birth,
admits only its actual direct child owning a detached group, and returns group
observations for an opaque per-registration handle. Unknown PIDs/handles fail.
The outer service runs only read-only ps; it sends no kill requests and changes
no target filesystem/exec/network policy. Transport waits for registration
before supplying Git input and requires a successful empty-group observation
after the Git child closes. Missing/disconnected observer remains failure.

The contained-link control keeps the original sandbox profile shape and checks
that inner ps still returns EPERM and an outside write remains denied. It then
uses the real extractor, literal symlink/payload and archive verification, with
an outer child/group/birth receipt and natural reaping. No unowned process is
signaled. This is trusted-host observation, not kernel PID-handle attestation
or an arbitrary untrusted-code sandbox claim.

## Predeclared controls and outcome boundary

`controls.mjs` declares four bounded groups before execution: explicit review/
release routes; inert imports/shared source wiring; two real compiler builds of
a separate tiny project killing the one-build check plus preload tampering;
and actual contained-link extraction with intact target fences, foreign-PID/
handle refusals and outer reaping. The tiny compiler control is not a second
production build of f5. Raw failures remain evidence; there is no counter stub
or simulated production build.

Source/controls are sealed before the one actual author review run. Reports
must distinguish bounded control outcomes, the actual shared typing result,
and remaining independent review/full-release HOLD. No full gate, c109 rebuild
or consumer runtime acceptance can be inferred from this entrypoint alone.
