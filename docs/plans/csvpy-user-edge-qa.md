# csvpy user edge review

1. Run in-memory Python-console expressions that shadow `str`, `type`, and `isinstance`, retain a user `_csvpy_error` variable, then raise and recover from an exception. Assert exact console output and status. Reproduce failure before isolating internal exception formatting in a separate guest namespace.
2. Enter a class with an unfinished nested function suite. Assert incomplete single-input compilation until the final blank line, then execute the class. Reproduce premature IndentationError before admitting synthetic EOF dedents as incomplete parser input.
3. Use a guest exception with a stateful `__str__`; verify formatting calls it once and console execution continues.
4. Have a different agent exercise registered-shell numeric quoting, DictReader duplicate/empty headers, blank records and line counters, universal newlines, and SystemExit. Preserve failing cases before fixing.
5. Run selected maintained workspace build closures, csvkit lint, focused interpreter regressions, registered-shell suites and integration inventory. Expand to root test and lint for shared parser metadata changes. Record actual outcomes, including blockers.
6. Capture and inspect the registered console visually with the screenshot utility; keep transient scripts, images and logs in `out`, then remove only this review's evidence after recording results.

This review does not qualify exact CPython `code.interact`, optional IPython, complete Agate libraries, or streaming file-decoding behavior.
