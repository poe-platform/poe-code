# Indexed-array observations v1 — not scored

Executed once on August 28, 2026, under the received root instruction recorded in
`AUTHORIZATION.md`. Supervisor/preflight seal commit:
`f0c6321f506f866f37c42d4162dc332a80668925`.
Original manifest `f731d304306b02d11df41b386d4528405ad307ca33098d25f1bc2a0193c0764f`
at `abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0`, independently reviewed at
`0d70a9d4d30f4623a5ec2594e7f8568f5e2dbb43`, remains unchanged.

Evidence directory: `capture-7843e762-7db7-4d2b-a16a-0c279d49c616/`.
Each row has durable admission, raw stdout/stderr, and a result receipt. N15 also
has raw `N15-rhs.bin`. `EVIDENCE.json` binds every capture file and records hashes
of the exact argv/environment serialization. `ADMITTED.json` prevents rerunning
the supervisor; it must never be removed/reset. Metadata capture is not a test.

## Exact row accounting

Exit is the top-level process status, not the status of every builtin inside it.
All signals were null. No native expected values or pass denominator exist.

| Row | Exit | stdout bytes | stderr bytes | Narrow observed fact |
| --- | ---: | ---: | ---: | --- |
| N01 | 0 | 518 | 0 | Exported scalar converted; declaration/export listing showed `-ax`. |
| N02 | 0 | 528 | 0 | Export returned 0; array retained sparse and empty members. |
| N03 | 0 | 58 | 83 | `declare +a` returned 1; whole unset allowed later scalar. |
| N04 | 0 | 498 | 70 | Empty readonly array remained after unset returned 1. |
| N05 | 0 | 79 | 0 | Local was unset scalar, then scalar inner; sparse outer restored. |
| N06 | 0 | 62 | 0 | Local unset displayed scalar-unset; scalar assignment and outer restoration followed. |
| N07 | 0 | 78 | 112 | Both local declarations returned 1 for readonly outer. |
| N08 | 0 | 540 | 0 | Scalar companion: exported outer restored after readonly local. |
| N09 | 0 | 48 | 0 | Replacement RHS read old0/old2, not staged new0. |
| N10 | 0 | 48 | 0 | Append RHS read old0 despite explicit earlier zero replacement. |
| N11 | 0 | 76 | 103 | Assignment returned 1; fresh stayed absent, side stayed before. |
| N12 | 127 | 59 | 50 | Old target survived parameter failure; side=kept survived. |
| N13 | 0 | 44 | 0 | Assignment returned 0; final target contained only index1=rhs-write. |
| N14 | 0 | 33 | 0 | Substitution-local readonly did not freeze parent replacement. |
| N15 | 127 | 38 | 50 | Old target and five-byte `kept\n` file survived parameter failure. |
| N16 | 0 | 540 | 0 | Function saw exported scalar prefix; sparse outer restored. |

Totals: **16 launches; 14 exit0, two exit127; stdout3247 + stderr468 =3715
bytes**. N14/N15 contain the two authorized Bash-managed substitution contexts;
this is a script-derived context allowance, not an independently measured process
count. One child-written regular file, five bytes; fixture peak four entries
including root/home/tmp. Captured file content precedes deletion.

## Integrity and limits

Pinned binary SHA256:
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Manual SHA256:
`f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5`.
Node metadata qualified Darwin25.4.0/arm64; authorized N04 itself displayed
BASH_VERSINFO5.3.0 and aarch64-apple-darwin25.4.0. No version/help/syntax probe.

All sixteen children naturally exited, emitted close, and were reaped; known
groups were absent at their recorded closure checks. No TERM/KILL was sent.
Summed row intervals201.376081ms; maximum18.907584ms. Observation timestamps
10:07:07.779–10:07:10.145 UTC include metadata. No deadline/output/integrity/cleanup
failure. The exact fixture file was unlinked and empty directories removed;
root absence was checked. This is observed closure, not an OS termination promise.

Binary/manual and all old sealed documents were checked before/after; every row
rechecked identity and new-entry census. Census detects additions, including
directories, within protected trees; it does not certify unrelated checkout
content. Accepted source identity remains 5137+CD+LET, not mixed HEAD.

**tests=0; productCalls=0; productImports=0.** GNU observations do not ratify
project choices, environment serialization, Linux/full-Bash parity, asynchronous
parent mutation, cancellation, private resource limits, or implementation approval.
