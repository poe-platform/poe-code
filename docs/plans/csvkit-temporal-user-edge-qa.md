# Independent temporal user-edge QA

## Procedure

1. Read root and safe-bash scoped instructions; preserve other edits and staging.
2. Replay `docs/csvkit/requirements-cpython-3.14.2.txt` with `pip --require-hashes` in an owned `out` venv. Verify runtime/profile before measuring.
3. Run original executable names with UTF-8 non-TTY pipes under exactly `LC_ALL=C LANG=C TZ=UTC PYTHONIOENCODING=utf-8 COLUMNS=80 LINES=24`. Compare stdout, stderr and status against actual Shell invocations.
4. Probe Boolean punctuation and invisible whitespace, month-date Unicode whitespace, numeric date fields/year pivots, partial explicit strptime formats, fractional output, duration clock bounds and Unicode unit matching.
5. Write original failing in-memory regressions before changing code. Domain owner may edit temporal implementation; root retains integration/export/Git ownership.
6. Run maintained csvkit test/lint checks and focused actual-Shell tests; verify virtual input bytes and directory entries stay unchanged. Root rebuilds domain declarations before Shell acceptance and owns visual verification.
7. Record unsupported/unmeasured cases as blockers. Purge only owned temporary runtime, scripts and logs after evidence reduction.

## Results

The initial independent twelve-case native/Shell comparison returned eight matches and four mismatches. Original canonical Shell regressions reproduced all four; original domain regressions failed four tests before fixes. Fixes cover implicit numeric date ordering/year pivots, internal Python whitespace and Python case-insensitive duration unit matching.

The native long-s unit diagnostic remains an explicit blocker: Agate evaluates unused type hypotheses and raises a Date KeyError even though TimeDelta accepts the value. Current first-accepting-type inference cannot establish that behavior. The original native differential assertion is TODO, never counted as a pass; an active assertion verifies status-78 refusal before output. Direct temporal Unicode Date key lookup errors are independently measured and implemented.

See [validation and remaining blockers](../csvkit/temporal-user-edge-validation.md) for exact examples and scope. Root owns build/integration checks and terminal screenshots. No commit, push, publication or README changes were authorized or performed.
