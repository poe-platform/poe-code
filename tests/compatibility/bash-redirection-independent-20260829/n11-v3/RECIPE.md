# N11-v3: current-stderr diagnostic route, not external stderr

Original N11 fails in all three layouts and remains unchanged: status1/stdoutempty
were observed, but the assertion that external stderr must be nonempty was wrong.
It prevented the later entry/content/counter assertions. No product bug inferred.

For the same exact script `emit &>first &>/absent/out`, the first redirect already
maps stderr to first. Bound runtime.ts414–417 maps ENOENT to the target diagnostic;
1754–1755 captures currentIO in ExecutionFailure;1558–1573 writes the diagnostic
through that stderr **before** finally releases outputs at1581. Thus expect
status1, empty external stdout/stderr, no command entry, sole file first with exact
`shell: line 1: /absent/out: No such file or directory\n`. This is a source-supported
project-profile expectation, **not a new native observation**. Capture all these
fields before asserting them. Never substitute an arbitrary nonempty diagnostic.

This is the last narrow ordinary-fixture correction in the existing actual grant.
Three cases only: authenticated original source-build emit copy; a fresh offline
script-disabled install of the exact existing e0e63b...950-member tar; physical move
of that installed app followed by the same case. No build/repack/types/other replay.
Four direct children (one install, three cases), three fixed loader admissions,
zero application Workers. Cumulative actual totals become51 direct,39 loader,
four observed RegexWorkers from maintained bodies, below128/40/12 respectively.
The original global deadline remains fixed, no reset. Raw capture, ownership,
hash/mode/closure checks and stop policy are unchanged. Preserve old six ordinary
failures (N11×3 and stale module-only Git PUBLIC-NEGATIVE×3), bootstrap failure and
all prior author failures. Do not rewrite the M1A profile assertion.
