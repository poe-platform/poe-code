# Pre-integration fixture correction, v2

Both versions precede Stage2 author integration. Original v1 files remain fully
recoverable as base64 members of `baseline.data.json.gz`; `FREEZE.json` and the
original raw results are immutable. The executable `cohort.mjs` now corresponds
to `FREEZE-v2.json`, on the **same** product source revision as v1.

The v1 runtime baseline was 13 pass / 13 fail / zero cancel, skip or TODO.
Twelve failures exercise the absent Stage2 seam. R25 was instead a reviewer
mistake: it demanded iterator.return after cat had already consumed natural EOF.
Existing `src/shell/input.ts` InputCursor.close explicitly does not call return
when `#ended` is set. This is not a Stage2 defect, product regression or waived
cleanup failure.

Exact semantic delta: R25 natural-EOF return count changes from 1 to 0. To retain
a meaningful return/cleanup guard, R25 additionally invokes actual `head -n 0`
with an explicitly owned unread byte source and a local signal, requiring next
0 / return 1. Binary bytes, acquisition count, sink override, redirect contents,
following output and all other original assertions remain.

The outcome assertion helper now rethrows an unexpected captured error rather
than replacing it with the generic `throw != return` diagnostic. That changes
only failure reporting, not accepted outcomes. The baseline runner gains explicit
v1/v2 immutable filenames and reuses the frozen v1 product revision for v2; it
does not follow moving HEAD. No other case expectation or production byte changes.

Public typing of `{signal: undefined}` and native live-undefined delivery remain
the explicit questions in POLICY.md; this correction does not decide either.
No candidate mutation was executed and no source implementation was accepted.
