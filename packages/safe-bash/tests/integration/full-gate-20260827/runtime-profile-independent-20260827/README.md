# Independent guarded-runtime admission review

## Verdict

**Accept the bounded external-runtime preflight in `6dc79cd58ba57dbbac9aff390af73d05368ccb56`.**
On August 27, 2026, the unchanged author cohort passed **11/11**, and the
independent cohort passed **24/24** (22 executable controls and two source-policy
checks). No execution blocker was found within the documented trusted-host
boundary. This is not a whole-gate result or new product-body acceptance.

Product source remains committed candidate
`8670ebe8f0d39966c2de2638780437398e5f8490`. The reviewer harness is `b7ef6f46`.
The run took place from `2026-08-27T15:28:28.854Z` to
`2026-08-27T15:28:38.603Z`. Raw results are in `attempt-1/RESULT.json`, with
the unchanged author replay separately retained in `attempt-1/UNCHANGED-AUTHOR.json`.
Author evidence `b4266526` authenticates the reviewed source files; its original
capture is not substituted for the new replay.

## Executed boundaries

- Installed Darwin arm64 Node **24.11.1**, absolute executable
  `/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node`, SHA256
  `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`, qualifies.
  Actual guarded candidate imports and TypeScript CJS transpilation succeed.
  Direct `process.execPath` and PATH-selected `node` children report that same
  executable/version, including with legacy-first and hostile shadow PATH input.
- Installed Node **22.22.2** fails identity admission with status **78**. The
  unchanged real CLI refuses before creating its requested output directory or
  entering archive/native/suite work. A separate guarded feature probe preserves
  the original `ERR_INVALID_RETURN_PROPERTY_VALUE` / `got null` failure as 78.
  No Node 22.22.3 claim is made.
- Missing, nonexecutable and changed runtimes refuse; a byte-identical copied
  Node executable also fails the explicitly selected installed-path policy.
  A Node22 launcher cannot use a legitimate Node24 receipt to reach its marker.
- Changed/missing critical source, missing/disabled/symlink guard, changed
  TypeScript bytes and omitted critical hash keys fail. An authenticated importer
  targeting outside the allowed root fails before that outside body executes.
  Compiled-source fallback still fails. Caller `NODE_OPTIONS` cannot remove the
  guard or execute an injected preload.
- Source-policy checks establish that product `engines.node` remains `>=22`,
  package bytes and the authentication hook are unchanged by this patch, and
  actual gate phase code selects Node explicitly for npm. The npm-phase selection
  check is **static inspection**, not a new npm/full-suite execution. The other
  static check covers unchanged package/guard policy.

The CLI identity check runs before staging. The guarded feature check runs after
staging/prerequisites but before suite phases; these are distinct boundaries.
No auth hook was disabled to obtain the positive result. Native49 was not rerun
here: this review does not replace its separately authenticated admission proof.

## Trust and evidence limits

`inspectRuntime(executable)` executes the supplied host executable to inspect its
identity **before** hashing it. A known safe, task-owned shell fixture confirms
this ordering and is then rejected for a hash mismatch. Thus this API is a
trusted-host diagnostic, not safe execution of arbitrary untrusted executable
paths. The real gate supplies its already-executing `process.execPath`; this is
not an admission bypass under that boundary. Receipt validation likewise is not
a sandbox for a malicious host caller fabricating objects.

The reviewer materialized 16 harness files from the source commit and actual
candidate `src`/package/tsconfig inputs from Git archive, using 314 independently
hash-matched regular tool files. No live product-source overlay, private engine
access, dependency installation, or whole-gate launch occurred. Probe child
results are retained; bounded synchronous children terminated, and both author
and reviewer owned scratch were removed. Staged harness hashes and the two
deliberately changed critical sources were checked/restored at the end. Those
runtime checks do **not** inventory every new scratch entry and are not claimed
to be an append-proof whole-candidate audit. In contrast, the final evidence
seal checks exact file **and directory** inventory, rejecting new entries as
well as missing or changed captures.

The separate `0579a239` result remains **45/45 actual unchanged affected test
bodies**, zero skips, on this Node24 profile. Those bodies and actual SafeJS were
**not rerun** here. Historical Node22 failures remain intact. No product support
minimum, overall compatibility verdict, or whole-gate score is changed.

## Replay and verification

Use a new output directory, never overwrite this capture:

```sh
node tests/integration/full-gate-20260827/runtime-profile-independent-20260827/run.mjs /tmp/UNIQUE-runtime-review
node tests/integration/full-gate-20260827/runtime-profile-independent-20260827/verify.mjs
```

The run requires the two already installed pinned Node binaries, authenticated
local development tools and the referenced Git objects. It installs nothing.
The verifier authenticates reviewed source and author receipt against Git,
checks the recorded result, and detects evidence inventory/byte changes. Its
success is verification of this capture, not a fresh execution of its controls.
