# Template raw line-ending normalization

## Validated failure

At runtime 246946605, a bounded upstream probe ran all 30 top-level String/raw
fixtures from Test262 commit `72faf8ec1445c55149615e8b35187830783aba1a`.
It parsed metadata, loaded original sta.js/assert.js and declared includes,
qualified each case in a fresh native VM (one-second timeout), then ran each
in a fresh guest with a two-million-step budget. There were no metadata
exclusions or native-unqualified cases. Guest results: 29 passed and one failed
(c1460e). This is not the official Test262 runner or full conformance.

The failure is
[special-characters.js](https://github.com/tc39/test262/blob/72faf8ec1445c55149615e8b35187830783aba1a/test/built-ins/String/raw/special-characters.js):
literal CR and CRLF in template raw text survive unchanged instead of becoming
LF. This includes line continuations. The parser already normalizes cooked
text but assigns the original source slice to the raw value.
The [template raw-value rules](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-static-semantics-trv)
require this normalization; escaped character spellings remain raw text.

## Isolated TDD candidate

While full-suite session 82564 kept main runtime files frozen, an isolated
copy at `/tmp/safejs-template-lines.6ZVZiS` received 20 regressions. The first
run exposed a mistaken test assumption about the parser's expression return
shape. After correcting that assertion, the unchanged parser still failed
11 cases and passed nine (e51be0).

The candidate applies the existing `normalizeTemplateLineTerminators` helper
to the returned raw field, without changing source offsets or the cooked path.
It preserves LF, Unicode line/paragraph separators, escaped character spellings,
and undefined cooked values for malformed tagged escapes.

Verification in the isolated copy:

- 160 tests passed across ten template/parser/interpreter/snapshot files
  (f979a1), including normalized raw text at each substitution position and
  template identity after replay.
- The original failing upstream fixture passes unchanged (113148), with its
  native VM control also passing. The other 29 fixtures have not yet been rerun
  against the candidate; do not claim a combined 30-case candidate pass.
- Scoped ESLint passed (250edd); package TypeScript no-emit passed (da421e).

The candidate has not yet been transferred to main. Wait for session 82564's
terminal report, verify the main parser is unchanged from the candidate base,
then transfer only this parser change and its test and verify in main.
No screenshot is needed for this nonvisual language-semantics change. No push
or release is authorized under the current hold.
