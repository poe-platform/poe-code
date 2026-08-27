# Independent settlement-v2 review preparation

Prepared 2026-08-27. **Preparation only; no candidate execution.** Ownership is
this new directory only. The concurrent author's settlement-v2 implementation,
assertion controls and replay artifacts were not read. No product, original
fixture, configuration or historical evidence is changed. Stop after this seal;
actual review requires the root's closed-author full-commit handoff.

## Frozen authority and boundary

`review-spec.json` pins the candidate, original evidence, exact 77 base plus five
supplement names, and permitted two-case expectation change. `inputs.json` hashes
the original committed inputs used to derive this review, not live files. These
hashes authenticate preparation; they are not a new package/replay acceptance.

At candidate `0123c83d3aae72a15621acbb29a165b97b2c6ab6`:

- `src/shell/input.ts:61`: normal close retains and awaits the iterator-return
  promise; its observer catch does not replace that promise. With no prior read
  failure, the original return rejection is rethrown.
- `src/shell/shell.ts:172`: external stdin close occurs in the outer execution
  finally, before constructing a ShellResult; `src/shell/shell.ts:96` preserves
  that rejection through public exec settlement. This is outside the handler.
- `src/contracts/command.md:81`: registered cooperative cleanup is a settlement
  barrier, unlike arbitrary opaque host promises. This review is normal execution
  only, not an expansion of abort/disposal or S38 expectations.

At original evidence `154a8d227b79e1f86566e9a98ea353239b8dddc8`, paths below
are relative to `tests/commands/grep-aliases-stress/`:

- `verification/holdouts.mts:379` supplies repeated `keep:01\n` bytes and an
  asynchronous iterator-return sentinel rejection.
- `verification/holdouts.mts:408` uses `egrep -q keep`, sentinel
  `external-return-sentinel`, and the alias plugin.
- `verification/holdouts.mts:580` uses `grep -q keep`, sentinel
  `shared-grep-return-sentinel`, and explicitly registered standard grep.
- Both public cases originally awaited a fulfilled result/status 2. The original
  results retain two failures with empty details objects: do not invent historical
  stdout/status/effect observations that the rejecting await prevented recording.
- `verification/holdouts.mts:392` direct-handler cases retain their existing
  status-2/diagnostic-or-identical-error assertions, without migration to a public
  rejection-only expectation. The owned VFS case at line 402 also stays unchanged.
- `verification/holdouts.mts:113` and `:593` retain worker and unhandled-rejection
  guards. Do not infer retirement merely from a child process exit.

## Closed-author review, later only

1. Authenticate full author commits and actual parents. Diff the derivative base
   fixture against the pinned original. Permit only the two identified public
   settlement blocks: same sentinel rejection, absence of a fulfilled result,
   and observation needed to record that settlement. Preserve setup, literal
   input, command, limits, return count, disposal, byte/effect checks and all
   other 80 subcases. No broad assertion helper/proxy or classification rewrite.
   Preserve original observations (including nextCalls and aliasesRegistered);
   never serialize object identity as merely matching Error text.
2. Record exact old/new byte spans, hashes and line locations for both hunks.
   Invert only those spans and require the entire original fixture SHA256 and
   Git blob to match. Hash/check every other original fixture and native input;
   supplement and harness assertions remain unchanged. Binding-only runner
   adjustments are a separately enumerated, reversible external harness delta.
3. Reuse the original standalone and supplement runners in a fresh regular
   isolated external harness binding. Bind the derivative base fixture, unchanged
   public consumer, supplement and data; do not overlay product files. Use the
   retained original tarball with the pinned SHA, not a rebuilt equivalent.
   Authenticate archive/package manifest, locked dev tools, compiler, emitted
   entries and actual imports. Runtime resolves public root Shell and the packed
   INTERNAL alias file URL, never live workspace modules or a claimed public
   alias export. No dependencies installed and no new product build is planned.
4. Inventory all entries (including directories, modes and symlink targets) and
   file hashes before and after binding, compilation, controls and replay. Product
   package must be unchanged with no additions; allow only enumerated generated
   external harness/output entries. Reject unlisted additions, live module aliases
   and source overlays. Source input blob and alias/column tree identities stay
   pinned. Authenticate retained package provenance rather than assuming the
   current live tree is its input. Missing package/dependency receipts are a
   prerequisite failure, not permission to install or silently substitute.
5. Run the unchanged-membership 77 base plus five supplement actual cases once,
   in bounded child runs using the existing timeout/output limits. Strict checking
   is scoped to the reused harness. Preserve every raw attempt, status, stdout,
   stderr, tuple/effect, initial harness error and worker event. No full gate or
   native execution. Confirm product-owned worker exits, zero active workers,
   zero unhandled errors and no verifier-forced termination. Timeout/output cap,
   OOM or forced cleanup is a failed/incomplete run, never a pass.
6. Report original 75/77 plus 5/5 = 80/82 unchanged beside the separately labelled
   v2 outcome. Preserve original native/profile comparison partitions and all raw
   bytes; no result rewriting or promotion to GNU/Linux parity. Count tools-only
   assertion controls separately, never in the 82-case denominator.

## Assertion sensitivity, later only

For each of the two actual closed-author v2 assertion sites, require rejection
of all three wrong outcomes in `review-spec.json`. Six negative controls are
tools-only, plus two positive identity controls. Authenticate the exact assertion
code under test: use the actual case body with only a narrow exec-outcome binding,
or a byte-identical extracted settlement/assertion span with its lexical bindings.
Choose the method only after inspecting the closed fixture; record offsets and
hashes and prove its assertions were not replaced. A separate equivalent helper
does not qualify. Do not monkeypatch assert or use a broad asserter proxy.

Controls must reach the real settlement assertions with valid result shapes,
identical return counts, supporting observations and cleanup behavior. A mock
setup/import/cleanup failure does not establish sensitivity. Record the exact
assertion failure/site for each wrong outcome, not just a negative child exit.
Same-message/different-object rejection must fail while the original sentinel
object passes. Fulfilled status 0 and fulfilled status 2 must both fail, even if
stderr contains the sentinel text. Controls cannot certify product behavior.

## Stop condition and scope

This seal contains docs/data only, no executable fixture or missing imports.
Static JSON/hash/cohort checks are permitted now; product, build, test, native and
dependency execution counts remain zero. Preparation launches no retained child
or worker. Await a future closed-author handoff without polling or resuming a
concurrent worker. Root public integration remains **HOLD**; independent future
signoff can cover this bounded fixture/replay only, not 73-command wiring, Arch
review or Curie's root integration authorization.
