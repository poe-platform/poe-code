# Coherent78 checkpoint: original source-build 16/18

## Immutable composition, not a release

Preseal `186804b7ae9d8280aac3ee78e556bfd7c8bba7d3` fixes all inputs and
18 compound families before execution. Selected logical Git tree:
`8437e4eda904e1248c25eeef0d9d455b1d251495`.
The complete 268-input manifest contains 214 production TypeScript files and
exactly five overrides to public78 `67eab12e315054907ef4ef435c6bbca2f59e0c36`.
Reconstruction also reproduces accepted logical DOTGLOB tree
`37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e`; its absence as a stored Git object
is documented by that component, not an unresolved input choice.

Root package/README and non-selected documentation remain historical base67
bytes. Only the accepted DAV README override is included. No root files,
production files, dependencies, arrays, YQ/XAN inputs or fixed76 gate edits enter
this task. Original component proofs are not rescored.

## Actual execution

Executor `acc42a2a1c5963928a09e07043a64aceb9a47e7b` built successfully, then
failed the pre-import Darwin `/var` versus `/private/var` path assertion. The
original capture and exact one-line canonicalization are retained in
`EXECUTOR-CORRECTIONS.md`; no product cases executed on that first attempt.

Executor v2 `688ccf86f3c666518a5a3f13a3a264d699dbd7ca` built successfully and
executed all original 18 source-build cases: **16 passed, C14/C15 failed**.
Raw evidence: `captures/coherent78-author-5d3ADb.json.gz.base64` (gzip JSON,
base64 encoded; includes command stdout/stderr, exact assertions, complete
emitted package inventory and authenticated load records).

- 210 distinct emitted JavaScript modules authenticated during actual loading.
- Exact 78 default definitions and zero runtime/optional/peer dependencies
  passed. Curl and SafeJS stay opt-in; shell builtins do not increment defaults.
- 20/20 created Shell instances disposed; both direct commands exited naturally;
  task-owned temporary root removed; no active owned commands remain.
- No forbidden native-network calls, services, native or private SafeJS runs.
- Scoped consumer types, full tarball, installed/moved behavior and four later
  loader/assertion controls are **not run**: executor stops on source failures.
  The manifest-tamper admission control passed. 858 emitted package files were
  inventoried, but that is **not** an actual full-package pack/install proof.

Node v22.22.2 Darwin arm64 binary SHA256:
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`;
TypeScript 5.9.3 `_tsc.js` SHA256:
`e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419`.

## C14: executor over-specification, proposed correction only

Frozen C14 specifies acquired body, exact `x`/status0, one iterator return and
response disposal before settlement, no pending read/listener, live caller,
and retained header. It does **not** require the already-closed request signal
to become aborted. The executor added that requirement by sharing C13's check.

Observed C14: stdout `x`, status0, empty stderr. The acquisition/finalization,
return/dispose, pending/listener and disposal-before-settlement assertions all
completed before the extra `request.signal.aborted === true` assertion failed
(actual false). Subsequent header, delivered/next and timer assertions were not
reached; do not count them as passes from this run.

Pinned base67 `src/commands/network/curl.ts` distinguishes file/header output
from plain stdout ownership, closes the operation before lifetime abort, and
uses `createOutputOperation` in `src/contracts/output.ts`, whose close removes
forwarding listeners. A disposed operation need not retroactively mutate its
detached signal. No leak or product defect is demonstrated by this assertion.

Proposed executor-only delta: keep `returned === 1` for C13/C14, but require
request-signal abort only for C13's actual timeout cancellation. Preserve every
frozen C14 acquisition/lifecycle/header/caller check. Record the request's final
signal state as an observation, not a new guarantee. No CASES.json change for C14.

## C15: invalid positive fixture, proposed versioned amendment only

Original input array contains a final lone high surrogate. `JSON.stringify`
encodes it as `\\ud800`. Actual result is status5, stdout empty, exact diagnostic:

    jq: parse error: Invalid \uXXXX\uXXXX surrogate pair escape at line 1, column 39

The accepted base67 `src/commands/structured/README.md:229` explicitly documents
unpaired-high-surrogate rejection. Its `input.ts:87` enforces that existing rule.
Selected74361026 changes only the string-length loop, not JSON parsing. C12
already exercises valid supplementary-plus-combining Unicode length successfully.
This C15 positive cannot reach the intended length branch with that input.

Proposed separately sealed v2 input: replace only the final invalid high
surrogate with valid U+FFFD, retaining `[0,1,2,3,1]` and status0. Retain original
C15 bytes/expected-success failure unchanged as historical evidence; additionally
replay those original bytes as a separately labelled status5/empty-stdout/exact
diagnostic refusal control. This would be a disclosed input/profile amendment,
**not** an original18/18 rescore or a production parser change.

## Decision requested

Approve these two precise fixture/executor corrections before resuming. No
frozen expectation or product has been edited to remove either failure. No
source conflict is identified, but author acceptance/full-package verification
remains blocked on this fixture decision. After approval, seal the overlay before
execution, finish all three layouts/types/negative controls, then hand off to a
different reviewer. Original captures remain immutable.

Replay of the current original cohort (expected16/18, no capture overwrite):

    node tests/integration/coherent78-shell-author-20260828/run.mjs
