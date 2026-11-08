# Direct transfer authority regression

Author-only, August 27, 2026. Baseline source:
`0e69b39a61cd94d8bb5897be4bc863dd6b0201dd` (legacy LOCK fix only).

The immutable `evidence/legacy-apache-before-alias` packed-service cohort first
measured the direct entrypoints: both ordinary distinct default overwrites passed,
but 12/15 guards failed. Four alias cases reached LOCK and COPY/MOVE before Apache
refused with EACCES; their actual host bytes and hardlink/symlink names survived.
This is not a claim of alias corruption. Six callback error/unknown/cancel cases
instead completed destructive transfers: COPY replaced the old target, MOVE also
removed the source. Two lexical self-rename cases bypassed callback error/conflict.
Every row retains actual method/status events and post-row host witnesses.

`direct-comparison.test.ts` reduces this to an injected HTTP transcript, with the
unchanged real captured Apache LOCK grant rather than the owned Mock. Before the
fix, 2/23 pass and 21/23 fail (`evidence/direct-before-fix`). This also catches
callback omission in otherwise successful distinct operations. This synthetic
regression does not substitute for the separate packed real-service replay.

Rule proposed before editing: before replacing an existing entry, honor an
explicit constructor callback or public override using the existing shared
comparison negotiation. Known same means EINVAL, explicit unknown ENOTSUP;
callback errors, invalid answers, cancellation reasons, override precedence and
known protocol identities retain their existing handling. Same lexical paths
still require callback observation; an asserted distinct result conflicts with
that known identity. Absent-target creation and native operations without an
explicit authority retain their existing protocol guards. No new public API,
synthetic client identity, response repair or mutation-based identity probe.

The guard negotiates once per direct operation. Wrappers may independently check
before delegating; no cross-operation cache/lease is added. The shared contract's
once-per-authority rule applies within each negotiation; this does not promise a
single callback across every layer of a composed operation. Root should assess
any stronger whole-stack requirement separately rather than adding an unsafe
cache here. The comparison remains an observation, not a transaction/ABA defense.

After the source patch, `evidence/direct-after-fix` records 23/23 direct tests,
23/23 legacy LOCK, 5/5 timestamp regressions, 564/564 scoped existing WebDAV,
14/14 constructor checks separately, and all 49 unchanged historical alias tests.
Strict scoped types and isolated full source/declaration build pass. Required49
fixture hashes equal the historical and current inputs; its writing runner was
not run and its owned tree was not modified. Live provider acceptance is recorded
separately in the phase-two report; WsgiDAV protocol failures are not waived.
