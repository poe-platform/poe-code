# Pre-patch fixture correction

First focused pre-fix run: 14 logical tests, 8 pass / 6 fail. Four expected source
failures: three direct structural abort profiles and direct opaque return
invocation. Two fixture failures, not production defects:

- Output quota used unsupported `-h` rather than inspected `--no-filename`, so
  parsing failed before input/output. Corrected flag; order now file then stdin
  so the new direct stdin wrapper, rather than unchanged fileInput, is the branch
  whose failing cleanup must preserve the primary output quota diagnostic.
- Nested Shell fixture compared public string `stdout`/`stderr` to Buffers rather
  than the actual public `stdoutBytes`/`stderrBytes` fields. Corrected field usage.

Initial test bytes and raw failed run retained; original safety tests unchanged.
Intentions and fourteen logical cases unchanged. This corrected fixture was frozen
before the production patch or patched runs. No timeout or semantic relaxation.

Second pre-fix run: 9 pass / 5 fail. The output fixture now passes. The nested
fixture accessed correct fields but deepStrictEqual still distinguished the
public Uint8Array from expected Buffer. Final pre-patch fixture uses Uint8Array
expectations with identical bytes. Both pre-patch fixture versions/raw runs are
retained. The final expectation edit and source edit share one apply_patch call;
the final test hash was frozen immediately afterward, before any patched runs.
No third pre-patch focused replay; do not report a measured final-fixture 10/14.
