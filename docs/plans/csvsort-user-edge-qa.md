# csvsort independent user edge QA

Run the registered `csvsort` executable through safe-bash Shell with explicitly
injected UTF-8, C/UTC locale, frozen warning provenance and noninteractive
terminal capabilities. All input and filesystem state remain in memory.

1. Execute `node --import tsx --test packages/safe-bash/tests/commands/csvsort-user-edge.test.ts`.
2. Replay every frozen csvsort differential case through shell quoting and literal
   argv, comparing complete stdout, stderr and status. This verifies integration
   with the frozen corpus; it does not create fresh native-oracle evidence.
3. Compare supplementary-plane and BMP text keys by Python codepoint order.
4. Sort quoted multiline bodies and doubled quotes, checking exact output bytes.
5. Reverse Python uppercase ties without altering output text or tie order.
6. Select multiple keys with a later NaN that is never reached after the first
   unequal key, then verify an equal first key reaches the NaN and raises the
   exact Decimal diagnostic. NaN versus null alone does not trap in either
   direction. Check null first keys continue to the next selected key.
7. Check leading-zero protection, raw duplicate/unnamed names-only headers,
   header-only input, explicit blanks, repeated custom null behavior and reverse
   stable null placement.
8. Sort timezone-aware datetimes with equal instants and different offsets; keep
   their input order and normalized timestamp output.
9. Skip CRLF metadata lines and compare the LF output.
10. Confirm quoting mode 2 and verbose errors without frozen traceback metadata
    return explicit status 78 blockers. Successful verbose sorting needs no
    traceback metadata. These refusal assertions do not qualify compatibility
    for the refused cases.
11. Root owns integration-inventory admission and maintained build/test/lint checks.

Independent result: all 13 tests passed uncached in approximately 0.85 seconds.
The first run had an incorrect test expectation for a singleton nonnull `1`
column: Agate correctly inferred Boolean and output `True`. The fixture now uses
`3` to exercise Decimal/null tuple behavior. This was an expectation correction,
not a validated product defect. No product code was edited by this reviewer.

Unmeasured locales/encodings, exhaustive Unicode casing, arbitrary temporal
syntax and the other executable implementations remain outside this focused
qualification. This result does not claim full csvkit compatibility or release
verification.
