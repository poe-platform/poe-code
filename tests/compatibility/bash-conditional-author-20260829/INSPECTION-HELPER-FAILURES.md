# Preparation/inspection helper failures, retained

1. Source read requested nonexistent previous `runner.mjs` rather than `run.mjs`;
   ENOENT/code1/natural exit, partial output and error captured by read.mjs in the
   preparation root. Corrected after bounded directory-name inspection. No product.
2. Result inspection inline Node expression had a stray final `}` and failed
   parsing with `SyntaxError: Unexpected token '}'`, code1, no body execution.
   Tool raw stderr retains the source/stack; original result roots unchanged.
   Replaced with self-contained inspect-result.mjs establishing owned file capture
   before reading result paths. No product/helper-child dispatch or runtime retry
   was caused by either failure. These are not successful validation controls.
