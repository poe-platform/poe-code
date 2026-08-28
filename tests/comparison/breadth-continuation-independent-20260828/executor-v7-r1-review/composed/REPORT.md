# Independent composed executor review — August 28, 2026

**Scoped controls qualified; whole executor / real admission UNQUALIFIED.**
Different verifier, not the author. No candidate, product, author, historical,
peer, root-export or configuration edits. This report is not a root grant.

## Bound inputs and preexecution commits

- Candidate: `230ed3c6e15617b312760367adf9ede4e5c7ff6a`.
- Author evidence: `fedfca3c445696a19aaf84ac85bc74cff229d5c2`.
- Recipe: `05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d`.
- Interface: `913d051875c60492cce06937ff33b85bb4c9b36085b79169d5e51e87852880c4`.
- Original independent preseal/harness: `ad270991`; capture: `1f513881`.
- Supplemental F31 preseal/harness: `1acd6235`; separate `evidence-02` capture.
- Original seal: `3100e110a01858cfad031daec356abc7a3449060aebf94f9a858135d250dd2a6`.
- Supplemental seal: `206d2229506d2d55d8474aab85e56f8797136817118a791ada8bf4555a0f4e86`.

Both executions authenticate all **322 recipe inputs** before and after:
320 repository paths, of which313 match candidate Git blobs and7 are inherited
uncommitted files authenticated by the committed recipe's exact hashes; plus2
tool files. The seven are explicitly listed in `INPUTS.json`, not represented
as committed source blobs. All expected bytes/modes match, including the three
0444 inherited comparator source files, which are hashed as DATA, never imported.
Three additional bindings authenticate the seal and handoff bytes.

Both source namespaces match their28/30 declared entries, detecting added
entries outside excluded `runs` descendants. This is not an append-proof whole
checkout claim. All43 candidate helper modules actually observed by the import
guards match the presealed closure. No product/comparator source is in that
executable allowlist. Import guards are not hostile-host JavaScript sandboxes.

## Exact independent outcomes

**Original30/30; supplemental1/1;31 distinct families qualified,0 failed,0 unrun.**
This denominator is not an author score, command count, semantic cohort or full
admission gate. Twelve synthetic PASS rows are literal fixture data, not twelve
actual admission controls. `PRESEAL.json` contains every original expectation,
actual module binding, and exact static child recipe before execution.

F04 initially removed **receipt.failures**. The historical c6975254 defect2
instead removed **terminal.failures**. This coverage gap was disclosed after
the original run, whose180 raw files were committed unchanged. F31 was then
separately presealed and executed once. No original test was rerun or rescored.

### Integrated assessor and CLI counterexamples

- F01: actual outer → supervisor → body → store/report yields a positive
  synthetic receipt; the same receipt refuses real-authority assessment.
- F02: all literal rows PASS but actual exit7/close7; outer qualification refuses.
- F03: actual exit0/close0, CAPTURE_LIMIT, SIGTERM, natural:false, observed65537
  stdout bytes and retained65536; outer qualification refuses. The missing byte
  is not relabeled as retained evidence merely because the generator is known.
- F31: actual body publishes an accepted synthetic RESULT; an owned wire adapter
  removes only terminal.failures. Natural exit0/close0, empty supervisor failures
  and signals, complete byte counts, reaped child; actual outer refuses and
  assessor returns false, not TypeError. Restoring the original captured terminal
  as separate DATA restores synthetic qualification against the unchanged RESULT.
- F04/F05: actual composed receipt plus cross-realm own-data positive and16
  type/key/order/accessor/nonfinite/disposition/byte-count negative controls.
  Accessor calls remain0; validation does not depend on prototype identity.
- F06 is a **proper independent dynamic B16**, not author postcapture replay:
  the actual r1 `coordinator.mjs invalid never-admission` exits1/close1, with
  final report integer `children:0`, terminal array `children:[]`, and
  REPORT_STORE_UNAVAILABLE. Arguments refuse before configuration/authority/
  staging; no candidate run directory is created. A separate actual body →
  ledger → supervisor → real literal stub → persisted receipt → report chain
  closes and accounts for one child. These are not a nested production run.

### Cleanup, failure identity, evidence and bootstrap

- F07–F14: nonzero probe, attachment failure, receipt-persistence failure,
  setup0/null/undefined, primary Error plus cleanup failure, prelaunch failure,
  post-child tail failure and stdout failure. Actual known children close;
  emergency receipt, refusal and stderr fallback are retained where applicable.
  Identity assertions concern actual in-process thrown values; serialized error
  descriptions do not claim cross-process JavaScript reference identity.
