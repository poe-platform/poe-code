# HOLD — independent execution-bridge review

Reviewed only after the author's stopped handoff appeared. All 280 execution files
match the author manifest and remain byte-identical before/after this review.
No author/product/root/private/preparation edits, staging or commits.

1. **Blocking expanded lifecycle mismatch:** `execution/expanded.mjs:35` emits
   `snapshot-complete` inside the virtual-bash exec wrapper, before `exec-settled`
   and before the actual snapshot. The baseline branch never emits it. The real
   supervisor requires exec-start → exec-settled → snapshot-complete → dispose.
   All four original/aligned × engine synthetic API-adapter probes reproduce
   incompatible phase traces. Author sentinels bypass these adapters.
2. **Expanded raw capture is absent:** the adapter's final observation drops raw
   bytes on both branches, contrary to README/DIFFS. The unused inner virtual raw
   expression encodes public text, not stdoutBytes/stderrBytes. Historical scored
   binary channels remain intact in these probes; this is a supplemental capture
   defect, not evidence of product byte corruption.

Evidence: `attempt-001/adapter-controls.json`, `attempt-001/summary.json`.
14/14 real-child controls satisfied their independent expectations, including a
new real Worker leak and a child retaining stdout/stderr after leader exit. Those
negative observations remain failures after cleanup. 8/8 binding refusals and
9/9 static/CLI checks satisfied; 8 breadth adapter probes found no wiring issue.
All 14 owned groups and the extra descendant are absent. No product imports,
main observations, native oracle calls, installations or network sockets.

Author manifest SHA256:
`8a2130dfee34309ee5f5eb28869948e02a690c2f5e90031aa8693415b0c85b9a`

Execution-tree pre/post SHA256 (sorted path/bytes/SHA256 records):
`6e89b6f7896fca23606d4ffdf9a278a32dec03f7755deb27d9426cddcbc744c9`

Fix/reseal/review the two narrow author defects before MEASURE. Candidate70
SHA/pack remain absent; this is a bridge HOLD, not a current product score.
