# String preparation on the released prototype source

## Status

The initial 2026-08-30 refresh was LIGHT only, with no runtime commands and
five unexecuted test drafts. Root subsequently authorized a scoped author CPU
window. This remains an author candidate, not publication approval.

Author validation pulls main to `a709a292997bc167d594a736391df64e3a432c68`;
none of the owned source preimages changes. The prerequisite SCOPED actual
12.0.11 PASS manifest is verified as SHA-256
`f717e57a3d24ef7bc4551405be2211be3199e3d0582b624900878cefafc8c10e` at
`/Users/kjopek/Workspace/poe-code-safe-js-replay-prototype-independent/out/safejs-remediation/actual-journal-prototypes-validation/candidate-12.0.11-ready/manifest.json`.
All command outputs, exact commands and exits are retained in
`out/author-validation/logs`. Original REDs, historical outer-dump differences
and old lossy-capture qualifications remain unchanged, not relabeled passes.

The isolated install disables lifecycle scripts and uses owned HOME, cache,
config and TMP paths. The first forced build encounters a tsx IPC socket
EADDRINUSE under the long TMP path; its failed capture is retained. Retrying
with a short isolated TMP succeeds for all 68 forced workspace tasks. No
production changes are made for this environment failure. The initial owned
test run passes 85 cases, including the five newly executed controls; only
test-file formatting is adjusted afterward through apply_patch.

A fresh isolated main clone was created and pulled with `git pull --ff-only
origin main` before edits. The exact source base is
`1b180668e29f43421ab2b89210a17ab6eab8c06e`. Root reports release 12.0.11 with
gitHead `9b344cca528d0715917b3a4e84247b0af0258eb4`; Git ancestry confirms that
prototype commit is included in this base. Actual-release process validation
belongs to Noether; its later SCOPED PASS is the verified prerequisite above,
not an author rerun of Noether's entire matrix.

## Minimal composition and exact preimages

Four existing owned paths compare byte-for-byte with the previous prep's
ordered preimages. Current/previous-preimage/previous-postimage three-way
merges are clean, and their results equal the previous prepared files. Three
new source/test paths are absent on current main. All seven prepared code/test
files are unchanged from the last prep; the eighth owned path is this unique
plan. There is no semantic overlap needing design and no new production fix.

The exact current Git preimage blobs are:

- `packages/safe-js/src/interp/globals/object-array.ts`: `3cc0d8c65d5779ea24de324b28aaf3186d341c14`.
- `packages/safe-js/src/interp/interpreter.ts`: `c9a3382a59e74cc4e681f18991c24e4d5af69a92`.
- `packages/safe-js/src/interp/values.ts`: `064b03ac78130fa32b28e682091ddb60b6fcbb2a`.
- `packages/safe-js/src/interp/globals/error-string-coercion.test.ts`: `c9efbdb52e8d0d90cb20198ad24eeb27871ff2fc`.

The values preimage is also the exact blob at released prototype commit
9b344cca. Its Nash ordinary/null-prototype allocation hunk is already upstream
and is not reapplied or included in the String delta. The String-only values
change adds five invocation-context lines. The interpreter adds its five-line
VM callback; object-array changes only String wiring; the owned helper remains
the approved implementation. The newer host-error-identity and a015 named-policy
changes in host-bridge are untouched, as are current Map, FS, Float and locale
changes. No source is overwritten from an old whole-file capsule.

The original b3d30ab7 READY packet and previous rename prep remain in place,
unchanged; they are referenced, not duplicated. Prior prep locator:
`/Users/kjopek/Workspace/poe-code-safe-js-string-coercion-rename-prep/out/static-prep/manifest.json`.
Current refresh receipts and the eight-path draft patch are under
`out/light-refresh`. Git blob identifiers and byte comparisons are static
preimage evidence, not freshly verified SHA-256 publication payload hashes.

## Unchanged five-case draft scope

- Exact opaque String output for a host capability, its containing array and
  intrinsic String, with zero host body calls during conversion/capture/replay.
- Synchronous hook returning a Promise: no implicit awaiting to a primitive.
- Synchronous hook returning a guest thenable: no then invocation or awaiting.
- Active host hook respects registered named replay policy.
- Explicit host declaration still overrides registered named replay policy.

These are criteria, not asserted defects. The existing async-hook oracle,
raw-native/accessor rejection, budgets, cancellation, alias and passive-capture
controls remain unchanged. There is no host-function source extraction added.
Any failing new draft requires preserved RED before a production revision.
O08 function-own writes and binary-addition coercion remain separate OPEN work.

## Gates after the CPU window is released

Noether's actual-release PASS and root's explicit release of the publisher
security/docs hook window authorize this author run. Source presence alone
was not authorization. Recheck main and owned preimages before
execution; refresh again if upstream changes arrive. This fresh clone had no
dependencies installed by this author during the light phase.

Then run the three owned String/Error test roots and five drafts, historical
39 native/public oracle cases and completed replays. Preserve native outputs,
alias/journal counts, async non-awaiting and passive hook behavior. Include
`packages/safe-js/src/named-host-policy.test.ts` and
`packages/safe-js/src/host-error-identity.test.ts` on this current host bridge.

Use the released prototype controls for genuine ordinary/null-host records,
direct prototypes, graphs and journal identities, not String output alone.
Preserve O12 typed-proof controls, successful v6 cases and original lossy
capture negatives; do not normalize or rewrite fixtures. Run existing eight
typed String controls, three original Float fixtures and selected typed-graph,
Map, FS and locale regressions. The detailed historical control/gate inventory
remains in the prior prep's unique plan rather than being copied here.

Run configured source/all-owned-test types, forced build, configured lint,
scoped package tests with unchanged defaults, publication formatting and strict
whitespace when authorized. Validate canonical `safe-js` and public legacy
`safejs` alias targets; do not add the private legacy package alias. Full-root
execution requires its assigned window. Freeze exact payload/preimage hashes
only after gates and submit to a different cumulative reviewer.

Estimated scoped CPU window: 4–6 minutes, not measured here and excluding any
new dependency setup or actual failing-test repair. No README, ledger, SKILL,
old capsule, original archive, commit, branch or push changes are made.
