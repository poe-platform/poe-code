# Optional runtime providers: independent QA

Run the independently authored `packages/ssconvert/src/formulas/optional-runtime.test.ts` against the ordinary workbook calculation engine. Keep fixtures in memory; do not spawn a native utility or create fixture files.

1. Supply an accessor-backed provider entry, accessor-backed signature, and inherited definition members. Verify rejection without executing getters.
2. Attempt registration of SUM, PRODUCT, GNUMERIC_VERSION, IF, RAND, TABLE, IFERROR and IFNA. Verify rejection before calculation. Verify inherited provider entries never enter the callable namespace.
3. Capture a provider definition and then mutate its original signature and implementation. Verify the captured provider remains frozen and evaluates its original implementation.
4. Return a mutable scalar and mutate it after calculation. Verify calculated workbook values retain owned immutable records. Return undefined, a Promise, a matrix and a wrongly typed scalar; verify rejection.
5. Abort from a synchronous cooperative provider and verify the original abort error escapes. Exhaust the workbook work budget through the supplied tick hook and verify the resource-limit diagnostic.
6. Check explicit enabling of PERL_ADDER and PY_BITAND, omitted-provider diagnostics, typed coercion, arity failure and BITAND above 32 bits.
7. Create the ordinary SDK engine, mutate the supplied provider definition before conversion, and convert an injected byte stream through an original fixture codec. Verify the original provider value, exact output bytes, zero exit status and empty diagnostics.
8. Without optional providers, evaluate custom and prototype-like function names. Verify #NAME? cell errors and no namespace leakage after another invocation enables a provider. Verify IF short-circuiting, IFERROR catch behavior, IFNA noncatch behavior, SUM propagation, GNUMERIC_VERSION and RAND's explicit capability requirement. Verify pre-abort and a zero workbook-work budget remain execution failures rather than cell errors.
9. Stress both typed sample functions with booleans, blank references, numeric text, fractional values, left/right errors and incorrect arity. Verify Perl negative arithmetic and overflow, and delegated Python BITAND negative-input errors.

Execute `npx vitest run packages/ssconvert/src/formulas/optional-runtime.test.ts` freshly, then the maintained package lint route. Root owns maintained uncached workspace build/test and safe-bash integration checks. This procedure does not certify native optional loaders, arbitrary external plugins, or uncooperative host-JavaScript preemption.
