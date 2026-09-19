# in2csv JSON user edge QA

1. Acquire the csvkit 2.2.0 reference executable with the existing CPython 3.14.2 hash-pinned dependency requirements in `out/in2csv-user-oracle`. Capture stdout, stderr and status using only the frozen C/UTC environment. Reference acquisition is separate from canonical tests.
2. Probe truncated structures, malformed Unicode/escape sequences, astral-character offsets, trailing commas, malformed numbers and native Decimal spelling. Preserve captures in `docs/csvkit/in2csv-json-user-edge-reference.json`.
3. Add memory-only canonical comparisons to the domain suite; run them before fixes. Fix only concretely reproduced differences.
4. Run maintained csvkit build closure, unit and lint routes, and independently stress the registered safe-bash command with another agent.
5. Capture and visually inspect actual shell CSV output with the maintained screenshot utility. Remove this task's temporary oracle, capture scripts, logs and screenshot after inspection. Preserve unrelated evidence.

Nested serialization versus released Agate flattening requires an explicit behavior decision. Existing unsupported profiles remain blockers and are not passes.
