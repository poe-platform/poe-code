# Bounded author checkpoint: current and historical public cleanup

**Different-verifier acceptance remains required.** Test/harness candidate:
`026e20cf38ddbb695d82de3f30cf7a1a7c88f088`. No product, root configuration,
permission/budget policy, assertion-vector or public-worker source change.
Later commits, including root typing changes, are excluded from the qualified
candidate below. This is not a whole-gate or custom-first-read closure claim.

## Results kept separate

| Cohort | Result | Qualification |
| --- | --- | --- |
| Original b494 cleanup rows | 10failed shared-before-hook rows | Preserved verbatim; no behavioral bodies accepted |
| Development current canonical | 10/10,0skip | Captured executing working tree, explicitly not committed qualification |
| First binding controls | 14/14 | Before the added malformed-envelope control |
| First expanded controls | 14/15 | Preserved nested-test-runner environment defect; not a product failure |
| Corrected expanded controls | 15/15 | Explicit child discovery/count checks; no assertion relaxation |
| **Committed026e20cf current canonical** | **10/10,0skip** | Actual archived commit, Git-derived expected inputs, fresh build |
| **Committed026e20cf controls** | **15/15,0skip** | Control source from the same archive; two real retirement-mutant probes rejected |
| Frozen026e20cf scoped TypeScript | exit0 | Canonical fixture and binding helper; not a global typecheck |
| Original4c16d9c5/85e6d560 historical replay | 10/10 twice,0skip | Original fixture/probe/pins, explicitly historical; never current acceptance |

Each successful public cohort observes14actual worker instances and30public
boundary records across its ten scenarios. These are resource observations,
not extra test passes. All ten children exit0 naturally, with signal/error null,
zero live workers and no unhandled rejection reported at successful settlement.

The retirement mutant changes exactly one expression in an isolated **source**
copy: `if (!this.exited) await this.worker.terminate();` becomes
`if (!this.exited) void this.worker.terminate();`. Original input binding rejects
its changed source hash. The separately labeled mutant is freshly built and
fails the unchanged normal grep and rg retirement assertions, both with natural
exit1, no timeout or kill. A live worker in its failure report is the deliberately
premature boundary observation, not a successful resource-cleanup assertion.

## What was preserved and what changed

The original public probe is byte-identical to85e6d560, SHA256
`2ca53ee66a4dcc1f85453fa9fd276e76da1d773ef6a51ea866eafeb2ddda3fe4`.
The eight assertion lines inside the canonical scenario loop are unchanged;
all worker, bytes/status, abort-reason identity and sibling-isolation assertions
inside that probe are therefore unchanged too. New assertions check source/build
binding rather than replace behavioral tests. The canonical file still declares
grep/rg × normal, early-pipe, caller-abort, same-shell-sibling, other-shell-sibling.

The replaced before-hook previously required live source hashes from4c16d9c5 and
then executed a4c16 archive. New canonical binding captures actual executing
inputs before copy/build, validates their copied bytes, verifies original input
stability, and checks emitted/probe/manifest integrity before and after every
child plus the final hook. No updated historical source hash is used as a new
golden. Working-tree capture never claims an approved commit.

Qualified replay derives its expectation from explicit026e20cf Git tree/blob
objects, not from the execution directory. Its complete expected input set must
match before compilation. The qualified runner and helper must themselves match
that commit. Root whole-gate integration can pass both explicit envelope variables
documented in README.md; no root script/configuration was modified here.

The historical entrypoint reconstructs original4c16d9c5 source plus the original
85e6d560 fixture/probe. The original fixture still executes its exact source-pin
checks and nested archive/build; all ten original tests remain. It is not inside
the default canonical glob. Original fixture/probe bytes and the b494failed rows
are also preserved as non-discoverable data under `history/`, authenticated against
Git and the retained full-gate capture. Their original assertions are not rewritten.

## Frozen evidence bindings

- Current archive SHA256:
  `91879df38cae0c8744d9215705f3858b2b9b4d1ba8fbf745f1641a8f9bf70c06`.
- Current expected-manifest SHA256:
  `3ef750986d1ef287b2cf90f33bd6ac0417ed502c48f7a93044c8078cc3df9a52`.
- Current source-input census SHA256:
  `cefa5da1a3860b0a78746286ac6b86a129677ff7b03006e512aa7345cad5588c`.
- Original historical source archive SHA256:
  `14806f0a79a13715091d0b57c7f321c450acaadf3e483daee03fb8d8dceb8ae4`.
- Final replay runner SHA256:
  `5bddec036e4961f22f7aab96381d7687e90c86e417a25efdaf050706c6293a30`.

`evidence/committed-026e20cf/` retains expected inputs, original archive input
hashes before/after, copied tools, raw canonical/control logs, exact counts,
scoped type results and cleanup. The raw canonical log contains the fresh build,
full emitted/source/tool hashes and all ten child reports. Runtime product
imports are checked by the unchanged probe against fresh `dist` hashes, not a
source-loader fallback. Node22.22.2, TypeScript5.9.3, Darwin arm64; existing tools
only, no install, dependency addition, private engine access or external network.

All owned current/historical outer and nested source/tool directories are removed.
The copied source inputs are unchanged after execution. Every retained successful
cohort has no skipped/cancelled/TODO cases. Raw diagnostic whitespace remains
unaltered; whitespace scanners may flag captured log formatting, not code edits.

## Preserved investigator attempts

The first scoped check placed its config outside the repository without an
explicit Node type root, producing TS2688 before checking the fixture. Repeating
with the actual repository Node types resolved that setup error; the frozen
scoped check later passes independently. No root config was modified.

The first expanded15control cohort preserved14pass/1fail. Its new malformed
manifest subprocess inherited Node's internal test-runner context and returned0
instead of running the requested failing test cohort. The corrected harness
removes `NODE_TEST_CONTEXT` only for an explicitly launched new test runner and
requires actual10test/10failure TAP counts for both null and false envelopes,
plus no source/build manifest. The refusal assertion was not relaxed. Clearing
that internal context is also applied at the explicit replay process boundary.
The preliminary and final raw logs remain side by side.

A concurrent Git index lock blocked the initial commit attempt; it was not
removed. Retrying after the other writer finished produced the explicit owned
source commit. All foreign staging remained outside the commit.

## Reviewer handoff

Run the explicit current replay against026e20cf using a new output directory;
it executes10canonical scenarios and15separately counted controls from that
archive. Independently add/tweak source, emitted, expectation and manifest tamper
controls and confirm the retirement mutant fails genuine boundary assertions,
not merely stale hashes. Run historical replay separately if verifying historical
preservation; its10passes cannot substitute for current acceptance. Inspect that
no loop/name/scenario disappeared from canonical discovery and no live product
file changed. The file-annotation fix1a18cb18 remains Dirac's separate review.
