# Additional controls frozen before implementation

Nine additional logical controls maximum, not repeated-run counts. Originals
remain five unchanged tests; head-zero is the sixth existing neighboring control.
All virtual runs use the same copied source; strict unhandled-rejection mode.

| ID | Frozen question and acceptance |
| --- | --- |
| C1 | After a successful nonempty pipe write, pending cooperative source work is canceled after consumer reads then exits; output first newline, status 141 under pipefail, exact EPIPE, cleanup before settlement. |
| C2 | Actual Shell middleware awaits source-start before calling next, then consumer attaches and reads output; invocation and pre-output side effect may precede that consumer read, no deadlock. |
| C3 | Producer records pre-output effect, downstream never reads and exits, producer attempts its first output afterward; retain effect, EPIPE/141 under pipefail, no stdout. Native counterpart uses owned marker and explicit no-read builtin pipeline. |
| C4 | Producer completes independent side-effect-only work after downstream exits without reading; effect retained, status zero. Native counterpart. |
| C5 | Empty-output successful work completes after downstream exits; no output, zero status. Native counterpart. |
| C6 | Delayed stderr-only failure after downstream exits retains diagnostic and status 7 under pipefail. Native counterpart. |
| C7 | Stderr precedes attempted stdout after downstream has closed; diagnostic retained, pipefail 141. Native counterpart. |
| C8 | BytePipe at highWaterMark 1 accepts one byte without a consumer read; next write blocks; owned caller cancellation rejects pending write/close/read with same reason. No delivery inferred from write completion. |
| C9 | Explicitly synthetic harness-only demand gate before source-start, with actual middleware awaiting source-start before attaching reader: ordered trace establishes cycle; caller abort bounds it. Not a product demand API implementation or original-case result. |

Each product control has a 1200ms bound; synthetic C9 samples quiescence using
event-loop turns, not a changed original deadline. Native counterparts have a
3000ms hard bound, 64KiB output bound, clean explicit environment LC_ALL=C,
LANG=C, TZ=UTC, umask 022 and pinned Bash 5.3.0. Native `:` replaces head-zero
as an explicit no-read consumer, not as an unreported edit to the originals.
No GNU head assumed; no JavaScript reader-demand analogue claimed for Bash.

Existing selected controls: all 19 non-first-read remote-close scenarios, the
head-zero neighbor, byte I/O contract suites, and only shared cursor/delayed-error
lifecycle cases plus directly relevant streaming/effect tests. No native fallback
helpers will be executed. Existing tests are not additional new cases.