- F15/F16: actual body RESULT is multipart, reads back correctly, then rejects
  altered part/reference hashes; original part bytes remain separately preserved.
  Actual store write-plus-close failure keeps both reasons, partial7-byte output,
  partial audit and subsequent publication failure. No failure fixture is erased.
- F17–F20: actual shared store/external128-byte boundary accepts exactly128,
  refuses plus1; actual body512-byte budget refuses. Unknown directory and mode
  tampering fail audits. Physical record262144 accepts,262145 refuses. Small
  transport cumulative overflow poisons further writes and refuses partial parse.
  Actual authorization-reference reader runs inside body controls with explicit
  unresolvable zero-commit synthetic references; tamper refuses, authority is
  never called and no usable root grant is created.
- F21–F24: actual loader → r1 query window → literal ESM import → factory boundary.
  Ordered module/worker_threads calls both return undefined; slot1 remains open,
  slot2 revokes immediately; captured aliases revoke permanently. Success, failed
  import and caught violations are observed before factory, with exact thrown
  reasons preserved. Three local source fixtures are0444; false0644 expectation
  is rejected. Fake native sentinel calls0; no builtin escape experiment runs.
- F25/F26 compose actual body controls with bootstrap observer/import callbacks:
  scalar/object/Error identity, dual failures, and nine sticky query negatives.
- F27–F31: exact source-mode/allocation constants, outer preflight0 and postflight
  undefined, actual ten-second deadline/TERM timer retirement, resource checks
  and the separate malformed-terminal counterexample complete this scoped set.

## Closure, boundedness and source observations

17 supervised children +2 driver processes = **19 owned Node processes**;
one supervised child at a time, all17 have exit, close, reaped and absent exact
PID/group checks. Both driver CLI sessions exit0. The two drivers themselves
have no independent hard watchdog/supervisor receipt; do not claim one.
Child deadlines10s, TERM2s, KILL1s; all use128MiB old-space, not an RSS bound.
Original families ran15:01:02.038–15:01:13.096 UTC; supplemental F31 ran
15:04:29.547–15:04:29.917 UTC. These timestamps are not a work-duration claim.

After settlement both drivers return to the single preexisting PipeWrap:
**zero added resources, zero timers/child resources, zero unhandled events**.
Raw captures:193 files,80 directory entries,1,467,949 bytes; largest physical
record262144. Conservative generated-input ceiling8MiB, below64MiB; no large
allocation or pressure test. Final metadata records every file hash/mode and
directory, including empty failed-fixture directories that Git alone omits.

F08 retains an **EPERM from the supervisor's immediate SIGKILL attempt** after
the injected attachment failure. Actual exit/close are SIGTERM and PID/group
are absent. The exception is preserved, not normalized away; its host cause and
general kill-race behavior are not qualified. No source fix was attempted.

The actual coordinator248MiB + collector8MiB split and stream64KiB/record262144
constants are bound. **Full quota boundaries remain STATIC_ONLY**. Dynamic
small-cap results do not establish full-cap allocation behavior, RSS, or an
8MiB collector-overflow run. Multipart reading also materializes parsed data;
record limits are not independent memory guarantees.

## Readiness and remaining integration blocker

The actual production worker authenticates a real authority/config path and
hardbound consumer/comparator source profile before import. Literal owned stubs
cannot satisfy that chain. Executing it would exceed this DATA/SYNTHETIC/STUB
authorization. It was not patched, bypassed, staged or launched. Thus the whole
worker/admission chain, real engines and any deployed interoperability remain
**UNQUALIFIED** despite passing scoped composed controls.

Actual engine imports, real package staging, real admission, C11, cohort,
native oracle, private package, network/install, timing cohort and XAN: **zero**.
Parent decides combined readiness with the separate SOURCE/DATA/interface
reviewer and receives that reviewer's next **unexecuted** interface. No admission
command, root grant or overall GO is supplied by this verifier.

Author d180c3e4 original31/33 with two harness failures and28 reaped children,
author r1 postcapture2/2 plus12 negatives, becd1647 lost294045 bytes/oversized
artifacts, old13/54 versus47/54, and W07 UNQUALIFIED/consumed tokens remain
unchanged. No superiority, universal parity, full gate or completion claim.

Machine evidence: `FINAL-EVIDENCE.json`, `ORIGINAL-MANIFEST.json`, original
`evidence-01/F01.json`–`F30.json`, supplemental `evidence-02/F31.json`, raw
receipts and import logs. All source hashes are in `INPUTS.json` and the two
preseals; no instruction plaintext is copied into evidence.
