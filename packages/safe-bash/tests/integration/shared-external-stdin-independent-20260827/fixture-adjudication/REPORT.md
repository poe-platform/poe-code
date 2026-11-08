# Bounded fixture adjudication — 2026-08-27

## Verdict

Accept the **semantic fixture corrections and three additions** described below;
reject treating `92f7626200d1509cf0efe17e4ee6c3d558f3a277` as an accepted,
replay-ready 35-case gate. Its runner still authenticates the old fixtures and
will reject the revised ones. Root must authorize the revised freeze separately.
The historical result remains **18/32, 14 failures**, with **two separately
detected negative controls**, not a corrected passing cohort or candidate result.

Ownership: this new report only, plus the requested `/tmp` readiness marker.
Production is read-only. Review used exact baseline
`eaed12f88365e69597994c4f2e6324a020202b66`, original fixture commit
`0ec75ef320ecaea9fc66e1ba952f3961c917685c`, and proposed fixture commit
`92f7626200d1509cf0efe17e4ee6c3d558f3a277`. No live/candidate `input.ts`, candidate
implementation, author candidate artifacts, or candidate behavior was inspected
or inferred. Current `ATTEMPTS.md`/`REFREEZE.md` were read as proposals.

## All 14 original failures

| Original identities | Adjudication of exact proposed change |
| --- | --- |
| `shell-eof-sync`, `shell-eof-reject`, `shell-eof-zero` (3) | Accept zero returns instead of one and successful exit 0/empty stderr instead of close rejection. Input remains chunks `00ff`, `80`; exactly three reads, serialized, exact streamed bytes `00ff80`. The throwing return is never selected after observed EOF. Original artifacts already show those bytes, exit 0, and zero returns. These are invalid original expectations, not three demonstrated close-swallow defects. |
| `shell-early-sync`, `shell-early-reject`, `shell-early-zero` (3) | No semantic relaxation accepted or proposed: `head -c 2`, one read, one return, exact output `00ff`, rejection with the identical close Error for sync/async or primitive `0`. Baseline instead fulfilled exit 0. Three clear normal-awaited-close swallow failures. |
| `shell-status17-unread-sync`, `shell-status17-unread-reject`, `shell-status17-unread-zero` (3) | Preserve zero reads, one return, empty output, and identical close Error/`0` rejection. Baseline fulfilled exit 17. A nonzero result is not an execution rejection and cannot hide a selected awaited-return failure. Three more clear swallow failures. |
| `shell-deferred-eof-return` (1) | Original gate is impossible on this baseline: `drain` reaches EOF, owning return is not called, and the probe waits forever for `enteredReturn` before it can release anything. Recorded child status **13**, closed, no watchdog expiry, no result JSON; its finally did not execute. Accept replacement only as distinct `shell-deferred-early-return`: same two input chunks, operation changes `drain` to `one`, emitted bytes change `00ff80` to `00ff`, one read/one return, pending exec before gate rejection, then exact close Error rejection. This changes the input operation and coverage, not merely an assertion. Never relabel the old row a pass. |
| `shell-primary-read-zero`, `shell-primary-read-error` (2) | Accept correcting expected public reason from original read reason to the identical `closeError`. Baseline registry-command errors become diagnostic/status 1, not selected exec rejections. Preserve one read/one return; add explicit stderr forwarding and exact `shell: line 1: 0\n` or `shell: line 1: independent-primary-failure\n`. No yielded bytes. Original artifacts prove fulfilled outcome/counts but do not record that result's exit code or diagnostic; status 1/diagnostic is established by exact baseline source, not invented captured evidence. Corrected expectations still expose swallowed close failure; they do not accept fulfilled status 1. |
| `shell-primary-sink-error` (1) | Accept the same ordinary-error distinction: preserve one read/one synchronous failing return and attempted bytes `00ff`; add explicit stderr forwarding and exact `shell: line 1: independent-primary-failure\n`; require identical `closeError`, not the sink Error. The sink records bytes before throwing; this proves attempted output, not successful downstream delivery. Original artifact again records fulfillment, not its status/diagnostic. |
| `shell-sequential-nested-binary` (1) | Accept only final return count 1→0. Exact script `nested; checkopen; one; checkopen; drain`, three chunks `00ff`, `80`, `41`, four reads, no intermediate close, exit 0, empty stderr, and buffered output bytes `00ff8041` are retained. Original assertion order establishes these checks passed before the final count failed. |

