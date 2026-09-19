# Independent SQL network lifecycle stress

Scope: injected in-memory PostgreSQL-shaped provider through the actual safe-bash Shell and csvkit engine. These cases measure ownership and transaction ordering; they do not measure PostgreSQL service or transport interoperability.

A new original regression reproduced premature disposal in csvsql: successful final-result consumption closed the result and committed before returning its owned row iterator. An iterator requiring its result to remain open failed with CsvkitCleanupError. The command now awaits the same idempotent iterator cleanup used by its registered ResourceScope before result disposal and commit.

Exact canonical cases in packages/safe-bash/tests/commands/csvkit-network-provider-stress.test.ts:

- Successful streaming: exact CSV stdout, empty stderr, status zero; iterator return precedes result close, commit and session close, without duplicate cleanup on dispose.
- Failed iterator cleanup: exact redirected partial CSV bytes remain; shell status one and existing shell internal-error diagnostic; result close, rollback and session close still occur, without commit or repeated iterator return.
- Cancellation during successful late commit: public rejection retains caller reason and waits for pending driver commit; completed commit remains committed and session closes without rollback.
- Cancellation during failed late commit: public rejection retains caller reason and waits for pending driver commit; failed commit triggers rollback and session close.

Validation completed: maintained csvkit selected-workspace build closure; csvkit lint (ESLint and source/test TypeScript); four new cases; 25-case existing SQL provider/lifecycle suite before adding the three additional stress cases. No native commands, file creation, network, Python or real databases occur in canonical tests. The redirected output lives in MemoryFileSystem.

Unmeasured blockers: PostgreSQL/MySQL/MariaDB/MSSQL/Oracle actual driver/service interoperability, real cursor cancellation and server transaction effects. No mock results qualify those cases as passes. Wider maintained integration/test checks belong to the root integration owner.

Maintained package unit run during root transport implementation: 77 files passed, one root-owned original network insertion regression failed with the explicit PostgreSQL insertion-profile blocker; 4,008 tests passed, one failed, one skipped, six TODO. This was an intermediate live-source run, not a completed package gate. An initial invocation with unsupported --runInBand did not run tests and is not counted.

## Independent transport adapter follow-up

Four domain tests in packages/csvkit/src/sql-transport-stress.test.ts additionally measure the shared explicitly injected JavaScript transport adapter:

- Reproduced acquired-cursor leak when driver column metadata access throws. Metadata processing now remains inside admitted acquisition; cursor cancellation and close complete before driver diagnostic delivery.
- Reproduced metadata cleanup failures being passed through the driver diagnostic translator. Cooperative cleanup AggregateError now retains the original metadata/cancel/close reason identities instead of becoming a driver diagnostic. Both disposal stages still execute.
- Session close during pending cursor acquisition waits for the late acquisition, then cancels/closes that cursor once before connection close.
- Caller cancellation during a pending row read requests cursor cancellation; public session cleanup waits for cooperative cancellation/read completion before cursor/connection disposal.

The four new domain cases and eight existing adapter cases pass together (12/12). The native driver-profile additions concurrently authored by root are outside this narrow cohort. This remains in-memory lifecycle evidence, with real services unmeasured.

## Independent native binding follow-up

Five additional cases exercise the shipped native profile configurations through the actual safe-bash Shell and injected mock native APIs:

- PostgreSQL without a server-cursor binding refuses before acquiring a client.
- mysql2 streaming without a server-cursor binding refuses before buffered native execution, then rolls back/releases the session.
- Oracle caller cancellation during late native client acquisition waits for rollback/release and preserves the falsey abort reason zero.
- mysql2 Date result without a qualified decode codec preserves the emitted CSV header and refuses the unsupported scalar, then rolls back/releases.
- Oracle inferred date insertion without a qualified encode codec refuses before native execution and rolls back/releases without commit.

Together with the four prior command lifecycle cases, the owned Shell stress file passes 9/9. Two domain cases in sql-native-stress.test.ts verify missing exact scalar codecs and reproduce MSSQL transaction construction plus release failures losing cleanup identity. MSSQL now returns CsvkitCleanupError retaining both original reason objects; the original failing regression passes after the narrow fix. Focused ESLint passed on these tests and the modified MSSQL profile.

These host-native API mocks measure admission/refusal/ownership behavior, not native npm driver interoperability or real database services. Service availability and optional deployment QA remain explicit blockers until measured.
