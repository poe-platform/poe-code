# Shared unit runtime retirement investigation

The maintained root unit run reported 5-second timeouts in fragmented codec
sessions, ISO-2022-JP recovery batches, CP932 whole-domain encoding, and bytes
method sessions. The initial focused uncached four-file run passed all 2345
cases in 38.02 seconds; this did not establish full-run timeout clearance.

Source inspection found that fragmented codec sessions already yield before
each case, and `PythonSession.close` only marks the session closed rather than
freeing its runtime graph. Native class descendant WeakRefs keep their targets
alive through the current event-loop job. Sharing sessions would weaken the
independent interpreter fixtures, and adding close calls alone was not a
defensible speed fix.

An experiment added event-loop yields between ISO registry rows and before
bytes-method sessions, preserving all frozen sources and assertions. The
focused ISO/bytes run, concurrent with the root unit run, still timed out:
1961 passed and 2 timed out in 35.07 seconds. The affected cases were bytes
`endswith(1.0)` and ISO-2022-JP-2 recovery batch 11. Scoped ESLint passed.

The unsuccessful yield changes were removed; existing and concurrent
safe-python edits were preserved. No implementation fix or verified timeout
clearance resulted from this investigation. The integration owner must rerun
the maintained route without competing checks before selecting next work.

Procedure: `docs/plans/csvkit-shared-unit-runtime-retirement-qa.md`.
