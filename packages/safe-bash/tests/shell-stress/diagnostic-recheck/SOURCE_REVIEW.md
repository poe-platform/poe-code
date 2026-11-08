# Independent review of the diagnostic fixes

Reviewed exact source diffs for22ca649 andc116d637 againstf7000b0, not only test
results. Those two commits change only parser.ts/runtime.ts product files and
new author diagnostic-context tests/evidence. Independent baseline7e9a15d,
original fixtures/oracles, contracts and manifests remain untouched.

## Warning coordinate model

- Parser metadata is additive: Word.printedNewlines and Script.printedLines/
  printedNewlines. Existing source offsets, Command.line and Script.line remain
  the execution/ordinary-diagnostic coordinates. Lexer counters remove escaped
  continuation newlines and replace nested dollar spans with their computed
  spans; they do not alter token text, expansion payloads or input positions.
- printedSimpleLines indexes exact AST Command objects, retains supported word
  newline spans, and counts a parsed newline list separator once. Semicolon,
  and/or and pipeline formatting does not preserve arbitrary original whitespace.
  This is an intentionally partial model, not a generated/reparsed Bash program.
- Runtime.command derives its existing diagnosticLine exactly as before, then
  selects a separate substitutionDiagnosticLine from the current AST map or that
  unchanged line. Only NUL warnings consume the new warning coordinate. Fatal
  parameter/arithmetic and descriptor diagnostics continue using diagnosticLine.
- Entering each substitution constructs a new map. Dollar substitutions use
  printed command coordinates; backticks retain raw-command coordinate handling.
  Existing diagnosticOffset construction remains unchanged. New ASTs from source,
  dot, eval and child bash cannot accidentally match another AST's object keys;
  absent keys fall back to their ordinary command line. Redirection rebuilding
  forwards both new fields, rather than dropping metadata across descriptors.
- Unsupported metadata coverage returns no computed map for compound bodies,
  heredocs, redirect-only commands or words marked unprinted (including ANSI-C
  quoting). Their execution is not disabled. This conservatively retains prior
  diagnostic handling; it is NOT proof of exact warning coordinates for those
  shapes, arbitrary mixed forms, or all future AST constructors.

Independent primary-source inspection used the locally pinned GNU5.3 source:
parse.y calls print_comsub while processing dollar substitutions; print_cmd.c
has the corresponding parsed-command representation path. SHA256 values:
parse.y076a16d00c5b065137b3d2730d2b94a1f6c89a1bbb5d2f4bd72d31e00947e27f;
print_cmd.c7773f595d4ad23a05d480a2424164b7b9eede90a69ff9bb049d7b103a67d9552.
This supports the model's rationale but does not prove an incomplete model is
universal. Exact frozen native bytes, not that rationale, decide acceptance.

## Names and function state

- NUL warnings now render io.scriptName rather than literal shell. Existing
  child-bash code initializes the supplied -c name, source/dot set the target
  label, eval carries its calling context, and file entry uses its path.
- Function definition stores a SHALLOW COPY of its body with definition
  sourceName. It does not mutate the parsed body shared elsewhere. Invocation
  supplies that stored identity, falling back to the caller only when absent.
- This function-name propagation intentionally affects the function diagnostic
  context generally, NOT merely the NUL warning string. It is therefore wrong
  to describe every source change as warning-only. The separate coordinate map
  is warning-only; definition-name fidelity is the additional behavior change.
- The function invocation's positional restoration, local/export/readonly
  restoration, depth/function counters and return handling are unchanged, as are
  source/eval positional/state transitions. The source diff does not alter
  command dispatch, byte sanitization, warning multiplicity, status assignment,
  budget objects, output charging, signal propagation or cursor implementation.

The affected author controls include named -c, file, source/dot, eval, function
definition/invocation and a function defined in a sourced file then invoked by
its caller. Existing source/state and ordinary diagnostic suites provide a
separate regression check. They do not prove every cross-file function context
or conservative pretty-print fallback. No new cases, expectations, broad syntax,
source patches or accounting policy were introduced by this reviewer.

The frozen independent eight fixtures/two names and the original whole88 profiles
are the independent acceptance authority. Author25/bounded-child results are
reported separately, not relabeled as newly independent fixtures. Final results,
actual imports and any foreign drift belong in ACCEPTANCE.md and its raw evidence.
