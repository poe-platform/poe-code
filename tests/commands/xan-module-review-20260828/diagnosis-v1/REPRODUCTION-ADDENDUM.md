# Read-only reproduction correction v2

The first read-only reproduction used deep object equality against parsed JSON.
Its in-memory builder includes explicit undefined fields, which JSON serialization
omits; the committed JSON correctly omits them. That representation mismatch
caused an assertion failure, not an archive/hash mismatch. Full bounded diagnostic
stderr is retained in REPRODUCTION-RESULT.json; no artifact was rescored or changed.

diagnose-v2.mjs replaces only the final comparison with exact serialized JSON
byte equality (including final LF), preserving the original builder and all
archive/case/obligation checks. The original driver and receipt remain immutable.
This commit seals the comparison correction before its read-only execution.
No product/native execution or new semantic expectation is involved.
