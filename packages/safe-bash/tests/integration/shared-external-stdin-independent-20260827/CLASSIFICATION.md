# Original 32-case baseline: all 14 failures

**No candidate acceptance. Revision `92f76262` is PROVISIONAL and is not
root-approved.** Root's coordination file was first observed after that revision
was committed/executed. No further executable expectation changes are made.
The separate fixture-adjudication owner decides whether the proposed corrections
are valid. Its subtree is not owned or edited by this leaf.

Original freeze: `0ec75ef320ecaea9fc66e1ba952f3961c917685c`.
Exact baseline: `eaed12f88365e69597994c4f2e6324a020202b66`.
Original successful setup/run: evidence/attempt-2, **18/32 passing assertions,
14 failed observations**. Controls are separate, **2/2 detected**, not behavior
passes. The provisional replay is evidence/attempt-3, **25/35 compatible, ten
failed assertions**, not a replacement denominator or an approved correction.

| Original failing identity | Actual original status/effect | Classification and proposed delta |
| --- | --- | --- |
| shell-eof-sync | Child 1; exec fulfilled status 0, empty stderr; bytes 00ff80; 3 reads, 0 returns | Fixture overreach: observed EOF bypasses unused return. Propose status 0 and zero return; preserve exact bytes/reads. |
| shell-eof-reject | Child 1; exec fulfilled status 0, empty stderr; bytes 00ff80; 3 reads, 0 returns | Same unused-return fixture overreach; not a swallowed invoked rejection. Same proposed delta. |
| shell-eof-zero | Child 1; exec fulfilled status 0, empty stderr; bytes 00ff80; 3 reads, 0 returns | Same unused-return fixture overreach; 0 was never thrown. Same proposed delta. |
| shell-early-sync | Child 1; exec fulfilled status 0; bytes 00ff; 1 read, 1 return | Genuine normal-close defect: synchronous return throw lost. No expectation change. |
| shell-early-reject | Child 1; exec fulfilled status 0; bytes 00ff; 1 read, 1 return | Genuine normal-close defect: return Error rejection lost. No expectation change. |
| shell-early-zero | Child 1; exec fulfilled status 0; bytes 00ff; 1 read, 1 return | Genuine normal-close defect: exact primitive 0 rejection lost. No expectation change. |
| shell-status17-unread-sync | Child 1; exec fulfilled status 17; no bytes; 0 reads, 1 return | Genuine normal-close defect: nonzero result hides synchronous return throw. No expectation change. |
| shell-status17-unread-reject | Child 1; exec fulfilled status 17; no bytes; 0 reads, 1 return | Genuine normal-close defect: nonzero result hides return rejection. No expectation change. |
| shell-status17-unread-zero | Child 1; exec fulfilled status 17; no bytes; 0 reads, 1 return | Genuine normal-close defect: nonzero result hides reason 0. No expectation change. |
| shell-deferred-eof-return | Child **13**, unsettled top-level await; no case result or finally-cleanup receipt | Fixture waits for return after natural EOF although no return occurs. Not a timeout waiver. Propose distinct early-stop identity with readiness-driven pending return, keeping original failure. |
| shell-primary-read-zero | Child 1; exec fulfilled (full value not captured by original fixture); 1 read, 1 return | Wrong original expected primary rejection: ordinary command failure becomes status/diagnostic. Propose exact diagnostic plus required outer-close rejection, and separately test direct primary reason 0. |
| shell-primary-read-error | Child 1; exec fulfilled (full value not captured by original fixture); 1 read, 1 return | Same layer error: ordinary Error is not selected public execution rejection. Propose exact diagnostic plus outer-close rejection; direct Error precedence separately. |
| shell-primary-sink-error | Child 1; exec fulfilled (full value not captured by original fixture); attempted bytes 00ff; 1 read, 1 return | Ordinary sink error is diagnosed as command failure. Propose exact diagnostic/bytes plus outer-close rejection; selected public ShellLimitError precedence separately. |
| shell-sequential-nested-binary | Child 1; status/output assertions passed (00ff8041, empty stderr); 4 reads, 0 returns | Fixture wrongly adds return after terminal EOF. Propose zero return, retain nested literal invocation, intermediate no-close and all byte/read checks. |

## Exact baseline support and limits

- `src/contracts/io.ts`, readBytes: sets finished on observed EOF and only calls
  return when unfinished. It retains a caught primary error, and observes rather
  than awaits cleanup on abort. This supports the direct layer, not a universal
  requirement that every wrapper call return after EOF.
- `src/shell/shell.ts:170`: selected execution rejection sets failed; its finally
  awaits stdin.close and propagates a close error only when no execution failure
  was selected. A normal nonzero result does not set failed.
- `src/shell/runtime.ts:495`: ordinary command failures are diagnosed and mapped
  to status; ShellLimitError remains a selected rejection. This is why the original
  primary-read/sink assertions used the wrong public-outcome layer.
- `tests/shell/lifecycle.test.ts`, final test: a throwing input next yields command
  status 1 with read-failure stderr and exactly one owning return, not rejected exec.
- `src/contracts/command.md:99`: exact caller reason, selected execution rejection,
  then registered cleanup error, then command result. The registered ownership
  contract does not transform a raw input iterator into registered cleanup.
- Actual original and provisional packed runs independently show natural EOF
  produces zero owning returns. This is an observation, not a new blanket promise
  about every possible filesystem adapter or iterator wrapper.

No live/candidate input implementation was inspected; no product changed. The
frozen baseline input bytes were machine-hashed for package authentication, not
read as a proposed fix. No new source problem distinct from the known normal-close
error loss is established by this cohort. All original errors, including the
fixture exit 13 and setup failure, remain sealed. Proposed deltas are explicit;
their executable provisional revision does not constitute adjudication approval.
