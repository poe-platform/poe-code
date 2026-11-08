# Two author-fixture assertion corrections — unexecuted v2

The frozen author run is22/48 in each layout, not48/48. All26 failures per layout
are directory-entry shape assertions:25 table rows stop at redirections.mjs:48;
C09 stops at:124. FileSystem.readdir returns `{name,type}` entries, not native
fs.readdir-style strings. This was an author-fixture API mistake, not an
unsupported-product expectation and not a native oracle discrepancy.

Exact failed IDs: R03,R04,R05,R06,R09,R11,R12,R13,R14,R15,R16,R17,R18,R19,R20,
R22,R23,R26,R27,R30,R31,R33,R34,R35,R36,C09-open-failure-and-prior-effect.
R03 restored and R11 restored fail at the same census assertion, so only1/3
restored-case executions passed. All three mutated executions fail earlier on
their intended byte assertions; that does not make the other two restores pass.

Correction one replaces the table's expected names with explicit `{name,type:file}`
entries, sorted by byte-exact names. These finite names are ASCII, so the declared
expected name order is the same. Correction two changes C09's single expected
`first` to `{name:first,type:file}`. Status/stream/file contents, scripts, controls,
case IDs and all other bytes are unchanged under inverse-patch verification.
Type and membership are asserted, not dropped. See FIXTURE-v2.json for exact hunks.

The25 table failures happened after status/stdout/stderr checks, but before their
file-content and cleanup-counter assertions. Those later assertions are UNREACHED,
not passive passes. C09's prior empty-file check was reached. This distinction
prevents interpreting the wrong census assertion as complete file-effect proof.

`redirections-v2.mjs` is additive, unexecuted and requires different review/replay.
The original fixture, raw captures,22/48 scores and restore failures stay unchanged.
The production commit/tree/full950 package are unchanged. No author rerun: this
attempt exhausted its24 authenticated internal-loader admissions. No new GO is
inferred from the fact that an assertion correction is straightforward.
