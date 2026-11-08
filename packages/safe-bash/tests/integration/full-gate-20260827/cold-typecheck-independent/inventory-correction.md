# First independent attempt retained

`evidence/report.json` records a failed inventory assertion after five phases.
The paired cold result had already reproduced six diagnostics becoming zero.
The checker wrongly treated imported `.d.mts` declarations as unexpected inputs.
The four actual paths and the complete assertion failure remain in the report.
`check-before-inventory-correction.mjs.txt` preserves that exact checker version.

Reading the complete committed manifest then also exposed standalone `.mts`
programs outside the existing root `src/**/*.ts` / `tests/**/*.ts` include rule.
These are not newly excluded by Plato's three-file patch. They must nevertheless
be reported as a limit on an unqualified “all actual source/test files” claim.
Their inclusion is not assumed and their unrelated workflows are not executed.

The corrected checker adds an original-config compiler file list and requires
that the complete before/after list difference is exactly `selected-gnu.ts`.
It checks every `.ts` root input, all canonical `.test.ts` files, and imported
declarations separately, and inventories all `.mts`/`.cts` omissions explicitly.
No diagnostic expectation, compiler flag, product byte or prior evidence is
relaxed. The continuation writes a new `evidence-final/` directory.

## Second inventory stop

`evidence-final/report.json` preserves a second checker failure: six transitive
`benchmarks/*.ts` helpers were rejected by an overly restrictive path guard.
They are committed regular files, authenticated along with the whole snapshot.
The correction permits only exact tracked TypeScript paths or the three copied
dependency package trees, and records additional imported helper paths explicitly.
`check-before-import-closure-correction.mjs.txt` preserves the second version.

To stay within the original cumulative process budget, `evidence-complete/`
reuses six successful recorded phases from the second attempt. The checker
recreates that removed isolated root at the same path, verifies the same complete
snapshot and dependency hashes, and requires identical cwd/argv/status. Reused
stdout/stderr are copied byte-for-byte and clearly marked, not executed again.
All remaining phases execute normally. There is no diagnostic relaxation.
