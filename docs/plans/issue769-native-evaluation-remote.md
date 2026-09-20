# Issue 769: remote-based native eval correction

## Validated regression

Remote `b0b6244b77ab2c217ecfd3860e474efc92425d65` includes the broad standard
implementation from `7d0897d8e`. Its native eval produces 68 mismatches in 84
exact default/JSON/raw stdout, stderr, and exit-status comparisons against
`@playwright/cli@0.1.20`, independently reproduced with native Chromium and
`@cloudflare/playwright@1.3.6` in local workerd.

The differences are not only presentation: JSON.stringify in the browser does
not reproduce the CLI's native transport round trip. Own toJSON methods, Error
names, DOM values, invalid Dates, and throwing getters differ. Plain expression
code generation, filename links, JSON code sections, error channels, and error
exit status also require correction. The old detached eval milestone
`675ba9cd5` is preserved; its old shared controller framework is not transplanted.

## Owned correction

- Keep the remote standard-capability registration and result-section API.
  Only its eval handler imports the new native-evaluation helper.
- Retain the raw result in a native JSHandle capsule. Normalize and serialize
  in the browser before transferring bounded text to the host. User source is
  evaluated only inside serialized native page/element callbacks; there is no
  host eval, Function constructor, vm, subprocess, or filesystem fallback.
- Bound expression/target/filename input to 65,536 UTF-8 bytes or the smaller
  command allowance. Bound output to 1 MiB or the smaller command allowance,
  and to the artifact allowance for filename output. Limit traversal to 10,000
  entries and 100 levels. Host envelope validation precedes response encoding.
- Keep target resolution and semantic code description owned by the current
  controller. Refs are borrowed exact handles, never reconstructed selectors.
  A missing selector is checked before resolution and does not request code for
  an unissued target. Filename output goes through the existing VFS hook.
- Register cleanup before acquisition. Without a session action owner, cleanup
  drains every pending native call. With the standard controller's runAction,
  a modal-yielded action remains registered in the session's pending operations;
  its own finally path drains and disposes the capsule before completion. It
  must not deadlock the next dialog command or fabricate a completed eval value.
- Preserve execution and disposal errors together. Ordinary browser errors are
  admitted text, not uncapped native error payloads. Resource, output-sink,
  cancellation, and cleanup failures must not become successfully reported
  browser errors.

## Shared dependency

Locke owns the shared result/error protocol, separately from this patch:
`PlaywrightCommandResult.isError`, `rawErrorHeader`, omission of generated code
from JSON, and the controller/command already-reported exit-1 marker. The
marker may be raised only after awaited output and cleanup succeed. Only that
marker suppresses duplicate command-wrapper diagnostics. This eval patch must
be integrated with that protocol; the remote baseline otherwise emits Error
sections with exit 0. It does not edit controller, response, command wrapper,
network policy, storage, or run-code behavior.

The qualified dependency chain is `e58632f36` (shared invocation budget),
`f4d71d807` (final boolean option semantics), and
`6a4a68806dd44a114c4d77ecce7f1e507eff7936` (reported-result protocol),
cherry-picked unchanged onto the remote baseline. The local equivalents are
`b3d059c74`, `5311237d2`, and `d21199cea`. Integrate the owned eval commit after
these dependencies, not instead of them.

## Maintained qualification

`playwright-native-evaluation.test.ts` covers transport normalization, UTF-8 and
entry limits, late acquisition/cancellation, cleanup error aggregation, malformed
native envelopes, modal ownership, and unresolved-selector code generation.
Run it with the adjacent `playwright-standard-capabilities.test.ts` using the
safe-bash tsconfig and isolated tsx tooling. Scoped strict types inherit the
maintained package configuration; no root lint or full-root suites are needed.

`playwright-native-evaluation-remote.test.ts` runs the actual registered public
command, native adapter, and MemoryFS. It uses worktree source directly, without
Git-show source overlays. Its 28-case corpus is compared in all three output
modes, including exact VFS file bytes. It additionally records Error/syntax
diagnostics, observes small native limit envelopes for oversized output,
oversized rejection and excessive entries, and cancels a real pending browser
promise with no artifact or retained session. CF cleanup verifies session
absence. Source hashes and the worktree revision are recorded with the report.

Opt in with `SAFE_BASH_REMOTE_REVIEW_RUNTIME` (independent CLI/Playwright,
esbuild and CF tooling), `SAFE_BASH_REMOTE_REVIEW_OUT` (home evidence directory),
`SAFE_BASH_REMOTE_REVIEW_CHROMIUM`, and home `TMPDIR`. Set
`SAFE_BASH_REMOTE_REVIEW_CF=1` for the CF variant. Use a short home-volume
`PWTEST_SOCKETS_DIR`; CLI daemon Unix socket length is limited. Runtime pins are
CLI 0.1.20, Playwright 1.64.0-alpha-2026-09-14, CF 1.3.6, Miniflare
4.20260708.1 and workerd 1.20260708.1. Missing opt-in tooling skips the fixture;
skips do not qualify native behavior. Logs remain under worktree `out/`.

## Qualification result

The September 18, 2026 final source-candidate qualification passes:

- 28 focused helper/standard-capability tests; strict scoped TypeScript passes.
- Native Chromium: 84/84 exact stdout/stderr/exit comparisons against the pinned
  CLI, plus exact filename artifact bytes.
- Actual CF 1.3.6 in local workerd: the same 84/84 comparisons and artifact bytes.
- Both native runs: oversized output, oversized rejection, and excessive-entry
  cases return small limit envelopes before browser-to-host result transfer;
  cancellation drains a real pending browser promise, leaves no artifact, and
  removes the command session. The CF browser session is absent after cleanup.
- Error and syntax diagnostics use stdout-only exit 1 in all three modes;
  their exact stack/message differences remain in the reports, outside the
  passing 84-case matrix.

Evidence under `out/issue769-storage-review/`: `eval-unit-final.tap`,
`eval-types-final.log`, `eval-native-final.tap`, `eval-cf-final.tap`,
`eval-native/remote-eQnPZf/report.json`, and
`eval-cloudflare/remote-Ia7K9A/report.json`. The reports retain native results,
oracle results, source SHA-256 values, and dependency HEAD `d21199cea`.
The working-tree source hashes identify this uncommitted-at-test-time patch;
HEAD alone is not represented as containing it.

The expanded native test first found that filename output could bypass the
helper's one-MiB ceiling when host allowances were larger. Preserve that RED
in `eval-native-seam.tap` and `eval-cf-seam.tap`, plus the focused regression
`eval-filename-cap-red.tap`. The ceiling now applies independently of filename
selection. Do not count the earlier 0/84-difference runs as full suite passes.

## Remaining acceptance

Exact Error/syntax stack bytes differ between wrapper/client versions and are
retained separately, not fabricated or normalized into a false pass. The
84-case matrix is not exhaustive arbitrary-JavaScript serialization parity;
cross-realm objects, exotic built-in overrides, all native target diagnostics,
and complete frame/ref code-generation coverage remain separate acceptance.
Bounds do not establish browser heap/CPU isolation, hostile-page intrinsic
isolation, or all-protocol network enforcement.

Local CF adapter execution is not deployed-service or installed-public-package
qualification. The separate remote CF state-load fallback replaces its context
and tabs and loses per-tab sessionStorage; that validated regression remains
open and is not hidden by this eval correction. Preserve the working native
Node setter path. Issue 769 is not complete with this patch.
