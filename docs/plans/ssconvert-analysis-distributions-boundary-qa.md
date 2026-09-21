# Current distributions boundary QA

This follow-up preserves the implementation and earlier coverage in
`ssconvert-analysis-time-series-distributions-qa.md`. It does not certify the
remaining chart, style, predetermined-bin or consumer-matrix gaps listed there.

## Procedure

1. Rehash the released source archive in `out` against the required SHA-256.
2. Reproduce unsigned periodic sampling overflow with an original memfs fixture
   through `runCommand` before changing production code.
3. Independently capture native unsigned wrap, signed-coordinate and zero-offset
   cases using the retained C/UTC dependency/plugin profile. Compare a 16-cell
   labels/traversal/offset matrix against the current product. Native processes
   belong only to this manual QA; never invoke them from unit tests.
4. Check cancellation and cell/operation budgets, original input preservation,
   values-only output, SDK reference edits, and the existing Safe Bash shared
   CLI/SDK checkpoint/replay cases. Preserve exact diagnostics and namespaces.
5. Build the uncached Safe Bash declared dependency closure, run the maintained
   ssconvert workspace lint and fresh complete tests, and run the maintained
   Safe Bash ssconvert command cohort. Record failed historical runs separately
   from the final stable candidate. A focused pass does not certify a broad gate.
6. Screenshot the actual shared command's boundary CSV output, inspect it, and
   retain a receipt with source/test hashes, oracle results and explicit limits.
   Purge only scratch evidence created by this follow-up after reduction.

No README edits, Git commits, pushes or publication are part of this procedure.

## Recorded result

The pre-fix regression failed concretely; the repaired candidate passed all 16
native boundary cells, 153 independent whole-analysis cases, 6,029 complete
ssconvert workspace tests, 98 Safe Bash command cases, workspace lint and the
uncached 18-build Safe Bash dependency closure. The final screenshot was
generated with the shared command and inspected. These are working-tree checks,
not an immutable committed-archive or full-root gate.

Safe Bash typecheck failed before compilation with exit 2 because the current
root package exports do not contain the required `./safe-fs` runtime identity.
The validator expected `./packages/safe-js/dist/safe-fs.js`; actual was undefined.
This is also recorded in the earlier task coverage; unrelated root export edits
were preserved. No runtime consumer group ran through this failed gate.

The initial complete workspace test loaded production source before the repair
and failed the new wrap case (6,022 passes, one failure). Its final complete
rerun passed 6,029 tests; a focused rerun is not substituted for that full run.
Temporary comparison and screenshot harness failures were investigated and
corrected, with their disposition preserved separately in the receipt.

Permanent evidence: `docs/ssconvert/analysis-distributions-boundary-verification.json`.
The receipt retains the measured matrix, original minimized failing case,
candidate source/test hashes, scratch hashes, passes, failed gates and explicit
unsupported/unmeasured cases. Only this follow-up's scratch directory was
purged after reduction; source archives and earlier captures were preserved.
