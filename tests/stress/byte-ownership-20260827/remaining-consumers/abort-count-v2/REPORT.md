# Abort-count v2: explicit fixture revision, not a product fix

Author ownership is only this new directory and `/tmp/byte-abort-v2-author-*`.
The accepted product is `b282159921ce530e932b02f90c64eca987de2704`.
Observed checkout HEAD is `a84dd195c13935587df0d53be85c86790a48e4d5`.
The five relevant cancellation/input files listed in `freeze.json` have identical
accepted-commit, observed-HEAD and working-tree bytes. This is NOT certification
of other changes in current HEAD. No source, package, root or discovery edits.

## Why two producer-local yields are correct

The command remains `jq -Rrs . /input`; raw chunks remain
`['41e2', '', '82acff', '0a42c328']`, stored bytes `41e282acff0a42c328`.
The original Buffer window has offset 7 and unchanged canaries. Its exact
`afterRead` callback remains `() => controller.abort(reason)`, with the same
Error object/message. Neither signal injection nor producer scheduling changes.

1. `readBytes` enters the producer's first `next()`. `borrowed` fills the window,
   increments `yielded` to 1 and suspends at the first yield (`41e2`). The reader
   accepts those bytes. jq raw-slurp accumulates input, not public output yet.
2. The reader enters the second `next()`. The producer resumes the first yield's
   inner finally, verifies the borrowed backing and increments `unchangedChecks`
   to 1. Then it increments `resumed` to 1 and enters `afterRead`.
3. `controller.abort(reason)` synchronously rejects the pending `abortable`
   promise via its abort listener, but does NOT throw into the producer. The
   callback returns normally. The producer continues its loop in that same
   `next()`, fills the next window and increments `yielded` to 2. It yields the
   second input view, whose length is zero. That producer `next()` fulfills, but
   cannot reverse the already-rejected reader promise. The empty view is NOT
   accepted/returned by `readBytes` to its consumer.
4. `readBytes` catches/rethrows the exact reason and schedules `iterator.return()`
   in finally. Return resumes the second yield's inner finally, which checks the
   backing and increments `unchangedChecks` to 2. Return skips the normal
   `resumed++` and callback. The outer finally zeroes the window, verifies the
   canaries and sets `finalized=true`. There is no third `next()`, second callback,
   third yield or later consumer delivery.

Thus the old `{yielded:1,resumed:1,finalized:true,unchangedChecks:1}` is inconsistent
with this nonthrowing callback. The corrected producer-local state is
`{yielded:2,resumed:1,finalized:true,unchangedChecks:2}`. This does not authorize a
second accepted chunk or public output. In contrast, the final curl case's callback
actually throws; its original 1/1 expectation is preserved without modification.

The narrow `probe.mjs` observes the exact copied producer using the accepted packed
`readBytes`, with an authenticated module hash. It observes rather than rewrites
`next`/`return`; its trace distinguishes producer fulfillment from reader acceptance.
It is not a jq/public-shell run or the 24-case replay. Any probe evidence is reported
separately as `probe-result.json`, not as public acceptance evidence.

## Exact migration and stronger public assertions

`public.mjs` copies the original 24-case module. `allowed-public.diff` is the entire
allowed delta, confined to the named jq abort case; prefix/suffix hashes in the
manifest prove the other 23 cases and common helpers are byte-identical. The three
supporting fixture/archive/vector files are exact copies authenticated against the
old freeze. No imports depend on mutable history for input fixtures.

Only yielded and unchangedChecks change (1 to 2). Existing exact rejection identity,
empty stdout, one VFS opening and unchanged VFS inventory remain. Additional checks
capture empty stderr, explicitly reject a resolved result/status, await Shell.dispose,
and recheck output, inventory and unchanged producer counters after disposal. The
diagnostic status is `null` (no result), NOT an invented numeric exit code. Finalized
source and one opening are checked before disposal too. No new abort, delay, signal,
stream wrapper or producer callback is added to the public case.

