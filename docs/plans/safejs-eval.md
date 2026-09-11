# Guest eval

Implement JavaScript eval without invoking host eval or granting additional host
capabilities. This is a remaining feature, not completed by dynamic Function.

Reference: [ECMA-262 PerformEval](https://tc39.es/ecma262/2025/multipage/global-object.html#sec-performeval).
Eval parses a Script, separates direct and indirect scope, and isolates lexical
declarations. Strict evaluation also isolates var declarations. Non-string input
is returned unchanged. Direct evaluation carries relevant caller syntax context.

## Implementation and evidence

1. Add native-backed parser tests and a budgeted script parser, including strict
   directives, illegal module/return/await syntax, and inherited new.target,
   super and private-name context. Keep original source positions and function
   source metadata. Do not parse eval as a function wrapper.
2. Add failing native runtime comparisons for direct/indirect/optional calls,
   non-string arguments, argument evaluation order, declaration conflicts,
   scope, this, arguments, new.target, super, private fields and completion values.
3. Wire the intrinsic and direct-call detection through normal reference and
   replay evaluation. Execute in guest scopes with proper declaration and
   completion semantics; charge compilation and execution to existing budgets.
4. Extend dynamic source ownership and checkpoint validation for scripts and
   escaping closures, including replay and suspended generators. Validate corrupt
   snapshots and prove host capabilities cannot escape through eval.
5. Run focused native/runtime/checkpoint/security checks, TypeScript and lint,
   then the maintained workspace build and full unit route. Keep incomplete
   work out of release claims. Pushes and releases remain paused.

Current source confirms the missing intrinsic: native `typeof eval` is function
and `eval("1+2")` returns 3; the guest reports undefined and an unbound-identifier
ReferenceError respectively.

The new script parser first fails all 46 grammar/context tests because the entry
point is missing, then passes them after implementation. Six additional source
metadata and fatal-budget checks pass. The broader parser route passes 1,432
tests with one skipped; TypeScript and parser lint pass. Additional focused
private-name, eval and budget checks pass all 86 tests, TypeScript and lint.
The script parser uses the existing statement-list
directive machinery without adding a function wrapper. Private-name validation
has an independently reproduced inherited-context failure and a separate plan.

A first guest eval intrinsic and interpreter execution path now exist locally.
The initial runtime selection failed 24 cases with two ordinary-call controls
passing before implementation. After implementation and correcting one invalid
nested-quote native test fixture, all 26 cases pass, including direct/indirect/
optional calls, non-string input, argument order, local reads/writes, strict var
isolation, sloppy parameter updates, this/arguments/new.target, syntax errors,
thrown primitives and absence of ambient Node capabilities. TypeScript passes.

This is not complete eval support: statement completion values, full declaration
instantiation, class-initializer syntax context, dynamic source/checkpoint
ownership and replay continuations still need implementation and regression
tests. Do not publish or claim conformance from these initial passes.

Next evidence: 13 of 17 native statement-completion cases fail before tracking
last non-empty values for blocks and try bodies and applying undefined branch/
try completions. Those repairs pass all 43 initial eval tests; the broader
eight-file exception/function/dynamic-source selection passes all 172 tests.
Completion state is retained against the budget, and ordinary functions created
inside eval clear that mode so they do not acquire implicit return values.
Loop completions remain unfinished.

Five run/dump recovery checks pass but do not expose a generator-resume defect.
A lower-level test serializes the suspended generator itself, requires a saved
call record, and restores it before sending the eval source: direct and grouped
direct calls incorrectly read global x=9 instead of local x=7. Three indirect
controls pass. Move direct-eval recognition to the common resolved-call path,
using the original syntax and captured intrinsic identity without looking up
the binding again. All 53 initial runtime/completion/recovery cases pass after
that repair. Final TypeScript and focused lint pass. The one initial lint error
was the new private-name scope traversal aliasing this; the traversal now seeds
the current scope's names directly and walks parents without that alias.

Further native declaration probes validate six remaining mismatches: wrong error
type for caller lexical conflicts; missed intervening lexical conflicts; missing
sloppy function-declaration leakage/overwrite; and missing indirect global var/
function declarations. Simple catch-parameter var assignment matches native and
is a control, not an issue. The vm global preventExtensions probe rejects in
the native oracle before eval, so it is not valid comparative evidence.

Eval source accounting and escaping-closure restore also fail concrete probes;
see safejs-eval-source-ownership.md. Prioritize source ownership before further
claims of usable eval support.
