# Future binding checklist — no v2 API inspected

The seven intention/input records were frozen in
`eb78897cb276e29637ebae30c10aa0e448e31bc6` before this checklist. This file
does not propose names, select an unseen API, or weaken a case. Historical v1
names seen in the permitted old BINDING are not assumed to be v2 imports.
`scaffold.mjs` deliberately refuses `run`: there is no product driver here.

## Required before author implementation access or execution

- Obtain root-observed **appropriate v2 author actually CLOSED**, immutable
  v2-ready identity, evidence commit, complete source/test/patch manifests and
  declared toolchain. A v1 ready, provisional declaration, status file, or
  commit without observed closure does not qualify. Do not resume this leaf.
- Authenticate the accepted base plus three dirty files against the supplied
  source manifest; restore only into a fresh uniquely owned temp directory.
  Record exact v1-to-v2 patch identities and any intermediate failure evidence.
  Do not use live source, root dist, package installation, or a global build.
- Read only root-authorized declaration bytes first and freeze their exact
  hash alongside a **separate** binding manifest and exact fixture delta.
  Preserve `INTENT.md`, `cases.json`, `inputs.json` and `freeze.json` untouched.
  Every unresolved item below is a blocker, not permission to invent an API.
- A fresh leaf needs its own explicit scope/authorization for execution.
  Preparation scripts here never authenticate readiness or import a candidate.

## Exact declaration-to-observation mapping to record

| Binding item | Required record before executing |
| --- | --- |
| Shell and curl | Actual temporary compiled/public imports, Shell registration and invocation signatures, explicit curl plugin and loopback authorization. No fake curl, private engine, or production export claims. |
| Output closure | Sink capability and real downstream-close observation; source/request entry barrier placed before releasing `head -n 0`; no manually emitted close standing in for actual Shell notification. |
| Borrowed input | Identity of the real cursor passed to curl/commands and later owner/sibling Shell consumers; ownership never inferred from a signal or iterator. Trace all `next`, `return`, cancel and destructive close paths. |
| D01 branch | Declaration selects truthful operation-local read lease, opaque sequencing, or both. Freeze this selection before implementation inspection; if neither can represent the observations, mark blocked/unsupported. No after-failure branch switching. |
| Read-lease ownership | Exact per-read token, what it owns, delivery/commit boundary, and how withdrawal restores bytes without returning/canceling the shared cursor. A whole-iterator cancel API cannot be renamed a read lease. |
| Opaque handback | Exact sequencing after the controlled promise settles and a real supported commit/handback path. No verifier-only replay buffer, truncated wrapper, synthetic read settlement or silent discarded late chunks. Public settlement and actual read settlement are distinct observations. |
| Explicit transfer | D03's owner-authorized exclusive transfer evidence before admission, cooperative cleanup method and exact once-only release observation. This is the deliberate counterexample to borrowed no-return, not automatic enrollment. |
| Tree construction | Explicit parent/child/grandchild creation, destination bindings, inherited termination reason, late-acquisition refusal, admitted cooperative acquisition coverage and transitive drain observability. No test-side child propagation replacing product behavior. |
| Shared lifecycle | Actual invocation `registerCleanup` entry before acquisition/admission; exact idempotent cleanup reused by finally; overlapping operation close/dispose share completion. Instrument, do not replace it with a verifier lifecycle. |
| Surviving work | Actual parent/sibling acquisition after child closure and real VFS/stderr effects outside stdout subtree. Finish these before deliberately disposing the whole Shell; owner continuations after caller abort use another live invocation. |
| Curl mixed destinations | Verify frozen data/writeout option spelling and request/body/header ownership even before headers or before buffered upload creates the request. Preserve exact input bytes; disclose any required input revision separately rather than silently adapting this sealed cohort. |
| Header bytes | How actual curl serializes the frozen deterministic HTTP/1.1 header block. The loopback fixture has no automatic Date and no chunked response; no header normalization waived after observing a mismatch. |
| Reasons/errors/statuses | Exact first-close reason identity/code; public caller object and primitive-zero precedence; selected execution rejection; cleanup aggregation; exact stdout/stderr, exit and pipefail policy for each subrun. Do not expand old status allowances. |
| Actual transport cleanup | Register request/socket cleanup before acquisition. Record server request/close, client/socket lifecycle, active counts and whether candidate or harness caused closure. Harness shutdown is not product cleanup proof. |

The current declarations are **not bound**, including the exact D01 cancellation
status and D06 writeout-on-closed-stdout status. Those must be specified from the
declaration before implementation access or execution, not selected from results.
The contract observations (no lost bytes, required file completion, live stage,
reason identity, cleanup order) are already sealed and cannot be relaxed.

## Future driver and evidence requirements

1. Implement a maintained `.mjs` driver or inert `.patch-data` fixture in the
   fresh leaf's authorized scope. Import the authenticated temporary product,
   never an API-shaped stub. Log import/source/test/tool hashes before running.
   Preserve exact binding deltas and inputs; do not edit old fixtures or seals.
2. Use `probes.mjs` only as externally controlled input instrumentation. Its
   `release`/`reject` resolve opaque test promises; they are not product abort
   implementations. For a cooperative read lease, instrument the declared
   capability separately without broadening the cursor's ownership.
3. Run the seven fixed cases, with four D07 subruns and only declaration-offered
   D01 branches. Case pass is the conjunction of its observations/subruns.
   Record pass/fail/pending/unsupported distinctly; a missing case never passes.
4. Use bounded child processes and output, loopback-only networking and known
   owned servers/resources. Original old-case deadlines remain untouched; the
   new bounds are in `inputs.json`. Reap only known children; no SIGSTOP,
   polling, external targets or native corpus. Preserve first failure evidence.
5. Keep candidate-driven cleanup evidence before bounded harness teardown;
   release/reject every controlled pending promise. No deadline timeout can
   become a product pass or a universal opaque-host cleanup guarantee.
6. Preserve the original-five, existing 57+9, old-sixteen and author-twelve
   results as separate cohorts with exact source/input identities. Their
   reported successes are not inherited by these seven new cases.

## Separate four-failure explanation — not new acceptance cases

Root needs the author to supply exactly four unchanged-v1 failure records:
original case ID, accepted input SHA-256, unchanged command/assertion and bound,
raw baseline/v1 result, precise causal production behavior, and whether a
proposed adaptation changes source ownership, enrollment, signal expectation
or producer behavior. Preserve the 0/5 baseline, unchanged 1/5 and adapted 5/5
without conflation. No author diagnosis was inspected in this preparation;
there are no invented explanations here. Obtaining this evidence is separate
from D01-D07 and cannot silently enlarge or rewrite either frozen denominator.

