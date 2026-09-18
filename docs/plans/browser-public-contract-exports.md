# Restore canonical browser contract exports

## Objective

Preserve the existing Safe Bash browser public API after extracting its shared
contracts into an unpublished, artifact-local workspace. Keep constructors,
symbols and command brands canonical across root and subpath consumers.

## Reproduction

Scoped publication run 35405424604 at main 8c30e56cc fails its installed browser
consumer: `core.browser.js` has no named `FsError` or `evaluateCommandSupport`.
Bundling nested opaque external star reexports loses public contract names.

## Implementation

Explicitly reexport all 24 existing contract runtime members at the browser entry
from their owning canonical subpaths. Preserve type forwarding and existing
externalization. Do not expose the separate shell-value helpers or independently
bundle the shared runtime.

## Validation and delivery

- Reproduce missing exports with an in-memory two-stage esbuild consumer test.
- Assert all 24 existing members retain identity with canonical subpath exports
  and the separate value surface stays absent.
- Run the maintained scoped packaging tests and guarded root ESLint route.
- Build the selected Safe Bash workspace dependency closure.
- Commit only the browser entry, regression test and this plan; push to main.
- Monitor GitHub CLI and scoped package publication through successful release.
- Independently verify remote source and public npm versions. Keep #746 open:
  this publication repair does not qualify managed Python native filesystems.
