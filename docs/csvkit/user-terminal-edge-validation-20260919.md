# csvkit user terminal edge validation, 2026-09-19

Procedure: [user terminal edge QA](../plans/csvkit-user-terminal-edge-qa.md),
executing the visual sections of the maintained safe-bash QA. The review uses
the existing fourteen-command domain engine with explicitly injected UTF-8,
C locale formatting, UTC, clock and terminal capabilities. It does not qualify
all csvkit 2.2.0 behavior or new TTY, database-driver or service profiles.

Independent stress reproduced and corrected silent suppression of Python's
set-difference warning for `[a-b--c]`; see
[the regression and exact registered-command checks](set-difference-user-validation-20260919.md).
The existing engine policy explicitly blocks unqualified warning-producing
syntax. Native warning output remains unsupported. Valid `[--a]` and `[a-b-c]`
retain their matching behavior. This is the only product change in this review.

Actual registered Shell commands exercised Unicode/wide/combining/astral input,
quoted multiline headers and cells, long text, column widths 12 and 8, row
limit 2, column limit 3, precision 2 and 0 and disabled numeric ellipsis.
Upstream multiline headers and character-count padding remain unchanged.
The full csvstat report matches the frozen reference's stdout/stderr/status,
including decimal statistics, Unicode frequencies, null exclusion, dates and
durations. Locale formatting is injected from measured reference observations;
unmeasured requests throw rather than manufacture a passing report. A separate
maximum-precision report retains long/multiline column names.

Initial diagnostic helper commands mistakenly used `-y0` with csvcut/csvclean;
their argparse failures were inspected and corrected in the helper. Those
captures are failed QA setup, not passes or product fixes. CSV commands are
captured through actual Shell registration; the root bash CLI/SDK has no
csvkit binding. Existing bash help uses screenshot-poe-code without inventing a
product route. An initial helper import used agentCommands from the wrong
module; it was corrected to the inspected standardCommands export.

Default terminal-png uses JetBrains Mono without system fonts: CJK, emoji and
newline-arrow glyphs were missing. Separate system-font captures make CJK,
combining accents and arrows legible; emoji remains visually unqualified.
Product output bytes were not altered. Buffered channel concatenation does not
prove cross-channel ordering; corrected interactive capture uses awaited shared
terminal sinks, while exact stdout/stderr comparisons remain independent.

Domain unit verification passes 99 files and 4,397 tests, with five TODO cases
explicitly excluded from compatibility passes. Domain lint and selected build
closure pass. An attempted safe-bash workspace test used SAFE_BASH_TEST_RG as
a selection filter incorrectly; it is an optional executable profile, not a
file selector. It began all 1,270 files during a build and was interrupted after
missing compiled public artifacts. This attempt is not a test gate pass.
After build settlement, the original sniffer-stress, csvlook-user-edge,
csvstat-user-edge, csvpy-bridge-review and csvgrep-regex-review files pass all
325 tests, zero skips/TODOs/cancellations (9.08 seconds). The normal root build
including code generation, TypeScript and bundle suffix stages passes.

Final diagnostic captures exercise names, help/version, status-2 argparse,
sniff, unnamed/duplicate warnings, invalid-selector and csvclean diagnostic CSV.
Redirected memory-file bytes equal each independently invoked producer's stderr;
selector and csvclean producer statuses are separately checked as 1, even though
the displayed script ends with successful cat. Sniff/selector/diagnostic CSV
also match literal expected bytes. Warning source paths are explicitly bound to
`/reference/agate`, rather than inferred as host paths. No styling is added.

Actual csvpy reader/dict sessions evaluate next(reader), list(reader), 1/0 and
EOF with separate Python terminal input. Shared awaited sink captures retain
banner-before-prompt and traceback-before-next-prompt order. Both return status
0; missing Agate Table objects separately return 78. Three acquired guest
sessions close exactly once. The visual observation qualifies this explicit
JavaScript session profile, not native CPython/IPython/TTY equivalence.

All final PNGs were opened with view_image, including the normal root bash help,
table/report/diagnostic/interactive captures and fallback captures. Layout,
alignment, truncation, upstream multiline behavior, traceback frames and EOF
were inspected. Owned `out/csvkit-user-sept19-*` helpers, logs, JSON and PNG
evidence were reduced here and purged after review; unrelated evidence remains.

Remaining compatibility blockers from the prior integration review remain:
numeric/null operation-cell serialization, Agate Table objects, exhaustive
source-test mapping, alternative stdout encodings, qualified TTY/IPython,
traceback provenance and driver/service profiles. Prior committed-archive and
packed-consumer gate failures are not cleared by this domain fix. No README,
staging, commit, push or publication changes are authorized.
