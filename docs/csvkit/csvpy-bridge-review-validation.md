# csvpy bridge user review — September 18, 2026

This review exercises the implemented scoped console and preloaded Reader/DictReader through actual PythonSession evaluation and the registered safe-bash command. It does not qualify every Python or Agate edge case. Existing edits and staging were preserved; no README changes, commits, pushes or publication were performed.

## Validated fix

An original failing regression reproduced status 78 when a guest exception's `__str__` raised ValueError. The console now reports `<exception str() failed>` and evaluates the following input. The marker was separately measured using CPython 3.14.2 with executable SHA-256 `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`, matching the frozen profile. An initial system-Python observation used the older traceback API and failed; its corrected observation used a different marker and is not target-profile qualification. Native programs are absent from canonical tests.

The formatter fallback applies only to guest exceptions. Interpreter termination, unavailable formatting and bridge output-admission failures remain failures. Step accounting now checks retained bridge failures during formatting as well as during interactive evaluation. A regression confirms a formatter printing beyond its output budget cannot turn that failure into a recoverable guest exception.

## Verification

- Final uncached `npm test --workspace=@poe-code/csvkit`: 87 files passed, 4,129 tests passed, one skipped and six TODO. Unmeasured cases are not passes. An earlier overlapping run failed a five-second workbook epoch test; the complete maintained suite subsequently passed independently without timeout/config/test changes.
- Selected maintained csvkit build closure passed all four workspace builds.
- Package lint passed ESLint and production/test TypeScript checks. Focused ESLint also passed changed integration discovery and registered review files.
- Registered command review: 35 tests passed across four csvpy files, including seven new independent-agent cases. Exact stdout/stderr/status, unchanged memory-VFS contents and exactly-once closure are asserted. Reader interleaving, empty/string/tuple fieldnames, colliding restkey, preassigned headers, generator errors/close and console output are covered.
- Integration discovery/runner tests passed 109 cases, with the new review file asserted by its literal pathname. An initial package test invocation selected the entire inventory and was interrupted before completion; it is not a pass. The focused registered cases then ran through the existing Node/tsx test route.
- Whitespace validation passed. An ad hoc registered-console screenshot was inspected after correcting review-script configuration. Temporary script/images were kept under `out/csvpy-bridge-review` and removed after inspection. The buffered shell display is not live TTY or console stream-order qualification.

No shared safe-python implementation or export was changed in this review. Repository-wide gates were not rerun; their previously documented unresolved failures remain unresolved.

## Remaining blockers

The census and complete-API blockers in `../specs/csvpy-public-object-contract.md` remain authoritative. Agate Table/Row/Column/MappedSequence/TableSet, typed library objects, complete transitive public APIs, post-parser-error reader recovery, exact CPython tracebacks/compiler/displayhook behavior, CPython 3.9.6 differential qualification and optional IPython remain blocked. Table mode still requires a separately injected qualified library and refuses its absence with status 78. This review does not claim exhaustive compatibility.
