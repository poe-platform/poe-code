# Narrow post-v1 diagnosis — pre-execution

The original source and moved v1 results remain100/103 each: frozen P39/P58 and
author A23 failed. Negative-api correctly reports TS2724 but the frozen matcher
expected TS2305; original result remains a verifier reject. No fixture or product
change, rescoring, type rerun, rebuild, pack rerun or broader cohort follows.

Exactly **two fresh child invocations / seven new diagnostic observations**:

- Accepted464 rebuilt M0: three observations. Replace only P39's LET operation
  with ordinary `OPTIND=1` to observe no function arguments; run original P58
  unchanged to observe refusal before LET; observe the delayed child-cleanup
  boundary with `:` as a non-LET control.
- Exact candidate's installed/moved package: four observations. Explicitly
  supply `work "$@"` in the P39 neighbor; observe `let absent` without unsupported
  `set -u`; compare owned child cleanup for both `:` and LET.

Delegating Runtime observer records actual function positional arrays and
set/getopts/LET admission. Owned cleanup receipts record new raw child rejection
name/message/stack, root status, event order, pending-before-release and disposal.
Old A23 serialized its Error as `{}`: its missing original name/message is NOT
recovered or synthesized from these new receipts. Do not assume child success
from root success; diagnosis records both and compares the accepted baseline.

Each child has a30-second/1MiB output bound and must close/reap. Reuse unchanged
authenticated load hook, exact old source/package manifests, pinned Node; guard
complete loaded input bytes before/after. All scripts and binding hashes are
sealed before either child executes. These are diagnoses, not repaired frozen
case qualifications. Plato/root owns any narrow freeze reconciliation.
