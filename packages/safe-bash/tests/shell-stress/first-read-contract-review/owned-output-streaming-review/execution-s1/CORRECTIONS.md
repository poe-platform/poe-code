# Two bounded binding corrections, no source changes

1. Before execution: adapt the frozen driver's obsolete TMP namespace and
   root-only authentication claim to the exact fresh executor assignment;
   add strictly BLOCKED diagnostic observation for the three unresolved records.
   Exact edits are archived in round1-edits.json and the driver delta.
2. First attempted execution failed before candidate import because Node on
   macOS canonicalizes /tmp to /private/tmp. Preserve first-run-transcript.txt.
   Normalize only three historical fixture/facade paths in the new configuration
   and its source manifest. No fixture or expectation changes. Exact path/hash
   deltas are in round2-path-correction.json. Old configuration is immutable.

No further binding/fixture correction is made in this bounded task. The first
actual 20-record corpus execution is preserved intact, including failures.
It reveals an incomplete historical facade (mock.ts also imports the sealed
internal WebDAV resource-id module) and a loopback fixture competing data listener:
the byte-limit listener starts request flow before a deferred handler installs
its actual observation listener. This can lose the first upload chunk. S06 first
times out, S06 reused-buffer sees BBBB instead of AAAABBBB, and S07 upload never
reaches the cancellation barrier. These are not established source defects.

The mandated unchanged historical5/57/9 replay uses the independently reconstructed
candidate's byte-authenticated original test tree, which already contains its exact
complete mock import closure. It does not repair or replace failed acceptance
records. No original assertion, command, barrier, timeout, or source byte changes.

A pre-execution materialization helper initially used a text patch to copy a zero-
length captured historical stdout, producing a newline; its immediate hash check
failed before imports. Untouched fixture materialization was switched to exact
byte copying and all19 hashes then matched. This is a preparation-tool correction,
not a changed historical fixture or a passing test. No input was executed in that
failed preparation attempt.