The no-later-work checks cover this cooperative source through public rejection and
awaited disposal: no further producer yield/resume/open, sink delivery or FS byte
change. They are not universal observation of arbitrary opaque host execution.
`readBytes` deliberately does not await an opaque pending return after abort; it
observes cleanup rejection. The public command contract drains registered cooperative
cleanup, not arbitrary input/handler promises. This immediately settling generator
finalizes under that actual schedule; no universal hard-preemption claim is made.
The existing context.after disposal remains, so repeated disposal is also awaited.

Historical 21/24, unchanged-fixture candidate 23/24, original direct 1/2 and later
direct 2/2 remain separate immutable cohorts. Revised 24/24 is a new cohort requiring
independent review and an actual authenticated moved-package run. Author does NOT
claim that run, reviewer signoff, superiority, a broad gate or product completion.

## Exact discovery qualification

At the observed HEAD, `npm test` runs a Node inline script calling
`fs.globSync('tests/**/*.test.ts', {exclude: path => path ===
'tests/commands/regex-execution/continuation/artifacts/native'})`. It passes the
resulting paths explicitly to `node --import tsx --test`, followed by user arguments.
The shell does not expand this pattern: it is inside the quoted inline program.
A read-only invocation of that exact glob returned 557 paths with Node v22.22.2.
Neither old `remaining-consumers/public.mjs` nor the new `abort-count-v2/public.mjs`
matches. The only discovered path under remaining-consumers is
`direct-curl/direct-curl.test.ts`. This is listing, not a broad test run.
The separately quoted `test:contracts` pattern is passed literally to Node and has
no remaining-consumers path; it does not make either public module live discovery.

Tracked-reference searches found no remaining-consumers registration in package.json,
scripts or docs. Old `run-packed.mjs` explicitly copies and runs the old public module;
`fix-review/history-replay.mjs` explicitly copies/runs it as original-packed24-candidate.
The original README/REPORT advertise that historical custom command. Authentication
JSON also names/hashes the old path; those are evidence references, not discovery.
Thus the old public fixture is an explicit historical moved-package harness cohort,
not live canonical npm-test discovery. The revised module also needs an explicit
custom invocation. No hiding, skipping or test/config changes are made here.

## Reviewer / Curie command

First inspect the fixture commit named by the author-frozen marker and authenticate
`freeze.json`, its old/new hashes and `allowed-public.diff`. Independently authenticate
the accepted candidate's packed package against existing fix-review evidence, then
copy this revision's public.mjs, fixtures.mjs, vectors.mjs and archives.json unchanged
to `MOVED/fixtures/`, with the accepted package at `MOVED/node_modules/virtual-bash`.
Do NOT run the old harness and relabel its 23/24 output. The following exact custom
command runs this revision (MOVED is reviewer-owned, independent of author files):

```sh
ROOT=/Users/kjopek/Workspace/safe-bash
MOVED="$ROOT/tests/stress/byte-ownership-20260827/remaining-consumers/abort-count-v2-review/.work/moved-consumer"
PACKED="$MOVED/node_modules/virtual-bash"
REVIEW_HISTORY="$MOVED" \
REMAINING_CANDIDATE=b282159921ce530e932b02f90c64eca987de2704 \
REMAINING_PUBLIC="$PACKED/dist/index.js" \
REMAINING_ARCHIVE="$PACKED/dist/commands/archive/index.js" \
REMAINING_NETWORK="$PACKED/dist/commands/network/index.js" \
node --unhandled-rejections=strict \
  --import "$ROOT/tests/stress/byte-ownership-20260827/remaining-consumers/fix-review/history-preload.mjs" \
  --test --test-concurrency=1 --test-reporter=tap "$MOVED/fixtures/public.mjs"
```

The read-only historical preload redirects only a failure diagnostic's old /tmp
write into the reviewer's moved directory; no assertions/schedules are rewritten.
Reviewer must additionally authenticate loaded product bytes (the existing loader
can use REVIEW_HASHES/REVIEW_LOADED), fixture bytes before/after, all 24 test totals,
zero skips/TODO/cancellations, actual rejection diagnostics and process/resource
closure. The command alone does not authenticate the package or establish signoff.
Curie can qualify this as an explicitly invoked cohort, not pretend npm discovers it.
Any post-freeze correction needs a separately evidenced revision and fresh review.
