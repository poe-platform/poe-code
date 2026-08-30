# B35 v4: S01 only

Original source52b6711e/package275a6c10, startupSTOP0/54, N02/N03 and S01 SOURCE HOLD26d5b58a remain unchanged. F01/F02 already qualified by that independent review; they are NOT rerun or rescored here. No GO/window.

Only executable behavior delta is direct-child.mjs::openCapturePair and its callsite. Partial-open failure enters Primary before cleanup; close runs once independently. The supplied ledger receives a nonqualified capture-open lifecycle row with explicit primary/secondary presence and acquired/closeAttempted/closed/failurePresent fields. ledger.stopped blocks dependent admission, no child/start counter is credited, and failed close leaves one unresolved capture acquisition (not a claimed OS child or proven leak). The exact original thrown value is rethrown without wrapping or mutation, including undefined/null/false/0 and frozen Error identity. No retry of a failed close. The receipt is in the supplied owned ledger; this does not promise successful disk publication during arbitrary FS faults.

The new export is harness-private for injected-operation proof. The normal two-open success path and every subsequent direct-child byte are unchanged. Reverse patch reproduces the exact frozen helper. All other executable bytes are identical except absolute packet/work-path rebinding for the new namespace; collector/time/finalization/permissions/budget behavior unchanged. No new framework or runtime role.

Eight fixed PURE groups: four falsy open/close pairs; frozen Error pair; stderr-open failure with successful close; first-open failure/no close; normal fd0/fd1 success. Assertions use raw identity and explicit caught-presence, close counts, separate receipt values, unchanged start/active counters and stopped admission. One Node helper, zero nested children/actual descriptor faults/readiness/product/compiler/native/Workers. This is synthetic fault evidence, not OS-fault or leak proof.

Actual prospective envelope remains65runtime+7admin=72known OS/peak3/25min inclusive/96MiBcapture/512MiB logical work.54primary+24legacy+5mutant Shell.exec invocations,3mutantchildren/2bindingrefusals/types3 remainUNRUN. Grant schema b35-runtime-grant-v3 and review scope b35-preexec-v3 are deliberately unchanged; new preseal and fresh independent commit prevent old receipt reuse. All PENDING fields remain nonexecutable.

Initial host/tool/zsh startup and failures while establishing bootstrap redirections remain externally observed, not retrospectively covered by internal raw files. No OS-containment/group/full-census/RSS guarantee.
