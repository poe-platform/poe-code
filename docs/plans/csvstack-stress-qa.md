# csvstack independent stress QA

Execute the literal `csvstack` command through the registered safe-bash plugin
with explicit UTF-8, C/UTC, clock and noninteractive terminal capabilities.
Canonical tests use MemoryFileSystem and injected byte streams only; they do
not invoke Python, native commands, networks or databases or create host files.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvstack-stress.test.ts`.
2. Compare exact stdout, stderr and exit status. Verify input virtual files are
   unchanged. Exercise first-seen header unions, differing header order, missing
   fields, duplicate and empty header names, extra fields and lexical cell values.
3. Verify grouping-column collisions preserve duplicate output column names.
   With `-l`, dictionary writer line numbers replace every `line_number` key,
   including input and grouping keys. Positional no-header output only prepends
   the line number and retains the cached first row without a grouping cell.
4. Exercise first-file no-header width, later narrower/wider/blank records,
   multiline quoted cells, per-file physical `-K` skipping and the source quirk
   where later no-header stdin receives no skip because preflight only read the
   first named file. Verify `--filenames` overrides mismatched explicit groups.
5. Confirm repeated `-` with a header fails before output with the inherited
   text-stream reconfiguration error. In no-header mode, preserve completed
   output before the second invocation encounters the closed stdin handle.
6. Inject a named VFS first-pass close failure and second-pass reopen failure.
   Assert exact acquisitions/returns and preserve the union header and preceding
   rows before a later reopen error. Use mutable producer byte views to verify
   cached first-row ownership after producer advancement and final cleanup.
7. Cancel during pending named header acquisition and during second-pass reopen.
   Confirm each cooperative source receives one return, its pending next settles,
   and false/null cancellation reason identity is retained without acquiring
   stdin.
8. Run root-selected maintained build/test/lint checks after integration. This
   independent suite does not qualify full csvkit parity, deployed VFS providers,
   numeric/nullable reader modes, uncooperative hosts, databases or networks.

The initial independent ten-test stress run passed the existing implementation.
The later suite contains sixteen passing test cases: fifteen exercise behavior
or injected resource contracts; one case asserts explicit status-78
blockers for accepted `-u 2`, `-u 4` and `-u 5`. Those three blocked modes are not
compatibility passes. The line-number collision cases independently confirm the
root owner's fixes; the previous engine failures and differential evidence are
owned by the root's domain regression suite.

Source quirks and line-number collision bytes were independently inspected with
the cached CPython 3.14.2/csvkit 2.2.0 development reference outside canonical
test discovery. The original source is the authenticated source archive under
`out/csvstack-reference`. No new temporary evidence was created by this worker.
