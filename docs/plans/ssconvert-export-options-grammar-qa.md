# Export options grammar QA

Keep primary source and temporary observations in `out`. Do not change README
files, push, publish, or use native conversion as a product fallback.

1. Authenticate the released Gnumeric 1.12.61 archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Authenticate GOffice 0.10.61 against the captured reference profile. Inspect
   `go_parse_key_value`, `go_strunescape`, property handlers, common saver options,
   configurable text handling and image export in those sources.
2. Run concrete failing in-memory grammar, text-handler and numeric-prefix cases
   before implementation. Verify exact diagnostics and unchanged destination
   namespace with memfs. Keep original fixtures small.
3. Verify quoted/bare Unicode keys, Unicode whitespace, mandatory equals,
   escaping, empty values, adjacent pairs, ordered duplicates and lazy first
   failure. Verify provider rules before common selection, plain CSV rejection
   of configurable text options, enum/boolean validation and registration
   ownership.
4. Verify graph image ID dispatch, resolution default 100, inclusive bounds
   1..10000, decimal/hexadecimal C numeric prefixes and invalid values through
   the shared SDK and virtual command. Use injected I/O, rendering and signals.
5. Have a different agent stress/fix the implementation. Validate every repair
   with a failing test. Keep root ownership of exports, integration and Git.
6. Run maintained uncached selected workspace builds, package tests/lint and
   the registered Safe Bash command integration file. Inspect a screenshot of
   actual virtual-command diagnostics. Source/libc-only comparisons supplement
   the captured reference; they do not qualify a fresh native ssconvert run.
7. Record verified coverage and remaining mismatches in
   `docs/ssconvert/export-options-grammar-verification.md`. Mark unavailable,
   canceled, unsupported and unmeasured checks explicitly. Purge owned temporary
   source extraction, logs, vectors and screenshots after recording results.
