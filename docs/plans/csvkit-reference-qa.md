# Isolated csvkit reference qualification

This procedure belongs to the first task of the ordered csvkit implementation
plan. It measures the native oracle; it does not execute product commands or
constitute a product test suite.

1. Read root and safe-bash AGENTS.md and record index/worktree state. Use a new
   owned directory under out; preserve any existing captures and unrelated edits.
2. Obtain the csvkit 2.2.0 PyPI source archive. Verify SHA-256
   `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b` before
   extraction or installation. Reject absolute/traversing/link archive members
   and bound individual expanded files. The census fixture usgeo.upl is 38 MB,
   so a 16 MB member limit rejects this authentic archive; use a declared 64 MB
   bound rather than ignoring the rejection.
3. Create independent CPython 3.9.6 and 3.14.2 virtual environments. Install
   only the authenticated target and the candidate Agate family, then inspect
   actual distribution requirements/versions. Freeze each dependency profile
   independently using reference-profile.json; do not resolve floating versions
   on subsequent qualifications. Verify source artifact hashes when acquiring
   dependencies, and preserve the installed-content manifest hash domain.
4. Capture each of the fourteen entry points under LC_ALL=C, LANG=C, TZ=UTC,
   PYTHONIOENCODING=utf-8, COLUMNS=80 and LINES=24. Clear Python startup/search
   overrides. Use empty piped stdin and independent stdout/stderr pipes. Run
   --help, -V, --version and --csvkit-unknown-option with a bounded timeout.
   Preserve argv, exact decoded UTF-8 channels and process status separately.
5. Inspect actual quoting constants, decimal context/traps, SQLite/zlib
   versions, dialect entry points and optional modules. Do not infer dependency
   installation from historical changelog entries. Record unresolved library
   versions, embedded CLDR identity and absent optional profiles explicitly.
6. Reduce observations to docs/csvkit and semantics to docs/specs/csvkit.md.
   Check the exact14 independent expected names, both 56-observation cohorts,
   statuses and versions. A reference capture passing does not pass a product
   command or an unmeasured format/operation/profile.
7. Acquire and inspect unresolved dependency/runtime provenance before marking
   the freeze task complete. Then audit features/tests, then qualify engine
   boundaries, in the listed order. Keep later product TDD in-memory and native
   oracle/service work isolated.
8. Purge only owned scratch once its evidence has been reduced; preserve all
   failures and limits in the reduced documents. Do not commit, push, publish or
   add README content as part of this procedure.
