# Actual ordinary pilot: HARD_STOP, consumed

The operational owner was frozen before launch in commit93f5ea93a. Its10776-byte
source normalizes exactly to the prior owner under the four declared DATA
substitutions; all4 controls and5378 file bindings passed. This implements ROOT's
explicit conditional authority, not a new independent owner review. No engine,
coordinator, profile, evaluator, teardown, observer or oracle logic changed.

Issued2026-08-29T17:47:02.990Z, latestStart17:57:02.990Z, expiry18:07:02.990Z.
Frozen hrtime origin269035121 was not reset. Owner started17:47:28.368Z,
admitted17:47:29.397Z and finished17:47:37.227Z. At finish1165763ms remained,
including the unchanged180000ms publication reservation. No timeout or signal
was used. One attempt is consumed; there was no retry or next case after failure.

## Exact observations

- Two offline ignore-scripts installs completed: install-installed PID7893 and
  install-moved PID7937, each exit0 with independently observed exit, close and
  both stream EOFs. Each stdout reports one package added. This is only the
  qualified internal dev-npm setup, not public npm install compatibility proof.
- One case process launched: source-built/R01 PID8003, exit1 with exit, close and
  both stream EOFs observed. Raw stdout293B, stderr202B. Final result is null.
- The case raw final record preserves failure.present=true, primary phase
  public-cell, reason {type:object,opaque:true}, no secondary failures. The native
  ownership receipt's failure.present=false does not erase that case failure.
- Denominator24: 0 PASS, 1 nonpass (coordinator label FAIL), 23 UNRUN. No completed
  public Shell result or oracle comparison was recorded. Shell.exec entry is not
  instrumented, so attempted public-call count is unconfirmed (at most1), not
  invented as zero or one. Zero Worker starts/objects were recorded; this is not
  an independent process-wide no-Worker proof.
- Coordinator PID7851 exited1; its exit, close and both EOFs were observed.
  Outer owner PID7837, shell parent7835. No unknown process ownership remained in
  these receipts. Process closure is not credited as Worker retirement.
- Coordinator FINAL reports childStarts3, workerStarts0, complete=false,
  aggregate capture admitted1567/58720256B. Outer managed capture161B stdout,
  0B stderr. Sampled final logical work22392758B. This is sampled/quiescent,
  non-atomic, not an OS quota/native peak/prewrite work guarantee. Source/tool/
  archive postguard passed. Conditional254938146B bound was not increased.

## Precise remaining blocker

The captured exception is opaque; its name, code, message and throw site are not
available. No additional execution, fault injection, telemetry change or product
test was performed to reconstruct it. Stderr contains only Node's allow-worker
SecurityWarning, which is not evidence of the primary cause.

Source inspection identifies a concrete consumer-binding hazard, not a proven
recorded throw: runtime-author-v1/cell.mjs:23 calls
createRequire(import.meta.url).resolve('virtual-bash') before observer creation,
dynamic import or Shell.exec. The materialized source-built package exports["."]
contains types/import branches but no require/default branch. Thus the harness
uses CommonJS resolution to check an import-only public entry. This is consistent
with the observed id, null result and empty worker list; the opaque receipt does
not establish that it was the actual thrown exception. Future closure needs
separately authorized/reviewed consumer-binding diagnosis/repair and adequate
bounded raw-error evidence, followed by new actual-attempt authority. No repair
or new attempt is implied by this publication.

## Publication and preserved scope

Raw captures, EMERGENCY.jsonl and FINAL.json were written before this metadata.
The exact R01 config, consumer package manifests and executed cell copy accompany
them. Existing full package trees and native caches remain in place, not deleted,
reinstalled, archived or silently treated as committed. Immutable shipping bytes
remain bound by the previously sealed profile and successful source postguard.
Publication size/hash manifests enumerate only explicitly selected evidence;
they are not a claim of a fresh whole-filesystem census. Trusted startup captures
use the accepted reserved/postchecked qualification; managed prewrite limits
remain unchanged. Git physical storage and native/npm qualifications are retained.

Preparation used8 known roles, below16. Actual-phase role accounting through
planned publication is20 conservative named roles: outer shell/owner/zsh/env/
coordinator5; two installers plus one cell3; three inspection shells plus rg4;
report shell/apply_patch2; publication shell/date/wc/shasum/two Git6. Reserve one
possible command-substitution shell and one qualified infrastructure-owner role:
22/40 actual,30/56 combined, known local peak<=4. No second DATA helper or runtime
attempt. Additional hidden physical processes or OS containment are not claimed.

Historical8317555c late refusal, DATA profile-size STOP, f28462050 missing-owner
refusal and overstated READY remain intact. The original24-cell historical
attempts remain UNRUN in their own cohorts. This new cohort is1 nonpass/23 UNRUN.
All broader CORE210/T1135, private/nonpublic, type and full acceptance gates remain
OPEN. No engine compatibility or fault-retirement acceptance transfers.
