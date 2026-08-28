# Preserved first independent execution: orchestration defect

The immutable `review-01.json` records the first attempt under runner commit
6978a89c75284b9e7e0efb125fef7a6b78ee8572. It must not be treated as its printed
99 PASS / 99 FAIL / 1 UNSUPPORTED / 7 NOT_RUN summary.

The Node write grant named a not-yet-created directory exactly, without its
descendant wildcard. Creation of that directory succeeded, but H001-H098 and
C01-C21/M02 fixture preparation could not create descendants. Thus **120 controls
never reached their intended repaired DATA entrypoint**. The first runner also
mistook the preparation error as rejection success on the 21 negative controls
C02-C21 and M02. These are independent verifier defects, not author failures and
not admissible passes. Preserve every original record/stack as evidence.

Corrected first-attempt accounting is **79 actual controls: 78 PASS and
1 UNSUPPORTED (P28); 127 NOT_RUN including 120 preparation-blocked controls**.
No actual repaired capture conclusion can be inferred from its C-series results.
D03 and D04 did execute on the authenticated existing captures: their full
50002/98, stored tree, old276 object/274 selection and derived composition results
are separate from the failed synthetic fixture preparation.

The additive v2 runner/launcher correct only the fixture descendant write grant
and classification of preparation-level permission failure. It does not modify
the author, original206 inputs/expectations, preseal8, first runner or first receipt.
The grant remains limited to the one exact unique owned synthetic directory and
its descendants; no new external read/write, spawn, worker or network grant.
The second launcher includes the first attempt's start in its 15-minute deadline.
All v2 source/tool/child recipes are presealed in a separate atomic commit before
running any holdouts again. Both attempts and duplicate observations remain
distinct; the second attempt is not an increased denominator or an author retry.
