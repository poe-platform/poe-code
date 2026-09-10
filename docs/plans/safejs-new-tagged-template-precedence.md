# Tagged templates as constructor callees

## Upstream evidence

At runtime 326472c88, all 57 top-level ordinary-template fixtures from Test262
commit `72faf8ec1445c55149615e8b35187830783aba1a` qualify: 41 runtime passes and
16 parser rejections, with no exclusions or native-unqualified cases (064d79).
The negative checks establish rejection, not exact thrown-error branding.

The adjacent 27-file tagged-template probe reports 21 passes and one genuine
guest failure (21bcbf). Two noStrict fixtures are excluded. Three cannot be
qualified in the native VM: cache-realm requires the absent $262 harness, and
the two tail-call fixtures overflow the native stack. Those are not guest passes
or evidence that SafeJS supports proper tail calls.

The failing
[constructor-invocation fixture](https://github.com/tc39/test262/blob/72faf8ec1445c55149615e8b35187830783aba1a/test/language/expressions/tagged-template/constructor-invocation.js)
passes unchanged in the native VM. `new tag` followed by a template must call
the tag and construct its return value. The parser instead finished the new
expression before consuming the template, producing a different grouping.

Both probes load original harness files and declared includes, parse metadata,
use a fresh one-second native VM control and a fresh guest with a two-million-step
budget, and report progress per fixture. They are bounded strict-mode probes,
not the official Test262 runner or exhaustive conformance.

## TDD repair

The initial 13 regressions fail 11 cases and pass two parenthesized controls.
The AST assertion's numeric-node label and source length were corrected before
the final red rerun (9a8dc0); runtime source remained unchanged until afterward.
Cases cover plain/member/computed tags, arrow tags, chained tags, member access
on tag results, argument/substitution order, constructor identity and replay.

Let the constructor-callee parser consume tagged templates alongside member
access, before constructor arguments. A shared parser method now creates tagged
template nodes in both ordinary expressions and constructor callees, preserving
the same lexical context, malformed-escape handling, source spans and advancement.
No evaluator or snapshot format change is needed.

## Verification

- Initial new regressions: 13 passes (90f294).
- Broader parser/template/replay selection: 1,618 passed, one skipped across
  68 files (698336), before adding four final edge cases.
- Scoped parser/test lint passed (5074f2); package TypeScript no-emit passed
  (92d2ac).
- The expanded regression file passes all 17 cases (3a0378), including tag
  failures, non-constructible results, malformed tagged escapes and yield in
  substitutions. Its final scoped lint also passes (0181c5).
- The original failing constructor-invocation fixture passes unchanged in main
  with its native control (ff619a). This is a single-fixture rerun, not a new
  combined tagged-template conformance total.
- Four read-only native/parser controls still reject direct super tags and
  invalid unparenthesized optional-chain constructor forms (97a25b).
- README updated. This has no visual CLI impact, so screenshots are not needed.

The latest full-package gate still predates this parser repair and the two
line-ending repairs. No full-package pass, remote delivery or release is claimed.
