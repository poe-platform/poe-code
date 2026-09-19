# csvlook user workflow stress QA

Run the literal registered `csvlook` executable through safe-bash with explicit
UTF-8, C locale, UTC, noninteractive 80×24 terminal and memory filesystem
capabilities. Use the csvkit 2.2.0 frozen profile; canonical tests never invoke
native commands, create host files, access networks or query databases.

1. Run the focused maintained reporter route:
   `node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 packages/safe-bash/tests/commands/csvlook-user-edge.test.ts`.
2. Feed selected frozen captures as reused one-byte fragments. Compare exact
   stdout, stderr and status, then verify exactly one producer finalization.
   Cover split Unicode, quoted multiline/control text, numeric rendering,
   row-limit inference, Unicode truncation, sniffing, duplicate-header warnings,
   malformed rows, explicit datetime formats and physical line numbering.
3. Repeat the selected workflows using a named memory file containing spaces
   and an apostrophe. Ensure stdin is never advanced. Redirect stdout and stderr
   into separate memory files and compare exact bytes/status. Verify the input
   bytes remain unchanged and no unexpected files appear.
4. Preserve the named-file opener's distinct normalization semantics. For frozen
   stdin case 180, quoted CR/LF/tab/ESC/NUL are retained through piped stdin.
   A native named-file probe confirmed CR normalization and NUL stripping,
   producing `| a   |\n| --- |\n| ↵\t\u001b |\n` instead. Do not reuse the
   stdin oracle for this named-file boundary.
5. Block a precision-zero invocation at its first output write. While it is
   pending, execute default precision, no-number-ellipsis, precision-one and
   default precision again through the same shell/plugin. Compare every result
   to the frozen references and release the blocked invocation. Its remaining
   output must retain its original precision configuration.
6. Verify independently native-captured Decimal boundaries through stdin and
   named memory files: `1e309` and `-1e309` render scientific text, while
   `9999999999999999999999999999.5` and `123456789012345678901234567890`
   report exact `InvalidOperation` stderr with no stdout and status 1. Source
   files remain unchanged on both successful and failing runs.
7. Root integration owner registers the exact literal test path in the maintained
   integration inventory and runs applicable uncached build/lint/type checks.
   Root retains product edits, screenshots and Git ownership.

The first run's eight failures included seven test-harness directory-entry shape
mistakes and one stdin-versus-named-file oracle-role mistake. After reading the
filesystem contract and checking the named-file behavior against the frozen
native executable, all original 21 tests passed in 0.73 seconds. These failures
were harness defects, not validated product bugs; no product fix was requested
for them. The native named-file research used one temporary CSV under `out`,
removed in `finally`. Four additional numeric expected results were captured
through native piped stdin without host file creation. Root's original failing
domain regressions establish TDD for those actual product fixes.

After the maintained workspace build refreshed the product imports, all 25
tests passed in 2.00 seconds, with zero failures, skips, TODOs or cancellations.
The four numeric cases each exercise both stdin and named-file execution.

This focused suite does not qualify every argument combination, all locales or
encodings, other terminals, uncooperative opaque hosts, other csvkit commands,
database/network capabilities or full csvkit parity. Unmeasured cases remain
explicit limits, never compatibility passes.
