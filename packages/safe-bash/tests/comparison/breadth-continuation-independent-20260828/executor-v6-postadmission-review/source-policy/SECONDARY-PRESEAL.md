# Supplemental DATA classification preseal

The original checker result is retained unchanged: attempt 2 completed with
25/26 checks passing. Its raw-substring expectation was wrong: the existing
diagnosis already recorded two additional `getBuiltinModule` strings in
`chunk-ZBUZKIPX.js`. This was the independent reviewer's expectation error,
not a new diagnosis defect, comparator execution or authorization failure.

Before the supplemental checker executes, fix these narrower expectations:

- Across the same 21 authenticated source files, exactly three AST tokens carry
  `getBuiltinModule`: one Identifier in the main bundle's property access,
  byte 503554 line 808; two StringLiterals in chunk-ZBUZKIPX.js at token starts
  1750 and 1851, containing the property-name and explanatory reason respectively.
  Raw substring starts remain 1751 and 1860. If exact token starts differ, preserve
  the mismatch; never adjust committed prior results.
- The main bootstrap `e` binding has six identifier occurrences (declaration,
  two typeof operands, three direct calls); `t` has three (declaration, two
  property bases); imported `Ks` has three (import, typeof, fallback call).
  These are complete-source symbol references, not global spelling counts.
- The fallback module's export `a` refers to local `m`; retain its bounded export
  excerpt and complete shim declaration. Inspect the extra string literals'
  config object and surrounding binding usage as DATA; their presence is not
  another actual getBuiltinModule call.
- Reauthenticate the previously read 21 source files and guard texts using the
  immutable, committed first results as expected hashes. Record before/after
  hashes and guard line/byte locations. No additional comparator source is read.

Source and guard excerpts remain bounded. The original 25/26 result is not
relabeled as passing by these additional checks. No product/comparator import,
policy implementation, builtin probe, worker, native oracle, network, install,
archive read/materialization, execution staging or timing is authorized.

Commit this preseal and supplemental checker before execution. Read the first
results via the explicitly supplied immutable commit and verify working bytes
equal that blob. Exclusive supplemental output creation only; do not overwrite.
