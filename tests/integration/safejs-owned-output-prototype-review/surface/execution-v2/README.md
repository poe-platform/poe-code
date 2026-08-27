# Surface v2 — explicitly approved author execution

This is an opt-in, immutable TEMP prototype audit driver, not a reusable current
canonical test and not product promotion. Author thread:
`01a04292-5421-7363-8bcb-a70b97fae4e9`. Independent signed proposal reviewer:
`01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4`, phase1
`65a887ac7aa0e361216b827f9fedee20389bc609`, phase2
`bbb7f807f70c4db7014eee1f151a0ff51ee2a8a2`. ROOT subsequently explicitly
authorized this exact observer/scorer implementation, freeze and author run.
Author results are not the different verifier's actual replay or acceptance.

## Frozen change boundary

- Original inputs `5645b4f516438b66e4fad32a585ab27cda8f7cdc`, v1 runner
  `5d2c2f93d794b2a52d56ee503119052a5fefe1fd`, raw results
  `b0ff1977c9c912054edd136510d62819d28cf890` remain unchanged (7/8 raw).
- `child.mjs` is exactly the original plus the signed inert observer delta from
  proposal `d8bb351619c2b14a8d633dfea5f670b8f8adabcf`; resulting SHA-256
  `358dffdec0e11672206beb3c74d97a5cda44f55b83c8104dec9717543a2c64f4`.
  The new catch observes only typeof/null, rethrows the same binding, and adds
  no await, reason getter/serialization, timer, rescue or guest capability.
  Unchanged fulfilled-result serialization remains a separate observer behavior.
- `CASES.json` differs semantically only at `/cases/7/expected/engine`.
  The two case08 fulfilled-result checks become exactly two rejection/order
  checks. They require one entry, one rejection event, no call-throw/fulfillment
  event, `await-rejected`, non-null object reason metadata, no own engine result,
  and rejection before operation-close and public Shell settlement.
- Case08 retains its original 52-byte guest, literal argv/stdin, public status1,
  exact 52-byte stderr, empty public/accounted stdout, VFS/no-effect expectations,
  real host premise, counters, budgets, cleanup and child/import guards.
  No synthetic `engine.ok:false`, raw-reason-message claim or inferred budgetUsed.
- Cases01–07 and conditional09 are unchanged. Case07 remains dialect-only, not
  descriptor/prototype membrane credit. Case08's new profile is observed awaited
  rejection/public diagnostic, not a new supported reflection operation.
- `DELTA.json` supplies exact original/revised hashes and every runner text
  replacement. Besides the scorer branch, runner edits only select versioned
  expected data/pins and the new scratch prefix. All original guards remain.

## Actual input identity

S1 source213 manifest:
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
Candidate940 includes compiled708; packed public package709 is unchanged.
Assembly authority is `07a7dae5db51612a23e74d1d164d33723d4d61b6` plus
`db139ae983ad66364e0367f9fb1ed0262ee61f63`. `PINS.json` is the original byte-exact
identity document; its old PREPARED status is historical, superseded for v2 by
`RELEASE.json`, not a change to the pinned sources or API.

Shared regular prerequisites remain READONLY:

```text
/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK
/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route
/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/packaged-route
```

The runner verifies whole source/package/tool inventories and copies regular
inputs into a new `/private/tmp/safe-bash-owned-output-surface-execution-v2-*`
tree. It compares fresh private HEAD/tree/index/status/staging/metadata and all
264 eligible engine files against pins, then freshly copies the actual private
source. Expected private HEAD is
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`. Any mismatch blocks rather than using
an old fallback. Every private Git query sets `GIT_OPTIONAL_LOCKS=0` and disables
fsmonitor for that query. Finally captures private-after even on failure.

This is public packed TEMP product with authenticated unchanged **private copied
source-hook injection**, not installed private-package acceptance. Node22 binary,
source loader and copied TypeScript/tool file hashes are in the original pins
and actual copy/import receipts. No build/install or engine barrel is used.
Current live public source is separately recorded, never overlaid or required
to equal the old candidate. No product, env, dispatch or private source is edited.

## Reproduction and bounded controls

From `/Users/kjopek/Workspace/safe-bash`, after the execution freeze commit:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/safejs-owned-output-prototype-review/surface/execution-v2/verify.mjs
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/safejs-owned-output-prototype-review/surface/execution-v2/controls.mjs
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/safejs-owned-output-prototype-review/surface/execution-v2/run.mjs
```

Controls run in a known Node child with a 5-second external deadline. They isolate
the exact added observer from the unchanged fulfilled recorder. Two fulfilled
results, synchronous throw, awaited object rejection, four primitive rejections
and one throwing-getter reason check identity, one call, zero getter reads and
one finite finalizer in order. These nine host-only control rows are not guests,
source-engine acceptance or new surface passes. No nonsettling work is used.

The actual runner requires its manifest/files to be committed before any guest.
It runs the same eight unconditional cases once, each in a known Node22 child
with the original 10-second absolute child deadline / 100-second cohort budget
and fixed output cap. A timeout/kill/import failure is never a pass. It records
actual entry/outcome, effects, per-module source hashes, copied input guards,
private-before/after and child close events. Conditional09 stays restricted to
the original exact host/guest authority premise and is never counted as a pass.
There is no automatic retry. Original failures and every v2 attempt are retained.

Copy checks enumerate all eligible files, detect new file entries and refuse
symlinks. They do not promise excluded private subtree append-proofing, empty
directory/atime invariance, or atomic/intervening/future-state guarantees.

## Evidence and retention policy

`preflight.json` retains finite-control/static/syntax check outputs, including any
first failure. `RELEASE.json` also preserves the initial read-only instruction
lookup error (zsh `path` changed PATH; no guest); the corrected read succeeded.
`RUNNER-FREEZE.json` is committed before first guest and binds executable files,
expected data, authority, exact delta and prerequisite checks. The actual run's
raw artifacts and report are sealed separately after all children close and
private/input after-guards complete.

Retain this run's regular copied prerequisites and raw results in its unique
owned TMP tree for the different verifier. Do not delete the only available
prerequisite. Shared snapshots remain untouched. Each verifier invocation makes
its own fresh copy and fresh private snapshots; it does not trust author counts.
Only known owned case handles may be closed. No foreign-process search/kill,
waiting on other workers, new probe breadth or self-approved promotion follows.
