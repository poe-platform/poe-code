# Independent production regex review

Only this newly owned directory is editable. Product author owns executor and
grep/search adapters. No subagents. Prior evidence is immutable in
`prior-evidence.tgz` with per-file hashes in `evidence/baseline-freeze.json`.

Baseline snapshot consumes static public-index dependency closure, not unrelated
tests or live dirty files. Initial inspection observed dirty parser/runtime;
their consumed bytes and HEAD identities are recorded at freeze. They were
committed by their owner before capture; freeze reports no dirty consumed files.
This does not establish a clean repository/full gate. Fullgate e36dab2 is separate.

Before handoff: freeze public source/options, 24 tiny benign command cases,
22 primary native calls (12 rg / 10 Darwin BSD grep), exact stdout/stderr/status,
and native availability. GNU grep unavailable. Original `rg-onlyempty` independent
expectation differs from baseline: baseline emits empty matches around `aa`;
retain both the original expectation and exact baseline output, do not rebaseline.
The named-backreference case may change only under the explicit approved policy,
with native rejection evidence and a separate compatibility regression.

After handoff: isolate and hash handed-off production source; freeze independent
expectations before execution. Verify public lifecycle, packed/moved assets,
exact original command cohort, small output-gated timing including startup,
queue/cancellation/fairness/bytes, cleanup/fatal/protocol precedence and isolation.
Report exact source defects before any author fix via the findings marker.

## Risk ledger (frozen before any new risk)

- Historical 12: archived, not executed by this reviewer.
- Prior revision: 0/6 consumed, not reassigned here.
- New authorization: six additional; author reserves two; reviewer reserves four.
- Reviewer consumption now: 0/4. No transfer or retry without root.
- Maximum four tiny fixed pathological inputs, compiled static worker only.
- One owned child at a time, <=250ms watchdog after ready, bounded heap/output,
  exact owned handle termination and awaited close. No eval or main-thread risk.
- First run benign safety controls. Each risky launch requires its own durable
  claim record before spawning. Default 1000ms cannot be observed by outwaiting
  250ms; inspect defaults and distinguish short configured policy observations.

Do not expand during waits. Root notes and architecture markers are coordination
inputs. Final acceptance is conditional source acceptance, never root default
acceptance, full parity, superiority, or duration completion.
