# ERE12 actual observations — independent artifact audit pending

Date: 2026-08-29. One exact approved native invocation completed. **Twelve qualified
capture observations, not twelve semantic passes.** No retry or additional native
query occurred. Stop here for independent artifact audit and ROOT R01 adjudication.

## Authority, source and reference identity

- Source: `2d07f5921010fda988dcda36ac81a89831fbac55`.
- Activation: `016aa3a940c19dc17fd94bce0ed7468676e1d5c5`.
- Resolved-slot acceptance: `a1d03bcb9be30b60b784b25abe510a7e2a23c9eb`.
- Executable preseal:
  `211483cbe1b12ad505345da5396a227c7da9931743d035ed365f7cc74bb4d457`.
- GO: `9eec9e95250998fc3bf78ee8727bbfbbba6d32c7aab42155291a5cea34a753ec`.
- Exact command:
  `9423c7e1d4bbbc6c77bef3962bfe97b93fe333f65263cb2f4df12f555a239e25`.

Fresh DATA preflight passed at 10:16:29.976 UTC. The exact accepted parameters were
submitted with `require_escalated`, `login:false`, no prefix rule; the tool started
the owner and later reported exit 0. See the explicitly agent-recorded
`TOOL-RETURN.json` and original tool transcript. No default-mode fallback.

Executed binary: `/bin/bash`, SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
It matches the previously captured local **Bash 3.2.57** metadata. The four pinned
tools were freshly hashed before activation; source/data members were checked
before and after, with final tool hashes checked again at sealing. There was no
new version probe. This is this local Bash/platform's output, **not GNU 5.3**, all
libc versions, complete POSIX semantics, or containment qualification.

## Exact shell-visible observations

Values below are JSON representations of present `BASH_REMATCH` slots in index
order. `OBSERVATIONS.json` preserves each slot's presence, bytes/base64 and hashes;
`runtime/captures/Nxx/stdout` preserves the original NUL-framed binary stream.

| ID | Regex/process status | Cardinality | Present values |
|---|---:|---:|---|
| N01 | 0 | 3 | `["aba","a",""]` |
| N02 | 0 | 4 | `["ab","b","","b"]` |
| N03 | 0 | 4 | `["abcac","ac","a",""]` |
| N04 | 0 | 3 | `["bananas bas ","bas ",""]` |
| N05 | 0 | 3 | `["aba","a",""]` |
| N06 | 0 | 3 | `["abb","b",""]` |
| N07 | 0 | 4 | `["ba","a","a",""]` |
| N08 | 0 | 3 | `["ab","ab","b"]` |
| N09 | 0 | 2 | `["b",""]` |
| N10 | 0 | 2 | `["b",""]` |
| N11 | 1 | 0 | `[]` |
| N12 | 2 | 0 | `[]` |

N09 and N10 have identical empty shell-visible values: no native spans or hidden
nonparticipation can be inferred from them. N01–N07 are the finite conflict
witnesses, not the complete I23 enumeration. No ERE engine or product was rerun,
and no historical engine result is rescored. ROOT decides R01 after artifact audit.

## Capture and lifecycle evidence

Owner RESULTS records completed 12, halted false, exactly 13 charged/confirmed
managed starts (owner + 12 cases), peak two managed roles, zero source-internal
fork reservations. Each case has exit and close observations, `signal:null`,
`stop:null`, no errors, retirement true, and observed owned process-group absence.
The owner is still recorded active at its pre-exit RESULTS write; the subsequent
tool exit 0 establishes owner retirement, not an inferred leaked process.

All stdout/stderr captures match disk bytes, sizes, SHA256 and base64, with flush,
size/hash and close checks true. Both outer captures also match. Every case's
before/after namespace snapshot agrees. Final owner credit is corroborated by
completed 12 and the exact ordered twelve journal credit events. Saved per-case
JSON legitimately precedes `receiptPublished=true`; that source ordering is
preserved rather than silently changing its stored false field.

Readback qualified all twelve with **no qualification errors**. Raw runtime
inventory is **52,128 bytes**, copied byte-exact under `runtime/`; original files
remain at the owned run root for independent audit. Observation manifest SHA256:
`d77e2767f6b36a9ec710224ef31faa53ec388304b5616a4818e18657bf1cb274`.
`FINAL-SEAL.json` binds the complete publication, runtime membership and final
source/tool checks. It does not turn source-derived reservations into an OS census.

## Budgets, ownership and stop

Fresh actual-preflight start: 10:16:29.774 UTC. Its inclusive 600-second deadline
is **10:26:29.774 UTC**; native execution and initial readback publication completed
by 10:17:19.402 UTC. Final sealing and commit occur inside the same window, without
reset. The fixed GO expiry remains 10:46:09.884 UTC; it is not renewed. The one
authorized actual attempt is **consumed**, even though its timestamp has not yet
expired. Do not replay the command.

Known direct starts: context 4 + preflight 7 + native owner/cases 13 + readback 3 +
final seal/commit 8 = **35**. Charging an additional wrapper executable role
conservatively yields **36**, below 40. The source plan's 32-role estimate did not
include four final-readback/sealing roles; the actual ledger preserves that delta.
Peak three known roles; no claim of a global process census or kernel quota.
Zero Worker/product/engine/comparator/private/network/native-version/P2/XAN/old-gate
activity. Exact literal programs, zero fixtures and empty stdin were unchanged.

Initial tool-shell startup remains trusted host outside cohort fresh-environment
and raw-capture qualification. All owned processes are retired. Runtime evidence
is deliberately retained, not abandoned live work. No cleanup, new query, source
repair or further activation follows this handoff without ROOT direction.
