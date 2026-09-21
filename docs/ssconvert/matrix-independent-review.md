# Independent matrix implementation review

Executed 2026-09-19 against the separate captured [native profile](numeric-native-profile.json). This document records evidence, not a QA procedure.

## Validated repairs

Original failing tests reproduced prefix-string matrix coercion, whole-matrix Cholesky errors where native retains individual valid cells, and output-cell allocation before output shape admission. Matrix coercion now follows native decimal-prefix parsing (including NaN/infinity), rather than percentage/date format matching. Cholesky retains the upstream ordinary accumulation order and returns per-cell numeric/error results. Matrix output checks the cell budget before converting numbers into output cells.

Source evidence: src/value.c value_get_as_float; src/mathfunc.c gnm_matrix_from_value; plugins/fn-math/functions.c Cholesky-Banachiewicz and symmetric averaging; GOffice go-matrix.c QR inverse conditioning and regularized pseudoinverse.

13 independent unit cases and eight original matrix unit cases passed (21 total). Units used only in-memory fixtures and injected capabilities. The shape-budget test intercepts output conversion to prove admission occurs first. Scoped ESLint passed for the matrix module and independent test; root owns maintained build/typecheck/integration validation.

## Native differential evidence

The first 14-formula run exited 0 with empty stdout but emitted two GOffice critical assertions for a negative pseudoinverse threshold. That case produced uninitialized memory and is not a stable numeric oracle result or a pass. The follow-up seven-formula run exited 0 with empty stdout/stderr using the captured memory GSettings backend. Twenty stable case observations were compared with the actual JavaScript workbook engine and native-style field rendering: 17 matching observations and three mismatching observations (two distinct formulas). Repeated observations are shown rather than inflated into independent coverage.

| Formula | Native field | JavaScript rendered field | Result |
| --- | --- | --- | --- |
| `=MDETERM({"12tail",0;0,2})` | `24` | `24` | match |
| `=MDETERM({"50%",0;0,2})` | `100` | `100` | match |
| `=MDETERM({"0x1p2",0;0,2})` | `0` | `0` | match |
| `=INDEX(CHOLESKY({0,0;0,1}),1,1)` | `0` | `0` | match |
| `=INDEX(CHOLESKY({-1,0;0,1}),1,2)` | `0` | `0` | match |
| `=INDEX(CHOLESKY({0,0;0,1}),2,2)` | `#NUM!` | `#NUM!` | match |
| `=INDEX(EIGEN({2,1;1,2}),2,1)` | `0.7071067811865475` | `0.7071067811865475` | match |
| `=INDEX(EIGEN({2,1;1,2}),3,1)` | `0.7071067811865475` | `0.7071067811865475` | match |
| `=INDEX(MPSEUDOINVERSE({1,0;0,0.01},0.02),2,2)` | `0` | `0` | match |
| `=INDEX(MPSEUDOINVERSE({1,0;0,0.01},0.01),2,2)` | `0` | `0` | match |
| `=INDEX(MINVERSE({1,1;1,1.0000000000000002}),1,1)` | `#NUM!` | `4503599627370497` | MISMATCH |
| `=MDETERM({1,1;1,1.0000000000000002})` | `2.220446049250313E-16` | `2.220446049250313E-16` | match |
| `=INDEX(EIGEN({-2,0;0,2}),1,1)` | `2` | `2` | match |
| `=INDEX(MPSEUDOINVERSE({1,1;0,0.02},0.015),2,2)` | `50` | `0.005000499899985003` | MISMATCH |
| `=INDEX(MPSEUDOINVERSE({1,0;0,0.01},0.02),1,1)` | `1` | `1` | match |
| `=INDEX(MINVERSE({1,1;1,1.0000000000000002}),1,1)` | `#NUM!` | `4503599627370497` | MISMATCH |
| `=MDETERM({"nan",0;0,2})` | `#NUM!` | `#NUM!` | match |
| `=MDETERM({"inf",0;0,2})` | `#NUM!` | `#NUM!` | match |
| `=INDEX(EIGEN({2,1;1,2}),2,1)` | `0.7071067811865475` | `0.7071067811865475` | match |
| `=INDEX(EIGEN({2,1;1,2}),3,1)` | `0.7071067811865475` | `0.7071067811865475` | match |

