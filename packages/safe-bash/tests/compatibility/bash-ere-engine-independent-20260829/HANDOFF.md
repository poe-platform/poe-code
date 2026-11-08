# Independent engine verdict: correction required

2026-08-29. Reviewer separate from author Plato. Frozen source
`f97fd06024cb63edfd01873d81d84576a22189db`, author evidence
`8bd170e5465c1253a52231c9cf08b5afef064d81`. Independent preseal commit
`5caf8e2d`; executable SEAL SHA256
`b5f681614a4f52373210202c0a573e9009d8e80920d1e3880315b0ab84c3f70b`.

## R01 — nested captures survive a later nonparticipating parent iteration

**Actual stock engine failure against documented last-parent-match reporting.**
The same seven independent groups fail in independently compiled source output,
installed regular-file artifact, and that physically moved artifact. Whole match
and last outer capture are correct; inner captures incorrectly point outside the
last parent's span. Returning empty string alone is insufficient: participation
must also become null, not a stale nonempty span.

| ID | Pattern / subject | Actual stale inner span | Required inner span |
|---|---|---|---|
| I01 | `(a(b)?)+` / `aba` | group2 `[1,2]` | null |
| I02 | `((a)\|(b))+` / `ab` | group2 `[0,1]` | null |
| I03 | `((a(b)?)c)+` / `abcac` | group3 `[1,2]` | null |
| I04 | `(ba(na)*s )*` / `bananas bas ` | group2 `[4,6]` | null |
| I05 | `(a(b)?){2}` / `aba` | group2 `[1,2]` | null |
| I06 | `((a)?b){2}` / `abb` | group2 `[0,1]` | null |
| I23 | `((a)\|(b))+`,62 strings lengths1..5 |52 stale-participation counterexamples|last-parent-local participation|

The table escapes pipe only for Markdown; fixture strings contain ordinary ERE
alternation. Exact captures/values before assertions are in source/installed/moved
independent stdout and SUMMARY.json. I07 separately passes for a genuinely empty
last-iteration capture, so this is not an empty-string/nonparticipation conflation.

Source chain: matcher.ts group entry lines145–148 forwards the old captures;
repeat re-entry lines108–112 does the same. Close handling lines94–102 overwrites
only the closing group's slot. Nothing clears descendants when a new parent
iteration skips them; publication lines165–169 returns those old spans. These
line references refer to the frozen engine/2.data, not mutable product HEAD.

Primary GNU libc manual, Subexpression Complications10.3.5, documents that nested
results reflect the final parent's match; its bananas/bas example corresponds
directly to I04. The frozen design README lines101–105 expressly calls for proving
nested last-iteration behavior and warns against assuming stale state is valid.
This is standards/documentation-derived expectation plus actual pure-engine
observation, **not a captured GNU Bash/libc/native oracle result**. Historical
WG15 ambiguity about maximization of repeated subexpressions does not explain
these examples' unambiguous, consumed parent-iteration boundaries.

Author E12 explicitly expects stale `b`; all author's66 groups still pass unchanged.
That is a detected author-oracle conflict, not evidence the new tests should be
weakened. Recommended author repair: separate matching-history comparison from
published last-parent-local participation; correctly clear/reset descendant
capture state, charging any added copying/reset work before growth. Preserve
historical E12 and require explicit justified fixture revision, not a mass update.

Primary reference:
https://www.gnu.org/software/libc/manual/html_node/Subexpression-Complications.html

## R02 — source-qualified checkpoint gap, not an observed timeout

matcher.ts historyOrder lines30–48 checkpoints only when the remaining linked
history count is divisible by256. With two identical255-entry histories no such
checkpoint occurs:255 outer charges plus2×(254+...+1)=65,025 charged work units.
`(a){255}(|)` /255 `a` characters is a source-derived candidate reaching equal
histories through two empty alternatives. It was NOT executed in this review;
there is no measured latency, missed-cancel or deadline claim. Charge arithmetic
is finite DATA proof; admission/reachability should be checked by the author.
The design's cooperative alternative requires checkpoints in tag-comparison
loops. Prefer ledger-work-based checkpoints inside traversal rather than history
length divisibility. This source issue is additional to the actual R01 failure;
do not count it as another actual failing case or use it to claim hard preemption.

## Actual finite results

- Each of three layouts: unchanged author66/66; independent17PASS/7FAIL.
- Across layouts:249PASS/21FAIL of270 group outcomes;90 group IDs with deliberate
  input overlaps. I23's62 checks/52 contradictions are nested, not62 extra groups.
- Strict build succeeds;6 type executions pass, exactly9 negative diagnostics
  (TS2345/TS2339/TS2322 once per physical layout), no unexpected diagnostics.
-6 distinct loaded mutations killed and6 semantic restores pass;2 hash/path
  admission refusals occur before product load. These controls are separate from
  stock semantic totals. Original artifact identity restored after every mutation.
-27/27 known children retired naturally; no timeout, signal, capture, integrity,
  deadline or unknown-retirement stop. Runtime owner+child peak2. Actual coordinator
  elapsed8,491ms; raw child capture239,356bytes; owned work27,517,553bytes/275files.
  Publication/admin elapsed is separately recorded, not hidden in that runtime
  duration. Known-start bookkeeping is not OS-wide census or enforced OS quota.

## Limits, qualifications, ownership

Finite121-pair BigInt-derived arithmetic checks independently agree with all
saturating ceiling formulas, including zero/MAX_SAFE_INTEGER. Direct ledger
cumulative/high-water/no-refund, poison/caller reason identity, concurrent author
admission and cooperative cancellation controls pass. This does NOT demonstrate
root-invocation/descendant integration, genuine global ShellLimitError propagation,
worker crashes, reply validation, public status mapping or full cancellation
coverage. Those interfaces were not activated. Capture-history ordering beyond
this finite set is not formally proved; no full POSIX/Bash claim.

All product imports are the authenticated five-file standalone closure plus
Node timers. Types use emitted declarations; strict source compilation is a
separate proof. The11-member artifact is copied then physically moved; no npm
install, whole package/root import, native oracle, Worker, transport, Shell `=~`,
Node guest engine, private project or network execution occurred. Product unchanged.

Retained ACTUAL-01/work contains known owned compiler/types/source/emits and is
untracked; it is not an active process or unknown cleanup. No automatic cleanup
of prior/foreign archives. Earlier reviewer seal.mjs `name` versus declared `path`
field error is preserved with its raw refusal; corrected seal-v2 did not change
candidate or fixtures. Preparation47 known starts by explicit process roles;
editing-helper hidden descendants remain qualified, not invented measurement.

Route R01 to Plato for source correction and independent rerun against a new
frozen candidate. Route R02 for bounded source/observer confirmation. Do not promote
this source based on author's passing corpus or the passing limit/type controls.
