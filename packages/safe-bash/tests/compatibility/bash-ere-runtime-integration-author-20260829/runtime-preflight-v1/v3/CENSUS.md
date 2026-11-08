# Fresh bounded preparation command ledger

Exec replacement changes role, not PID. The four Node PURE processes are
explicit and sequential; only the fourth launches two harmless children, also
sequential. No other Node helpers or runtime imports were launched.

| Role | Known launches / operation |
|---|---|
| startup | shell, mkdir, sed instructions context-only; direct collectors established first |
| reader1 | shell exec→Node, apply_patch utility, mkdir, cp, shasum; failed schema read, fully captured |
| inspect1 | shell builtins display retained reader captures |
| reader2 | shell exec→Node, apply_patch utility, cp, shasum; authenticated source reader |
| inspect2 | shell, two sed retained capture reads |
| inspect3 | shell, two sed retained capture reads |
| inspect4 | shell, rg and two sed reads |
| inspect5 | shell, four sed reads |
| inspect6 | shell, rg and two sed reads |
| inspect7 | shell, two sed reads |
| preparer | shell exec→Node, apply_patch utility, cp, shasum; source generation/syntax only |
| controller | shell exec→Node; two actual harmless children, enrolled and closed |
| publication preparation | shell builtins display existing captures/clock; apply_patch utility |
| publication | shell; apply_patch exact census/source-file-count clarification; cp exact raw records; git add explicit paths; exec→git commit --only explicit paths |

This enumerates48 known launches, counting an invoked patch utility separately
but not inventing another PID for every exec transition. Patch wrapper internals
were not independently traced: do not claim an OS-wide/transitive census from
this ledger. All actual child PID/close facts come from the owner JSONL, not
the planned slots. No asynchronous tool session or active child is retained.

The owned startup collector predates the first fallible helper. Each Node helper
has direct-file raw stdout/stderr before startup; instructions were displayed
separately and never copied into evidence. The actual owner controller additionally
checks connected collector descriptor inode/device identity before admission.
Phase deadline is START.json's finite20min; actual controller has its own60s bound
inside it, without extending the phase. The configured64MiB capture/384MiB work
ceilings are not converted into measured RSS or an independently certified total
administrative capture census. No unknown process retirement was observed.
