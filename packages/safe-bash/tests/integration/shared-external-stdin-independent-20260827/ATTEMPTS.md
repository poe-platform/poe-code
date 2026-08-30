# Retained attempts

Attempt 1 (`/tmp/shared-stdin-independent-baseline-attempt-1`) archives, builds,
packs and moves successfully, but its first child fails before any behavior
executes. On Darwin, `/tmp` resolves to `/private/tmp`: the strict loader used a
realpath while the runner allowed a lexical `/tmp` root. No product result is
claimed. Fix: canonicalize the newly created scratch root before deriving the
allowed roots. Frozen probes and expectations remain byte-for-byte unchanged.
The original command stderr, authentication and failure receipt are retained.

Attempt 2 (`/tmp/shared-stdin-independent-baseline-attempt-2`) executes the
original 32-case freeze unchanged against the exact baseline packed build.
Actual result: 18 pass, 14 fail, both negative controls detected. No watchdog
expiry. This original cohort remains retained, not relabeled as a passing run.

Six early/unread close failures reproduce the product defect directly. The
three primary-read/sink rows also observe fulfilled status instead of a surfaced
close failure, but their original expected primary rejection was mistaken:
ordinary command exceptions become diagnostics/status 1 in the established
Shell path. They are not selected execution rejections. Revision 2 asserts the
exact diagnostic and requires the subsequent awaited close failure to surface.

Four original rows wrongly required return after observed natural EOF (the
three EOF variants and sequential nested case). Corrected expectations require
zero return and preserve the exact byte/read checks. The deferred EOF fixture
waited for a return that is legitimately never called, so Node exited **13** on
unsettled top-level await; its finally cleanup did not run. It created no child,
server, or OS resource, and the parent observed process closure. This is a
retained fixture failure, not a timeout waiver or product failure. The revised
deferred test stops early and has the distinct identity
`shell-deferred-early-return`.

Before any candidate route/inspection, revision 2 adds two direct readBytes
primary-reason cases (0 and Error) and one actual Shell selected-rejection case
using a public ShellLimitError. These establish the intended exact precedence
without treating ordinary command status as a rejected exec. Revised cohort:
35 behavior cases plus the same two controls. Original source, loaded hashes,
observations, and statuses remain available in the original freeze/attempt.
