# Expression parser and reference rewriting QA

Target released Gnumeric 1.12.61, archive
<https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.tar.xz>,
SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Acquire/extract primary sources only in `out`. Native ssconvert is a separate QA
oracle, never a product dependency, subprocess or fallback. Preserve existing
source/evidence. Do not edit READMEs, push or publish.

1. Verify the archive digest and identify the captured dependency/plugin/locale
   profile in `docs/ssconvert/reference-profile.json`. Distinguish source review,
   retained native observations and fresh native differential observations.
2. Before implementation, reproduce unary/exponent precedence, omitted arguments
   and reversed mixed/whole-axis translation with original in-memory tests.
3. Review primary `src/parser.y`, `src/parse-util.c`, `src/expr-name.c`,
   `src/expr.c`, `src/sheet.c`, `src/ssconvert.c`, and the Excel, OpenOffice,
   SYLK and Applix convention declarations. Implement data-only parsing;
   never execute formula text with eval or Function.
4. Test parse positions, escaped strings, literals/errors/arrays, namespace
   prefixes, names, reference operators, A1/R1C1, mixed axes, sheet spans and
   external namespaces. Compare AST semantics after cross-format serialization;
   explicitly record unsupported grammars and unmeasured native canonicalization.
5. Test rename/move/merge/resize with preserved caches, unknown function spelling,
   stable sheet IDs and independent named/shared/array expression positions.
   Verify cancellation, work/depth/node/text budgets, foreign accessor denial,
   replay and borrowed-input preservation. Use memfs for unit file effects.
6. Have a different agent independently stress and repair the implementation
   with concrete failing cases. Root owns exports, shared engine integration,
   virtual-command integration and Git.
7. Run maintained uncached workspace build closure for ssconvert and safe-bash,
   fresh ssconvert package tests and lint, and focused safe-bash command tests
   and lint. Check exact CLI/SDK results, statuses, channels and namespace effects.
8. Capture and inspect the actual virtual command through the repository
   screenshot tool into task-owned `out` scratch. Exercise unary/power/omission
   output and an error/resize diagnostic. Reduce results into
   `docs/ssconvert/expression-parser-and-reference-rewriting-verification.md`;
   purge only task-owned temporary outputs after inspection.
9. If a fresh exact-version native oracle is available, run original small
   fixtures there under the recorded plugin/dependency/C-locale profile and
   compare raw diagnostics, formulas and caches. If unavailable, label native
   differential cases unmeasured rather than passing them.

## Current-worktree follow-up

1. Rehash the retained release archive; read `oo_cellref_parse`,
   `oo_expr_rangeref_parse` and `gnm_rangeref_normalize_pp` before interpreting
   sheet sigils, punctuation and missing endpoint sheets. A missing last sheet
   resolves against the first sheet, not the formula's sheet.
2. Reproduce absolute/unquoted ODF sheet-name failures before changing code.
   Have a different agent test literal dollars, malformed qualifiers, invalid
   references, external namespace controls, origin translation and cancellation.
3. After review changes, rerun fresh package tests/lint and the maintained
   safe-bash workspace build closure. Run the actual virtual command tests.
4. Through `npm run screenshot -- --no-header --output out/<owned-name>.png
   node --input-type=module -e '<inline invocation>'`, invoke the built Shell
   with explicit ssconvert registration, memory FS and injected original codec.
   Display cross-grammar reference conversion, unknown formula/cache preservation
   and the exact malformed-update status/stderr. Inspect both images, then purge
   only these task-owned images.
5. Hash the final formula source/test inventory with SHA-256 and record the
   dirty worktree base revision. Check native oracle availability separately;
   do not treat retained native captures as fresh differential results. Record
   all unmeasured runtime/codec cells and the absence of broad repository gates.
