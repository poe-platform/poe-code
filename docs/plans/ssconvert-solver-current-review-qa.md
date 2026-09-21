# Solver current independent review QA

## Scope and procedure

Review typed solver loading and validation independently of the implementation
owner, using original in-memory workbooks. Inspect Gnumeric 1.12.61 primary
source under `out/ssconvert-lifecycle/gnumeric-1.12.61`, particularly
`src/xml-sax-read.c` (`gnm_xml_attr_int`, `xml_sax_solver_start`,
`xml_sax_solver_constr_start`) and `src/tools/gnm-solver.c`
(`gnm_solver_param_valid`, `gnm_solver_constraint_valid`). The captured oracle
profile is Linux ARM64 with 64-bit `long` and 32-bit `int`.

1. Run the new independent lexical-integer regression before modifying code.
2. Verify invalid lexical values preserve constructor defaults; contrast them
   with valid unknown enum numbers, which must remain unknown.
3. Check empty text, leading whitespace, signed zero, signed 64-bit boundaries,
   overflow and assignment into native signed 32-bit fields. Check wrapped
   objective/model enums and legacy target coordinates independently.
4. Check unavailable algorithm selection, cancellation, work-budget rejection
   and original-workbook preservation using in-memory fixtures.
5. Run `npx vitest run packages/ssconvert/src/solver` and
   `npm run lint --workspace=@poe-code/ssconvert`.
6. Root separately performs maintained uncached workspace/build routes and
   native/CLI/SDK/virtual command manual integration QA after this review.

## Executed evidence

The pre-fix regression failed: invalid `ModelType="no"` produced `unknown`
instead of preserving `linear`. Source also confirms invalid integer limits
must retain defaults rather than becoming NaN or accepting fractions.
The initial budget assertion was too specific: the formula parser rejected the
budget first. It now asserts limit rejection without inventing ordering among
resource guards. An initial signed-zero expected value was corrected: native
integer assignment yields positive zero.

After fixing shared native integer parsing, the fresh direct solver test run
passed all 63 tests in six files, including five new independent cases.
Tests do not write files, spawn native utilities or query LLMs.

Candidate source SHA-256:

- `model.ts`: `7bb5925cef0666d7b17df6166f4d6bac1319997abcd7ede5f38f58c4f082d6cf`
- `model-current-review.test.ts`: `ce8bd0a1cb7f1180b715dfe34d02429fddc9a278b71bed6dee0559d0ae795191`

Maintained workspace lint passed (exit 0): provider generation, `eslint src`,
source typecheck and test typecheck. No build or broad gate was run by this
review agent; root owns those checks.

## Remaining mismatches and unverified cells

- Native malformed-integer GLib warnings are not emitted by this loader;
  semantic default preservation does not establish diagnostic byte parity.
- No numerical JS solver algorithm exists. GLPK, LPSolve and native nonlinear
  algorithms are unavailable product implementations, not passing cells.
- This review does not establish native differential results, Excel/ODF model
  import parity, solver performance, checkpoint/replay, CLI screenshot parity,
  host/realm isolation or full repository gate completion. Those are separate
  root integration coverage or remain unverified.
- The direct Vitest command is fresh focused execution, not a completed broad
  or maintained workspace test gate. No timing result is a performance claim.
