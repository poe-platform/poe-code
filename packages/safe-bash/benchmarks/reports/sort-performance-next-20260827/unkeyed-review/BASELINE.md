# Independent prechange baseline checkpoint

Freeze commit: fcd6d0218725342e4ef1aa098e23b0cdfbe9cd10.
Product commit: dce6e3824d6de6d03490a531cf2bc7d2d279bb8c.
No candidate source or author test was inspected for this run.

The isolated declaration/ESM build succeeded using existing TypeScript. An npm
pack archive was extracted, the consumer directory actually moved, and public
`import('virtual-bash')` resolved solely inside its realpath-normalized package.
All 733 package files and 174 loaded modules authenticate before/after; all 224
selected source/config/package Git objects remain unchanged. No runtime package
dependencies or live product module fallback were introduced. The worker asset
manifest authenticates files only, not execution of worker-dependent commands.

Results: **21/21 unchanged acceptance cases; 32/33 independent frozen cases**.
All 54 Shells were disposed and all exact child handles closed. Five-second
cooperative abort, 4MiB output, 512MiB V8 heap and 90-second per-child wall guards
were used. Heap is not RSS; abort cannot preempt synchronous sorting. The runner
does not impose the historical report's separate 60-second CPU guard, and no
CPU, elapsed-time performance or memory improvement is claimed.

## Preserved fixture failure

`guard-key-local-replaces-global` supplied `sort -nr -t: -k2,2`, which has no local
key flags. Frozen expected order `x:2` then `y:10` was wrong for that invocation.
The original product correctly inherits global numeric reverse and emits `y:10`
then `x:2`, exit0, empty stderr, unchanged effects. This is a verifier fixture
defect, not a product regression. Neither original expected bytes nor original
results are corrected. The failure was immediately sent through the findings
marker before any candidate inspection. Root subsequently authorized a separate
v2 fixture, preserving this original 32/33 result.

The 11 generic cap recipes remain unbound and unexecuted. Candidate, private
counter/cap, mutation and wider pinned-cohort acceptance remain pending. The
historical zero-numeric-work pipeline is unresolved; 48 old mismatches remain
ineligible within the 720 denominator. No timing/native campaign was run.
