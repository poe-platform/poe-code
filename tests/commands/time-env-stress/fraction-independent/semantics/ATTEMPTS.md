# Original attempts retained

The first native capture exited 1 before writing any profile or executing any
case. It looked for the generated header at `coreutils-9.7/config.h`; this build
has it at `coreutils-9.7/lib/config.h`. The only correction was that lookup path.
No frozen case, expected byte, source file, compiler configuration, or oracle
was changed. The failed run's temporary directory was removed by `finally`.

Original exception:

```text
Error: ENOENT: no such file or directory, open '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/config.h'
    at Object.openSync (node:fs:560:18)
    at readFileSync (node:fs:444:35)
    at .../semantics/native.mjs:43:24
Node.js v22.22.2
```

After the first freeze but before product execution, source inspection exposed
a typo in the five new invalid-calendar expected diagnostics: the frozen cases
say `invalid calendar date`, while the implementation says
`invalid calendar date or time`. The frozen expectations are NOT changed.
Their exact first-run failures will remain separately classified as harness
expectation defects, not product semantic bugs or passes.

The first archive runner invocation also exited 1 before creating its temporary
directory or importing the product. Its root containment assertion correctly
rejected `/Users/kjopek/Workspace`: the harness parent traversal had six `..`
components instead of five. The traversal was corrected, not the assertion.
Original diagnostic: `AssertionError [ERR_ASSERTION]` at `run.mjs:10:8`, actual
`/Users/kjopek/Workspace`, expected `/Users/kjopek/Workspace/safe-bash`.

The only product run evaluated all312 frozen rows, with301 passes and11 failures.
Six failures expected a direct-command thrown FsError from Shell execution;
Shell instead returns status1 with `shell: line 1: EFBIG: ...` and no stdout.
The five diagnostic typos described above also fail. After all rows, the final
`deepStrictEqual(process.env, {...process.env})` fails on Node's exotic environment
object prototype despite equal entries. The complete stderr is retained.
There was NO product retry, no replacement expectation, and no promotion of
these11 failures to passes. The final import-list/environment summary was after
that assertion and was not emitted; the per-import hash guard itself ran before
every product import, including a deliberately rejected outside-dist import.

The first offline classification used the historical matrix's nonexistent
`virtual` key instead of its `actual` key. Its two output files remain unchanged
as `classification.json` and `preserved-ICU-profile.json`, explicitly superseded
by the `-v2.json` files. The corrected extraction compares exact status/stdout/
stderr against GNU and asserts five historical mismatches. This correction
does not rerun product/native cases, change any fixture, or change the312-row
results. The three canonical native-only witnesses were captured once.

Primary HTTPS retrieval independently downloaded the official9.7 release
archive and both POSIX editions successfully. The current GNU online manual
and index timed out (curl28), so no current manual version is asserted here.
An initial description mistakenly attributed a403 to the web tool; that
unsupported note was corrected to say it supplied no readable body in this
thread. Exact curl statuses/bytes remain unchanged in `primary-fetch.json`.
