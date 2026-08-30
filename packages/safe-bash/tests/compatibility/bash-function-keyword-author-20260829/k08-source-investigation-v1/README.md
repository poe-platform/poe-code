# K08 source-only diagnosis and proposed repair

## Conclusion

This is a positional-parameter expansion gap before arithmetic evaluation, not a fixture quoting mistake or demonstrated function-keyword regression. The preserved K08 script contains double-quoted arithmetic substitution, not a single-quoted literal. Both function syntaxes reach the same runtime arithmetic path and produce the same status1/empty stdout/87-byte diagnostic in each layout. The original expected status0/stdout done is unchanged. No new product, parser, compiler, Worker, Bash or native execution occurred.

## Exact frozen path

All anchors below refer to authenticated files retained under /private/tmp/safe-bash-b35-v4-PLN3cC/future/source-app, not moving HEAD. SOURCE-EVIDENCE.json records their hashes.

1. src/shell/parser.ts:431–455 recognizes arithmetic substitution, slices the interior verbatim, and calls prepareArithmetic(source). K08's source is literally $1 - 1. Outer double quotes cause quoted=true; they do not prevent this branch.
2. src/shell/arithmetic.ts:57–65 has no dollar-token grammar. It throws Unsupported arithmetic token at offset0. prepareArithmetic at21–26 retains that syntax error as an ArithmeticProgram rather than expanding shell parameters.
3. src/shell/runtime.ts:2244–2283 installs/restores function positional arguments. Ordinary parameter expansion at3755–3761 already reads state.positional; K08's earlier test "$1" therefore uses the existing mechanism.
4. Runtime partValue at3709–3711 evaluates the cached ArithmeticProgram directly, with only the named-variable proxy from1185–1195. It never routes the expression interior through positional parameter expansion.
5. evaluateArithmetic at205–213 rethrows the cached error before evaluating nodes, producing the observed token $1 - 1. ExpansionFailure preserves the fatal expansion context. SOURCE inference: failure happens while preparing the first recursive-call argument, before the recursive invocation; this is not demonstrated stack/depth exhaustion.

Arithmetic commands at runtime1699–1701 have the same missing pre-expansion boundary. Substring arithmetic already has a separate ordered Word-part expansion bridge at3796–3826; that bridge and LET must not be refactored incidentally.

## Minimal request to ROOT / Plato

Request ONLY src/shell/runtime.ts (import, private arithmetic-parameter preparation, the two arithmetic callsites) plus NEW src/shell/arithmetic-parameters.ts, and new focused author tests. The parser, arithmetic.ts, conditional/ERE implementation, AST/public APIs and B35 bytes stay unchanged. Runtime is Plato-owned: no edits until this exact narrow transfer is approved. Proposed hunks are semantically disjoint from conditional/ERE handling, although one arithmetic-command branch is adjacent to it; compose against the owner-approved blob and reverse-check all unrelated bytes.

The repair is a parameter-preparation phase, not a dollar-named arithmetic variable or numeric-only shortcut. It must concatenate parameter text before parsing once: with positional value 1+2, expression $1*3 must prepare 1+2*3, not (1+2)*3. That example is a proposed source-derived control, not an executed native observation.

Initial requested profile: plain $0…$9 and braced decimal positional parameters, including $10 meaning $1 followed by literal0. Reuse existing state lookup and nounset/error identity. No expansion result is rescanned as shell source; no eval, subprocess, command substitution, quote-mode broadening or public contract. Existing unsupported expression forms stay explicit failures; do not advertise full arithmetic shell-expansion parity. Broader parameter/quote/substitution semantics require a separately frozen extension rather than an implicit change.

## Primary reference and limits

GNU's official Arithmetic Expansion manual states that arithmetic interiors undergo parameter/variable expansion, and its Positional Parameters manual distinguishes one-digit unbraced parameters from braced multi-digit ones. Sources: https://www.gnu.org/software/bash/manual/html_node/Arithmetic-Expansion.html and https://www.gnu.org/software/bash/manual/html_node/Positional-Parameters.html . Retrieved as official search excerpts on August29,2026; the attempted full-page fetch supplied no body. This supports the missing phase diagnosis, not newly observed GNU5.3 or local native outputs. No native run is proposed as already qualified.

## Existing tests

- tests/shell/core.test.ts:64 retains arithmetic-error-after-prior-effects behavior;112 covers ordinary function positionals, not positionals inside arithmetic.
- tests/shell/runtime-regressions.test.ts:153 covers bare-name arithmetic, short-circuit updates, overflow and division errors; it does not exercise dollar-prefixed positional operands.
- tests/shell/parser-regressions.test.ts:34 preserves deferred malformed arithmetic; fatal-expansion.test.ts:6 and47 distinguish expansion fatality from arithmetic-command failures.
- tests/shell/invocation-closure-sh.test.ts:52 covers readonly checked writes.
- tests/shell/substring-cases.ts:17 and18 cover its existing variable/side-effect arithmetic bridge.
These maintained source files were read and hashed, not run and not asserted to belong to the frozen305-input shipping manifest. The metadata grep also encountered historical source captures; these are not counted as tests.

## Current disposition

Original47a2311e remains51/54 primary,24/24 legacy observation-pair equivalence, and administrative2MiB archive STOP. No rescore, expectation edit, rearchive, runtime replay or new native golden. ROOT decisions needed: approve the two-path positional pre-expansion patch; choose a separate DATA-only raw-record audit or a newly frozen future-publication profile.
