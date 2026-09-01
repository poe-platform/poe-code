# Preserve literal pipeline file includes (POE-003)

## Required behavior

File includes must pass source text to the agent unchanged, including dollar
replacement syntax, Unicode, line endings, and text resembling another file
directive. Expand only directives present in the original prompt; inserted
contents are literal data, not another replacement template. Preserve read
order, existing path resolution, and error propagation.

## Implementation

Use the existing include matcher to identify original offsets. Assemble prompt
segments from the original text and the corresponding file contents instead of
repeatedly replacing substrings in an already-expanded prompt. No new parser,
recursive expansion, caching, user-facing configuration, or dependency is
required. Runtime and CLI preview defer variable file includes until prompt
assembly, avoiding a second expansion of source text. Keep the exported
variable resolver's existing default behavior for direct callers.

## Verification and release

- Revalidate the historical source-code corruption example.
- Add failing helper and public SDK regressions for literal dollar syntax,
  repeated directives, embedded directives, empty contents, and line endings.
- Verify setup, task, step, teardown, and variable-expanded prompt paths with
  memfs and injected agents. Check that source files remain byte-for-byte equal.
- Run focused tests on Node 18/20/22/24, the maintained build, and actual built
  SDK/default-filesystem scenarios without invoking an agent or model.
- Commit only this fix and its plan with normal hooks. Push, monitor the release,
  and verify the actual published artifact before marking the finding delivered.
  Previously pushed fixes remain distinct and retain their release requirements.

## Verified before commit

- Initial regressions reproduce 13 failures; three further regressions reproduce
  variable re-expansion before deferral. The final focused suite passes all 369
  cases on Node 18.18.2, 20.20.0, 22.22.2, and 24.14.0.
- The maintained full build passes. Sixteen actual built-SDK scenarios cover
  direct tasks, phases, literal variables, and file-backed variables on all four
  Node versions. Each uses a second process to verify completed work is not
  repeated. Actual CLI previews retain the same literal source markers.
- The maintained screenshot route succeeds; visual inspection confirms `$&`
  and an embedded file directive remain unchanged in the preview. All owned
  temporary fixtures are removed and no real model is invoked.
- Publication remains a separate verification step, not implied by local tests.
