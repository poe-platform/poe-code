# Independent string-length precode freeze and baseline

**Ready for the author; awaiting a committed implementation candidate.** No
product repair was made or independently accepted here. This is a different
reviewer's precode contract and baseline validation, not the author's proposal
or a post-implementation freeze.

## Chronology and immutable inputs

All dates are August 28, 2026, America/Chicago (UTC-05):

- Proposal `debfdd8b42930d8c5f1c0301897e4eeaa68e0979`: 00:44:58.
- Independent literal/body/runner freeze
  **`20351e9920f89cc2a07a98eb24ac062f42be78ad`: 00:56:50**.
- First execution built the baseline but failed before worker-body execution;
  its original report and driver are preserved under `baseline-v1` / `run.mjs`.
- Versioned fixture-only runner correction
  **`fed806142b311a4b79b39806400238100b619ad8`: 00:58:00**.
- Corrected baseline run: 00:58:00.460 through 00:58:14.242. The original
  `worker.mjs`, `vectors.json`, and `deny-native.mjs` bytes still match20351e99.

The author had not changed the bound branch at this checkpoint: current source
still has SHA256 `bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc`.
Execution uses accepted commit **5137a74ec855a32d8a8860eb66b62eb44d11e290**, not
mutable HEAD. Proposal README SHA256 is exactly
`f97311654ee5ef5a8a97d4f0bb1f0036209c2fe342b19774b568b90cfdcdf6e4`.
See `PRECODE.md` for the author-facing semantic and single-string-arm contract.

## Actual baseline outcomes

- **37 direct observation groups:** 17 literal Unicode strings; 12 non-string
  cases; two Boolean errors; six pre-aborted exact-reason cases. Successful
  direct evaluations take one tick/one existing step under maxSteps:1. No
  full-command threshold is inferred from this internal seam.
- **4 isolated trusted String-iterator groups:** three arbitrary yielded
  elements, empty iteration, exact iterator failure, and abort during iteration
  without a new synchronous-loop observation point. The abort case also checks
  ordering of a queued microtask after all iterator/value accesses.
- **19 moved-public groups:** 18 real command queries through exports of the
  actual relocated built package and one real Shell jq→jq pipeline using VFS
  input/result files. Internal lone-surrogate vectors are not public JSON passes.
- **Allocation discriminator:** the actual bound baseline trips the private
  tiny-sentinel Array.from marker. The standalone counter control does not;
  the deliberate collecting control does; an unrelated Array.from delegates.
  The wrapper and trusted iterator descriptors are restored exactly. This is
  a working discriminator with **the desired noncollection property FAILING
  on the baseline**, not a repaired-product pass or an RSS assertion.
- **2 binding controls:** a changed compiled interpreter and a mismatched
  manifest digest both exit1 before the tested interpreter behavior executes.
- **93 unchanged selected regression tests pass:** 91 semantic matrix/
  prototype/order cases and the exact two named resource-boundary tests.
  Zero selected skips/cancellations. One semantic native-oracle test and four
  other resource tests are not selected, including the native-grammar and
  hazardous-expansion child tests. These omissions are specific scope limits,
  not whole-structured-suite acceptance or skips counted as passes.
- Authenticated baseline source build passes. No native jq/yq/reference process
  ran, no new oversized input was used, and no whole gate ran.

The **60 observation groups**, allocation-discriminator characterization,
binding negatives, and 93 existing tests are separate denominators. Do not add
them into a native-compatibility score. A real reverted-candidate mutant remains
**pending the actual author candidate**; the old baseline and fixture counter
are not falsely presented as that future reversion experiment.

## Execution binding and limits

`baseline-v2/REPORT.json` records the 269 selected regular committed source/
config/regression blobs, 314 authenticated installed tool files, actual Node
binary/version/hash, full process argv/status, loaded interpreter/limit/root
module URLs and hashes, generated build manifest and complete regression TAP.
No AGENTS files, Git history/archive, private checkout, dependency installation,
or stale dist reuse is copied into the work area or evidence.

Node22.22.2 SHA256:
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
Product builds first, then its actual package.json and generated dist files move
to a separate `consumer/node_modules/virtual-bash`. The worker asserts root
resolution and imports actual public exports. Each worker has an exact consumer
read fence: original source/tools/checkout paths are not admitted. This is a
regular-file relocated built package, **not an npm-tarball claim**. Direct
interpreter probes intentionally use authenticated internal compiled modules;
they are not public API claims.

The first runner's logical `/var` temporary path triggered ERR_ACCESS_DENIED
during entry-point realpath resolution, before any test body. V2 canonicalizes
only its newly created scratch root before constructing the same narrow fence.
No broad filesystem allowance, permission removal, changed expected values or
product edit fixed that setup failure. `RUNNER-V2.md` records the exact rationale.

Source/tools and built/moved package files are checked before/after, including
new directory entries. Only the declared generated dist directory is allowed
as a source-copy addition. The two deliberate tamper controls are restored
before the final census. Native process attempts in the selected regression
children are denied and logged; the log is empty. Bounded children exited;
their uniquely owned temporary tree was removed. There is no private-repository
or ambient credential access, no privilege setup and no retained process.

Host-intrinsic overrides are small trusted-host compatibility probes, not a
promise to sandbox arbitrary custom iterators, emulate every possible patched
Array.from function, or preempt uncooperative host work. In particular no new
limit/check may be added to the product branch to make these tests pass.

## Next author/reviewer boundary

Author: preserve the 20351e99 holdout bytes and original outcomes. Make the
separately authorized string-arm-only source change, with no charging/signals/
guards/awaits/yields/API/other branches. Return the exact committed source and
test identities. Author fixes to this reviewer's fixtures are not authorized.

Reviewer: authenticate the candidate against baseline semantics, inspect the
precise source delta, rerun these unchanged holdouts and selected regressions,
then compile an isolated real reversion of only the candidate string arm and
prove the tiny collection discriminator catches it. Any fixture correction is
versioned separately; any product correction goes back to the author for a new
candidate and re-review. Until then this is **precode readiness only**.

Replay without overwriting captures:
`node tests/commands/structured-length-independent-20260828/run-v2.mjs tests/commands/structured-length-independent-20260828/NEW_OUTPUT`

`verify.mjs` validates only this frozen packet and recorded outcomes, not a new
implementation or execution. Its seal detects missing, changed and additional
files; create later replay evidence in a separate revision scope rather than
quietly editing this packet.
