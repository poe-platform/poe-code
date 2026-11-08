# Native grammar research — preparation only

Consulted official jq documentation and the upstream `jq-1.7.1` tagged source on
2026-08-27. These sources informed independent probe design, not expected output.
The local Apple executable is the actual oracle; the upstream tag is not a claim
of byte-identical Apple source or a universal dialect contract.

## Primary sources and design consequences

1. jq 1.7 manual, Identity, Types and Values, nonfinite builtins, raw input and exit status:
   `https://jqlang.org/manual/v1.7/`
   The manual distinguishes retained decimal precision from arithmetic conversion
   to binary floating point. It describes nonfinite numeric values and predicates,
   while division by zero is an error. This motivated copy/predicate/arithmetic
   probes instead of treating printed `null` or maximum-double bytes as the value
   itself. The exact predicates, status and spellings remain measured questions.
2. Tagged parser, `check_literal`, `classify`, `scan`, `jv_parser_set_buf`:
   `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_parse.c`
   The parser separates string state, literal accumulation and structural
   delimiters, and uses incremental BOM state. Its numeric conversion has a
   build-dependent decimal-number path. This motivated quoted controls, nearby
   tokens, adjoining delimiters, partial/repeated/noninitial BOM and chunk cuts;
   not a global string replacement or a strict-JSON assumption.
3. Tagged number representation, `jvp_literal_number_new`,
   `jvp_literal_number_to_double`, `jvp_literal_number_literal`:
   `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv.c`
   Separate literal and binary representations motivate preserved decimal
   lexemes, overflow inputs, untouched copies after arithmetic and comparisons.
4. Tagged rendering, numeric branch of `jv_dump_term`:
   `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_print.c`
   Number rendering has special NaN/infinity handling distinct from literal
   rendering. The two-stage public pipeline probe tests the semantic consequence
   of serializing and reparsing, separately from a copy inside one jq evaluation.
5. Tagged CLI main input loop and exit handling:
   `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/main.c`
   Runtime processing and ordinary parse-error paths differ. This motivated
   completed-prefix effects, subsequent records/files, and final `-e` status.
   This preparation does not introduce a `--seq` implementation requirement.

## Measured observations, not generalized grammar rules

All observations below reference exact bytes in `native-frozen.json` by case ID:

- `case-sign-neighbors`, `nan-payload-neighbor`, `signaling-nan-neighbor` accept
  their supplied spellings; `incomplete-infinity`, `nan-suffix-cuts`,
  `hex-prefix-rejection` and `double-sign-rejection` reject. Rejection is a valid
  oracle expectation, not an unsupported case omitted from a denominator.
- `decimal-copy-versus-arithmetic` preserves the first `9007199254740993` copy
  while addition by zero renders `9007199254740992`; later untouched copies
  remain precise. `1e400` copies render as `1E+400`, not just maximum double.
- `exit-status-nan` prints `null` but exits 0 under `-e`.
  `nonfinite-type-copy-predicates` records the profile's `isfinite` result for
  NaN rather than substituting a JavaScript finite-number predicate.
- `per-file-bom` produces the first scalar and then fails on the next file's
  BOM. `raw-files-bom-preserved` keeps both BOMs. Neither behavior is inferred
  from a generic text decoder or an assumed per-file parser reset.
- `runtime-continue-false` and `runtime-continue-true` retain the diagnostic and
  continue, with different final statuses. `pipeline-parse-error-prefix` exits
  with the downstream status while preserving the upstream diagnostic.

The `mixed-quoted-container` input deliberately includes an escaped key spelling
that decodes to an existing key. The later key wins in the native result, so this
case does **not** establish output preservation of its overwritten numeric array.
The nonfinite copy/predicate and pipeline cases provide separately observable
number/string controls. Do not silently change this frozen vector to improve it.
