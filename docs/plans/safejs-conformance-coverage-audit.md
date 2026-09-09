# Conformance evidence gap

Read-only review on September 9 found that
`packages/safe-js/test/adversarial/test262-semantics.test.ts` contains seven
hand-written passing cases and one skipped no-op placeholder. It labels itself
"Test262-style"; it does not import or execute the upstream corpus. The skipped
placeholder says proxies and weak references are outside the language, which
does not describe current committed Proxy support or experimental weak-reference
work. Do not count that placeholder as a tested restriction or a conformance pass.

The separate `src/interp/conformance.test.ts` is also a hand-written matrix.
The inspected package scripts provide unit and adversarial routes, but no
upstream corpus route. This bounded inspection is not proof that no external
conformance tooling exists elsewhere.

Next verification work should establish an explicit corpus revision, supported
execution modes and harness requirements, then report per-case outcomes and
unavailable capabilities separately. Do not silently wrap every script in an
async function: that would change global declarations, strictness, completion,
early errors and module behavior. Preserve negative parse/runtime expectations,
async completion signals and realm requirements. Capability restrictions must
remain explicit, not become ambient host access merely to run a corpus.

Before replacing the stale placeholder, reproduce representative Proxy behavior
on committed source and retain weak-reference status as unfinished until its
runtime work is independently validated. Do not modify a candidate during its
active full-suite verification. This audit records missing evidence, not a
runtime fix or a claim of full JavaScript conformance.

## Upstream execution contract and current entry point

Reviewed the upstream [Test262 interpretation requirements](https://raw.githubusercontent.com/tc39/test262/main/INTERPRETING.md)
on September 9. Tests require isolated realms and normally global-script
evaluation, with strict and non-strict variants. Metadata changes these modes;
raw cases forbid source transformation and harness injection. Negative cases
must match both error type and phase. Async cases require the harness completion
signal, not merely a resolved runner promise. Module fixtures are dependencies,
not independent test cases.

Current source inspection: `src/run.ts` calls `parseExecutableModule`, whose
implementation in `src/parse/parser.ts` calls `Parser.parseModule`. The same
parser file has a separate `parseEvalScript` path with `return: false`, explicit
strictness and `parseScript`, but that alone does not establish a complete
public global-script execution route. Before adopting an upstream runner,
validate global declarations, top-level `this`, script completion, early errors
and realm isolation through the intended entry point. Simply routing corpus
text through the existing `run` API is not yet justified. This is an integration
evidence gap, not proof that every corresponding language semantic is absent.
