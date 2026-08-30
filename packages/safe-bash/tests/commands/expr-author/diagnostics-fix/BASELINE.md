# C-profile diagnostic pre-edit freeze

August 27, 2026. Implementation leaf, no redelegation. Public integration HOLD.
Baseline source is `27a7793526830768484885afba5832bf8bb248b5`.

`baseline27a/` was captured **before any product edit**. Its exact Git source
archive was built offline with existing development dependencies. The only
overlaid inputs were the two new focused diagnostic test files; their SHA256s,
every archived source/test/config hash and the archive hash are in
`inputs-before.json`. No live source was overlaid. Strict source/expr-test checking
uses `skipLibCheck:false`; it is scoped, not a global consumer or release gate.
Post-run input inventories compare changed, deleted **and appended** entries,
excluding emitted `dist` and linked `node_modules`. The native prerequisite link
is recorded as a link, not recursively inventoried; executable/archive/source
pins and archive-member equality are independently checked by `compare.mjs`.

Before-fix results:

| Focused cohort | Cases | Semantic | Exact stderr | Strict |
| --- | ---: | ---: | ---: | ---: |
| Eight original GNU/C gaps | 8 | 8 | 0 | 0 |
| One extension GNU/C gap | 1 | 1 | 0 | 0 |
| Additional invalid grammar/quotation controls | 46 | 46 | 3 | 3 |
| Additional valid controls | 9 | 9 | 9 | 9 |
| Separate quoted correction1 | 1 | 1 | 1 | 1 |

Focused regression tests: **16/71 pass,55/71 fail**. Unmodified archived expr tests:
**241/241 pass**. Build and scoped strict checking pass. No skip/TODO counts as a
pass. This is not a full frozen-cohort replay: the original95/extension20 results
remain preserved in the independent review, and the next reviewer owns replay.

`native.json` preserves exact inputs and native bytes for GNU9.7 on Darwin/C,
not GNU/Linux. The official release archive, extracted source member, existing
development executable and Apple executable are hash-pinned. GNU captures with
`argv0=expr` supply exact expectations. Separate unmodified absolute-argv0 GNU
captures expose invocation-label binding; their staged executable path must
never be injected into product stderr. Apple results remain separate.

Causes are local to `syntax.ts`: missing previous/current-token context, no
distinct empty invocation/help path, and conflated missing/wrong closing tokens.
Short-circuit grammar is already fully parsed; that behavior must remain intact.
The intended actual virtual label is `expr`, as registered by createExprCommand.
Meaningful controls cover help/version versus operands, operator/prefix arities,
skipped invalid grammar versus skipped runtime errors, C-byte diagnostic quoting,
budgets, stdin non-acquisition, backpressure and exception identity.

One separately recorded pre-existing limit is native interleaved evaluation
versus AST-first parsing: `1 / 0 extra` reports native division by zero but a
virtual trailing-token syntax error. Correcting evaluation/parse ordering would
require a separate design authorization; it is not a diagnostic parity pass.
The old `grammar.test.ts` assertions for empty argv and `--` accept only a
syntax-error prefix. They are expected to fail after the demonstrated correct
empty-operand/help diagnostic; this leaf will not silently rewrite them.

Primary sources consulted with web.run: the official GNU v9.7 `src/expr.c` and
`doc/coreutils.texi` in the coreutils/coreutils repository, plus GNU's release
announcement. Moving online manuals were not substituted for the pinned v9.7
source or native observations. `main`, `require_more_args`, `eval6`, and `eval7`
explain empty invocation, token context, quoting and parentheses. No GNU source
implementation or regex engine is copied into the product.

Reproduction is explicit opt-in and always creates a new output directory:

```sh
node --import tsx tests/commands/expr-author/diagnostics-fix/validate.mjs baseline 27a7793526830768484885afba5832bf8bb248b5 NEW-LOWERCASE-NAME
```

Canonical tests do not rewrite this evidence. Baseline replay overlays the two
new live test files only; compare their recorded hashes to the pre-edit freeze
before calling a future replay unchanged. Candidate mode archives committed
source and tests without overlays. The baseline output path is immutable;
candidate mode reads its native receipts without rewriting them.
