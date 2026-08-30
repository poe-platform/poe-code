# Compiler infrastructure correction before the first module invocation

The sealed recipe 549f2055eb964c33cdbf26109645a422b2b5194a attempted source
compilation once and failed with exactly 880 TS5033 output-write diagnostics.
Four top-level files were emitted; nested directories were not. No semantic
TypeScript errors, type consumers, module loads or candidate cases ran. Original
PRE, RESULT, raw, receipt and partial emission remain untouched.

Root cause is reviewer infrastructure: TypeScript's ensureDirectoriesExist calls
directoryExists (fs.statSync), catches denied reads as absent, then attempts parent
creation outside the granted emission directory. The single-file synthetic probe
missed this. Two new candidate-independent nested-emission controls reproduce the
failure without output read permission and succeed with read permission on the
same fresh output directory. Write permission remains ONLY that fresh directory;
no fence removal, broad workspace write, source/tool mutation or native/network.

Continuation is the still-unstarted first runtime cohort, not a retry or rescore of
candidate cases. One additional source compilation uses a NEW build-continuation
directory. Failed compilation remains a failed phase in the overall history, not
erased by successful emission. Original 667 required jobs and every expectation
remain byte-identical. No subsequent infrastructure retry is implicit. A new
addendum PRE binds the exact continuation parent and controls before execution.
The original runner is retained; new outputs use evidence-continuation. This
correction changes only the output read grant and unique output paths, not product
inputs, compiler version/semantic flags, recipe cases or permission write scope.