Thus the original 14 comprise six unambiguous unchanged close failures, three
mis-specified primary-reason assertions with a separate close-swallow issue,
four overstrong EOF return assertions, and one impossible-gate fixture failure.
This classification does not change the original denominator or pass count.

## Three additions and exact contract basis

- Accept `direct-primary-read-zero/error` as **new** checks: direct `readBytes`
  through `drain`, non-aborted supplied signal, first `next()` rejects with `0`
  or the exact primary Error, return rejects with a different Error. Require
  original reason identity and one read/one return. Baseline
  `src/contracts/io.ts:200` uses a separate failed flag, preserves falsy reasons,
  and observes the secondary awaited-return rejection. These are not Shell
  status-conversion tests; neither addition explicitly asserts empty output.
- Accept `shell-selected-limit-error` as **new** actual registry/Shell rejection
  precedence: injected `new ShellLimitError("maxCommands")`, zero reads, one
  rejecting return, exact selected Error identity. Public export is present in
  baseline `src/index.ts:3`/`src/shell/index.ts:3`. This tests a deliberately
  selected error, not actual budget exhaustion or all error classes.
- Baseline `src/shell/runtime.ts:495` unwraps execution failures, rethrows
  ShellLimitError, but formats ordinary errors and returns status 1;
  `src/shell/shell.ts:172` preserves an already-selected rejection over close
  failure. Baseline `src/shell/input.ts:49` marks observed EOF, and `:60` skips
  return after EOF; `:65` indiscriminately swallows invoked return rejection.
  Only this exact historical input source was read.
- Baseline `src/contracts/command.md:84` requires registered cooperative drains
  before both exec settlement and disposal; `:99` gives caller identity,
  selected execution rejection, then cleanup failure precedence. It does not
  convert an ordinary command status into a primary execution rejection.
  `src/contracts/io.ts:208` separately confirms no return after natural EOF.

Normal already-awaited return rejection **must propagate** absent a higher
priority selected reason. Disposal/caller abort can interrupt an UNREGISTERED
return; observe late rejection without awaiting opaque retirement. Registered
cooperative cleanup still delays both exec and dispose. The proposal retains
the existing interrupt/registered cases unchanged. No extra awaits, new
registration obligation for external stdin, or opaque hard-retirement promise
is approved. The new early-return gate is ordinary waiting, not such a promise.

## Rejected claims / fixture defects

1. **Runner freeze mismatch:** proposed `run.mjs:9` still pins `0ec75ef...`;
   `:119` reads those committed fixture bytes and `:121` compares them with the
   revised files, so `cases.mjs` fails authentication before any probe runs.
   It also imports the revised case list at `:7` and retains the old 32-probe
   scope label. Do not bypass byte authentication or claim a 35-case replay.
   The verifier/integration owner must bind the authorized revised fixture
   commit consistently; this adjudicator made no runner edits.
2. The original deferred EOF finally/release promise was not unconditional:
   waiting inside `run()` prevented reaching it. Parent closure is evidenced;
   successful probe cleanup is not. The revised early-return test fixes the
   trigger, but still depends on its parent to detect non-entry. Preserve the
   original status-13 failure and do not call it a timeout waiver.
3. `ATTEMPTS.md` correctly describes the semantic changes, but “establish” is
   accepted only as assertion design/static justification, not new execution
   evidence. `REFREEZE.md` is a proposal, not prior root acceptance. The common
   `outcome` logging change adds fulfilled result serialization; it does not
   change these fixtures' inputs or reason-identity assertions.

## Evidence and limits

Static source/contract review sufficed; **no replay, build, native oracle,
performance work, or new behavioral breadth** was run. Read the retained
attempt-2 cohort, 14 failure observations, summary, and deferred-child command
receipt. No historical artifacts or verifier fixtures/runners were changed.
This is not a fresh authentication of the entire moved baseline archive.

Retained `/tmp/shared-stdin-independent-baseline-attempt-2` SHA256 receipts:

- `summary.json`: `d4c981527c93db073c88b008f039eb22a622e362bf2bfecc066728e8db804996`
- `baseline-cohort.json`: `4d2a5e5cbd028de83cd336f2e30acaab6b3826488eeb048738316d254fe0cd6e`

Only synchronous read/review/edit/commit commands were used; no owned child
sessions, servers, or background processes remain. Await explicit root routing
before any candidate inspection or acceptance.