## Independent high-precision evidence

Isolated QA used mpmath 1.3.0, 80 decimal digits, without putting Python or mpmath into product/unit dependencies. Exact reference values:

- Symmetric eigenvector component: 0.70710678118654752440084436210484903928483593768847403658833986899536623923105352.
- Mathematical inverse entry for the binary64 near-singular matrix: 4503599627370497.0; the native function deliberately rejects this matrix.
- Exact determinant of that near-singular matrix: 0.0000000000000002220446049250313080847263336181640625.
- Full-rank upper-triangular inverse entry: 50.0.

## QR repairs and remaining limits

The initial table above preserves the measured failures before the next repairs. Original failing regression cases then reproduced both differences. MINVERSE now uses Householder QR in two-component arithmetic and the upstream diagonal-range condition threshold of 256 epsilon. MPSEUDOINVERSE now applies the threshold to QR diagonals, clears rejected diagonals, forms the regularized Gram matrix, and performs the same ten Newton iterations before applying Q-transpose. Wide matrices follow the upstream transpose recursion. Every retained matrix shape is admitted before its allocation; loop work uses the injected host tick. EIGEN admits n*(n+1) output cells before allocating output/vector structures.

The follow-up native run exited 0 with empty stdout/stderr. All ten observations below match, including rank-deficient and wide pseudoinverses. The two radix observations verify that format-matched booleans must be rejected by conversion functions. Nineteen independent matrix cases plus eight original matrix cases pass (27 total); 24 independent numeric cases plus 52 original numeric cases pass (76 total). Scoped ESLint passes for the repaired modules and tests.

| Formula | Native field | JavaScript rendered field | Result |
| --- | --- | --- | --- |
| `=DEC2BIN("TRUE")` | `#VALUE!` | `#VALUE!` | match |
| `=BASE("FALSE",2)` | `#VALUE!` | `#VALUE!` | match |
| `=INDEX(MINVERSE({1,1;1,1.0000000000000002}),1,1)` | `#NUM!` | `#NUM!` | match |
| `=INDEX(MPSEUDOINVERSE({1,1;0,0.02},0.015),2,2)` | `50` | `50` | match |
| `=INDEX(MPSEUDOINVERSE({1,2;2,4}),1,1)` | `0.04` | `0.04` | match |
| `=INDEX(MPSEUDOINVERSE({1,2;2,4}),2,2)` | `0.16` | `0.16` | match |
| `=INDEX(MPSEUDOINVERSE({1,2,3;2,4,6}),3,2)` | `0.08571428571428572` | `0.08571428571428572` | match |
| `=INDEX(MPSEUDOINVERSE({1,0;0,0.01},0.02),1,1)` | `1` | `1` | match |
| `=INDEX(MINVERSE({2,1;1,2}),1,1)` | `0.6666666666666666` | `0.6666666666666666` | match |
| `=INDEX(MINVERSE({2,1;1,2}),2,1)` | `-0.3333333333333333` | `-0.3333333333333333` | match |

No mismatch remains in the repaired follow-up observations. These measurements do not establish universal numerical agreement with GOffice quad arithmetic.

Negative pseudoinverse thresholds have unstable native output and captured critical diagnostics; JavaScript returns #NUM! and that is not native diagnostic parity. An extreme-scale native batch crashed with signal 11 and a go_quad_matrix_multiply assertion. Isolated MPSEUDOINVERSE diagonal inputs at 1e-200 and 1e200 each reproduce that crash, emit the assertion, and produce no output; these are not stable numeric oracle cases or passes. Isolated native MINVERSE diagonal inputs at those scales return 1E+200 and #NUM!, respectively, with status 0 and empty diagnostics; further non-diagonal scale paths remain unmeasured. A nonbreaking-space numeric prefix is accepted by the captured native locale parser.

Larger/repeated eigenvalue vector ordering, high-dimension convergence, cancellation, ill-conditioned determinant accuracy, all signed-zero paths, other wide pseudoinverse rank thresholds, and aggregate retained-memory accounting are unmeasured. No unsupported/unmeasured case is counted as a pass. Temporary owned fixtures and run output were purged after preserving this evidence.
