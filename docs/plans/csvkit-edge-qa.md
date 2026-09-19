# CSV edge validation procedure

This procedure covers implemented raw paths and lifecycle boundaries. It does
not authorize Git delivery, README publication, native product fallbacks or
claims of full csvkit compatibility.

1. Preserve the worktree and index. Assign safe-bash adapter stress to a different
   agent; retain root ownership of the domain engine and integration checks.
2. Use the pinned CPython 3.14.2 interpreter and hash-locked requirement closure
   from docs/csvkit. Verify the interpreter hash and released source archive hash.
   Keep native research, helper output and screenshots under out; canonical tests
   must use in-memory inputs and injected capabilities.
3. Enumerate all strings of length zero through five over `a`, comma, quote,
   backslash, LF, CR and ASCII space. Compare reader cells, physical line numbers
   and diagnostics for the nine dialects recorded in the edge validation report.
   Use universally normalized reference input, including CRLF and lone CR.
4. Compare writer rows for empty/null cells and strings through length three over
   the same alphabet. Normalize CR to LF before the native writer to reproduce
   the existing Agate-facing contract. Compare complete output and diagnostics
   across raw quoting, escape, doublequote, terminator and space-delimiter paths.
5. Reproduce every discovered behavior with a failing canonical regression before
   fixing code. Add actual released-command cases for closing quotes and EOF line
   numbering; distinguish primitive enumeration from command qualification.
6. Stress pending cooperative stdin next/return, falsey cancellation reasons,
   cleanup replay, output backpressure and exhausted work budgets. Refusals must
   preserve status 78 and previously emitted bytes without spending exhausted
   budgets on diagnostics. Arbitrary sink failures must remain observable.
7. Run uncached selected domain and safe-bash build closures, domain unit/lint,
   safe-bash source/test/public-consumer typechecks and guarded root ESLint.
   Supplement maintained gates with the two focused csvkit Shell test files;
   disclose their membership without claiming a full safe-bash test pass.
8. Execute compiled public plugin pipelines against MemoryFileSystem. Render
   escaped fields, space-delimiter output and dialect errors with terminal-png,
   and inspect the image for alignment, clipping and readability.
9. Reduce outcomes into docs/csvkit, then purge only evidence owned by this run.
   Preserve unfinished formats, Agate paths, services and committed-HEAD gates
   as explicit blockers. Review README publication only at final delivery.
