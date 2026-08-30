# Public cleanup source-binding migration

This subtree changes test/harness source binding only. No shell, regex executor,
command implementation, quota policy, root configuration or test-discovery glob
changes. The original public-worker.mjs stays byte-for-byte identical to85e6d560.
The17/17 file-annotation fix1a18cb18 remains a separate Dirac review, not acceptance
by this author.

## Current canonical ten

`tests/shell/invocation-cleanup-public.test.ts` remains the canonical file, with
the same ten names and all original scenario assertions. It runs grep/rg across
normal, early-pipe, caller-abort, same-shell-sibling and other-shell-sibling modes.
The unchanged plain-Node probe observes real native workers, exact output bytes,
abort-reason identity, sibling isolation, completed termination at each public
boundary, no live workers and no unhandled rejection. There are no new patterns
or larger regex workloads.

Ordinary `node --import tsx --test tests/shell/invocation-cleanup-public.test.ts`
tests the actual executing working tree. The binding records complete src bytes,
package/lock, the complete supported relative build-config chain, the canonical
fixture, probe and binding helper **before copying/building**. Copies must equal
that captured manifest; the original inputs are rechecked after copying/building,
before/after every scenario and in the final hook. Fresh emitted artifacts and
the manifest are independently checked against their post-build capture before
and after every child. No shared dist, Git HEAD fallback or original4c16 archive
substitutes for the candidate. Tools are exclusive regular-file copies of the
explicit existing development tool tree; source symlinks are refused.

Working-tree results are expressly labeled
`captured-working-tree-not-committed-qualification`: a capture/stability guarantee,
not a claim that arbitrary current bytes match an approved commit. The captured
baseline is not recomputed to bless changes. Inputs added, removed or changed
after capture fail. Trusted compiler output is bound to the captured source,
compiler input hashes and successful bounded fresh build; it is not a claim of
cryptographic compiler attestation or a hostile-host JavaScript sandbox.

## Explicit committed replay

```sh
node --import tsx tests/shell-stress/invocation-cleanup-runtime/migration/replay.mjs \
  current FULL_40_CHARACTER_COMMIT NEW_OUTPUT_DIRECTORY
```

The runner accepts no incidental HEAD or abbreviated revision. It derives the
expected input set and hashes independently from that commit's Git tree/blob
objects, archives those files, verifies its own runner/helper against the commit,
and supplies `VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT` plus
`VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED` to the archived canonical fixture. Both are
required together. The fixture requires exact set/hash agreement before build.
All source/config/probe readbacks must remain equal thereafter. The expectation
is a trusted outer-runner input, not a user-provided manifest signature service.
The current replay also runs the15controls from that same archived commit,
retaining their source hash and results separately from the10canonical scenarios.

A whole-gate owner can generate the same expectation using `committedInputs`
from replay.mjs and pass both variables while running the actual frozen candidate.
Without that explicit envelope the canonical tests still exercise current bytes,
but their inner report intentionally does not claim committed qualification.
No root whole-gate policy was edited here; integration belongs to its owner.

## Historical replay stays historical

```sh
node --import tsx tests/shell-stress/invocation-cleanup-runtime/migration/replay.mjs \
  historical NEW_OUTPUT_DIRECTORY
```

This explicitly reconstructs runtime4c16d9c5 and copies the original fixture/probe
from85e6d560 unchanged. All six old source pins must match. The original fixture
executes all ten original assertions, including its own nested4c16 archive/build.
A read-only explicit Git object database lets its fixed-commit archive work in
the isolated tree; this does not create a worktree or change repository state.
Temporary nested directories and copied tools are owned and removed by the runner.

Historical data under `history/` retains the exact fixture/probe bytes, source
pins and ten original failed before-hooks from b494. The old test was not made
green by updating its expected source hash. The historical replay is an explicit
entrypoint outside canonical `.test.ts` discovery; the current canonical ten
replace its source-binding role without dropping their behavioral coverage.
Historical results cannot certify the current candidate.

## Guards and review boundary

```sh
node --import tsx --test tests/shell-stress/invocation-cleanup-runtime/migration/controls.mjs
```

Fifteen explicit controls cover captured/committed input mismatch, additions,
deletions, config/probe/helper mutation, malformed/incomplete expectations,
symlink/config escape, rejection of null/false committed envelopes before capture
or build, and tampering with actual emitted/source/probe/manifest
files. Small binding-unit fixtures are only binding-unit proofs, not command or
public workflow acceptance. One control builds a deliberately distinct **source**
mutant that removes awaiting worker.terminate, then runs the unchanged normal
grep and rg probe. Original source binding rejects that mutant; separately labeled
mutant behavior must fail retirement assertions without a watchdog kill. No live
product source is changed. These controls are separate from the canonical ten.

Author working-tree, explicit committed and historical cohorts retain separate
raw results. A different verifier must rerun ten committed current scenarios,
tamper controls and retirement mutant before accepting this migration. No overall
gate, compatibility, custom-first-read closure or private-engine claim is made.
