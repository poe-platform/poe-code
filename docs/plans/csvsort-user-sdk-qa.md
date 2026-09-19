# csvsort SDK user edge QA

1. Inspect the implemented literal executable and its frozen reference cases.
2. Add original in-memory SDK cases for supplementary Unicode uppercase ties,
   explicit datetime formats with offset equality and microseconds, equal Decimal
   scales with secondary tuple keys and stable signed zeros under reverse.
3. Check names-only leaves malformed body data unparsed and closes the producer
   once without reading beyond the first complete 8192-byte decoder window.
   Smaller transport chunks may be read ahead to fill that frozen TextIO window.
4. Delegate independent registered Shell stress to a different agent; retain root
   integration inventory and Git ownership.
5. Run maintained csvkit unit/lint checks, the selected safe-bash build closure,
   runner inventory checks, strict typechecks and focused Shell tests/lint.
6. Screenshot built Shell sorting and names output with the maintained renderer,
   inspect the image, reduce results into docs/csvkit and purge owned out files.

No engine defect was validated in this round. An initial datetime expectation
used a format inconsistent with fractional input; correcting the fixture to a
uniform explicit fractional format exercised typed ordering. A names transport
expectation initially overlooked the documented 8192-byte decoder window and was
corrected to check unparsed body data and unread later windows. Neither failed
expectation justifies changing the engine.
