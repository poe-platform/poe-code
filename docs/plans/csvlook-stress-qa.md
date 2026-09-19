# csvlook independent safe-bash stress QA

Execute the actual registered literal executable using injected UTF-8, C locale,
UTC, noninteractive terminal and memory filesystem capabilities. Canonical tests
must not create host files or invoke Python, native utilities, networks or databases.

1. Run `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/csvlook-stress.test.ts`.
2. Compare exact stdout, stderr and status against all 184 independently frozen
   captures in `docs/csvkit/csvlook-reference.json`. Cover inferred/text-only
   numbers, Boolean/date/duration/null output, precision/grouping/ellipsis,
   small/negative column bounds, Unicode and control/multiline text, header-only
   and empty inputs, row-limit-dependent inference, headerless zero-row loading,
   sniffing, line numbers, zero numbering, BOM and malformed-row errors.
   Include the separately frozen `csvlook-rowlimit-reference.json` captures for
   max-rows at 2^53, sys.maxsize and sys.maxsize+1. Preserve the existing general
   reference fixture when admitting these distinct integer boundary captures.
3. Inject the captured warning source path and verify duplicate/unnamed warnings
   through the same executable. Missing warning provenance remains an explicit
   unqualified profile; this test does not authorize ambient Python paths.
4. Feed mutable one-byte fragments through a multiline, Unicode, numbered table.
   Verify the captured output and exactly one producer finalization.
5. Read a named memory filesystem source and redirect Markdown output. Repeat
   through a CSV-producing pipeline. Compare the output file bytes and ensure
   source bytes remain unchanged.
6. Block the first output write with an explicit promise. Verify no second write
   is admitted until release, then compare all output bytes.
7. Cancel while the first output write is pending. Verify the caller's false
   cancellation reason survives, no second write occurs and input closes once.
8. Close an enrolled consumer destination during a cooperative pending input
   read. Verify cleanup was registered before acquisition, return releases the
   read, consumer reason survives, caller cancellation remains untouched and
   repeated registered cleanup calls do not return the iterator again.
9. Verify headerless zero-row input does not read stdin when sniffing and skipped
   lines are disabled. Verify skipped lines still advance input, missing named
   files preserve open errors and valid named files avoid buffered/stream reads.
10. Delay an admitted named file open across caller cancellation. Verify cleanup
    was enrolled before admission, drains the pending acquisition, closes the
    resulting descriptor exactly once and preserves the caller's false reason.
11. Root integration owner registers the literal new test path in the maintained
   inventory and runs applicable uncached integration/build/lint/type checks.
   Visual CLI screenshot validation remains with that owner.

Initial independent result: all 189 tests passed, with no skips or unsupported
cases counted as passes. The direct focused run completed in under one second.
No product defect was reproduced, so this worker changed only tests and this QA
procedure. Existing implementation owner's failing differential cases establish
the code-change TDD sequence; passing independent cases are additional evidence.

After the reference expanded to 195 captures, the rebuilt implementation passed
all captured outputs plus the five original streaming/workflow cases. Additional
zero-row probes reproduced two further defects: `-y0 -H --max-rows 0 -K1` did
not consume skipped lines, and a missing named input with `-y0 -H --max-rows 0`
returned a successful empty table instead of its open error. The frozen CPython
oracle, using an in-memory tracking TextIOWrapper and `CSVLook.run`, confirmed
zero `read`/`readline` calls without `-K`, exactly K `readline` calls with `-K`,
and FileNotFoundError for the missing named file. Canonical regression tests use
memory streams/filesystems only. The first reproduction was 201/203 passing,
with those two failures explicit blockers reported to the implementation owner.

After the owner fixed skipped-line loading and injected the optional open probe,
all 205 current stress tests passed without skips. This includes the valid named
file no-content-read case and delayed acquisition/cleanup test. Independent
review confirms the adapter enrolls its idempotent closer before calling the
existing filesystem `open`, awaits admitted acquisition during cleanup and
never uses `readFile` or `readStream` merely to probe open. Hosts without the
explicit open capability remain unqualified for that zero-row named-file path;
their status 78 blocker is documented by the implementation owner and is not
represented by a compatibility pass in this suite.

Final integer-boundary reference expansion: all 208 tests passed, with zero
failures, skips or cancellations. The three additional captures preserve exact
CPython islice admission up to sys.maxsize and rejection immediately above it,
while 2^53 remains a valid row limit. The final focused run took 1.5 seconds.

The no-input-read check permits eager shell iterator construction: creating a
JavaScript iterator does not advance the input. Its generator body fails if
`next()` begins input consumption. CPython already owns a TextIO object and the
research probe measured reads, not an equivalent iterator factory acquisition.

This scope does not qualify other terminal/config profiles, encodings/locales,
opaque uncooperative hosts, all stdin backpressure interactions, every shared
argument combination, other executable implementations or full csvkit parity.
