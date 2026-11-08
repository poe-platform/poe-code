# One scoped independent cohort: execution receipt before imports

This recipe follows immutable12-family/33-case freeze
`bdb49d758809134e5aeb2aef57f8656a580f142e` and the current root's explicit scoped GO.
Timing is POST-author/POST-candidate inspection, PRE-candidate imports/controls.
No pre-code claim. There has been no driver/product import or control execution.

Shipping files come exclusively from reseal
`96daebc077381fb63ab6447a26ab707ce790ff25`, whose two changed implementation
files are source `02a5060019bccdd2a64f9811812104ba09d2aaee`.
Evidence `770381bc61b49b5abed96acdf0ab09f2d4b610ca` handoff is actually at
`tests/integration/full-gate-20260827/unified76-driver/inherited-routes-author-v1/HANDOFF.md`.
Normalized driver is
`2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e`.
RECIPE.json binds38 shipping files,35 unchanged from fe15, all permitted copied
modules/data, existing20 tool origins/70 distinct physical files and197 Git-core
members. Source02 and reseal96 implementation equality is checked before sealing.
Original11+sandbox2+inspector2 OS-reference exceptions remain metadata-only on
macOS26.4.1/25E253; no new exception or full OS attestation.

## Exact invocation and bounded work

The controller is launched once through builtin child_process.spawn:

```
executable: /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node
argv: [absolute-owned-review.mjs, --cohort-once]
cwd: /Users/kjopek/Workspace/safe-bash
env: {PATH:/dev/null, LANG:C, LC_ALL:C, TZ:UTC}
stdio: ignored stdin, bounded stdout/stderr pipes; no inherited file descriptors
```

There is no driver --run or release receipt. The coordinator creates a one-shot
COHORT-START.json marker and refuses an existing marker. It stages only exact
allowed source/data in a new /private/tmp/unified76-env-independent-* tree,
plus this owned worker and recipe. No AGENTS, private source, compiler, npm tree,
product snapshots, execute.mjs or driver entry is staged/imported. Runtime module
hooks admit only builtins and exact copied candidate module hashes, with load
receipts. The unimported execute body is read only from pinned Git for static
callsite checks. Preflight syntax checks concern our two scripts only.

Five fresh shipping-supervised/fenced workers: core, compound-errors,
poison-restoration, partial-installation, authority. Each uses the actual
superviseFencedWorker/openFencedWorker profile/protocol, with phases=[];
no canonical phase, prerequisites, privateState, private copy or A10 can be used
to fill coverage. Ordinary assertions aggregate only after intact env/lifecycle.
Unexpected safety/capture/cleanup failure stops remaining work; no retry.

Bounds:180s cohort admission/deadline budget;30s regular worker/60s authority
worker, capped by remaining budget;1MiB combined worker output;12MiB total
captures;64MiB owned disk inventory cap;5s/2MiB for each of exactly two Git reads.
Existing supervisor cleanup allowance5s remains qualified, not kernel-hard.
The outer invocation capture has2MiB total output and a240s watchdog; watchdog
intervention is failure, never a clean finish. No hard RSS/disk-quota claim.

## Independence and case mapping

Ten intrinsically static cases are enumerated in RECIPE.json. They verify all
three actual source scopes and source sensitivity mutations, not live private
operations. Twenty-two remaining adapter cases are assigned to the five workers;
E11.2 uses their actual shipping lifecycle receipts. Side-effect-free callbacks
exercise the real adapter; owned process.env Proxy fixtures trigger installation/
restore exceptions without changing author implementation. Poison is never reset
inside a candidate module; each poison group ends in its fresh worker.

E03.3's all-three-nonempty original state conflicts with unchanged admission of
nonempty GIT_*: record actual refusal as prerequisite evidence and leave the
restoration obligation UNEXECUTED, not PASS. Mixed/path-nonempty states remain
genuinely testable. No admission bypass is fabricated for a better denominator.
Cancellation/deadline controls retain ownership until the review explicitly
settles its own callback; this is not arbitrary background-work cleanup.

Authority case constructs only benign synthetic Git objects/files in its owned
root, then runs the unchanged frozen authority-map excerpt, hash
`41e8bbf0e913189bf8b273a93499ac597515928b264cc52ac5c86b151a3d5cd7`,
with owned fixture repository/commit/source arguments. Both subprocess calls
remain literal git with env omitted. Unique finite PATH resolution, actual
symlink/realpath/binary/core identity and argv/env are captured BEFORE dispatch;
PID/status/signal/error/stdout/stderr follow. This is stronger than old missing
telemetry, but not a kernel exec-event or TOCTOU guarantee. No absolute-Git probe
substitutes for bare dispatch. Old EPERM target remains unknown.

Source guards, FD and foreign-process qualifications carry only for the35
byte-identical members. No new foreign-sentinel/security experiment is claimed.
Raw coordinator exit is retained, including exit1 for any FAIL/UNEXECUTED/HOLD;
worker natural exit0 is not an override. Original author9/10, focused G09 reads
with coordinator EXIT1, and eight offline reporter controls remain separate.

After raw captures and owned filesystem manifests, remove only newly created
roots with verified identities. Original failed gate roots/history are untouched.
No fresh pack, broad tool/native cohort, dependency install, network side effect,
private access, permission widening or fullgate is authorized.
