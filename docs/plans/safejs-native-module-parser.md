# Native SafeJS module parser

Replace the Acorn pass with the existing budgeted tokenizer and parser. Match
the Acorn ECMAScript 2026 module grammar, including import/export
forms, import attributes, strict module early errors, and top-level await.
Preserve guest source diagnostics, module graph metadata, and existing harness
parsing behavior. Acorn must not appear in the runtime import graph or direct
dependencies.

1. Add failing native-parser compatibility tests for module declarations and
   early errors. Compare broader accepted/rejected syntax against Acorn and
   published-edition test262 cases during qualification.
2. Parse module declarations in the original parser and produce executable AST
   and linking metadata together, without masking and reparsing source text.
3. Run parser and module tests, then maintained workspace and repository checks.
   Verify entry points with Acorn explicitly unavailable and inspect CLI output.
4. Commit each coherent improvement, push to main, verify remote delivery, and
   monitor GitHub publication through a successful stable release.

The existing uncommitted SafeJS work is preserved. Include the module integration
needed by the delivered parser after reviewing and validating that integration;
do not include unrelated workspace changes.

## Qualification

- The Acorn 8.18.0 comparator and the native parser agree on syntax
  acceptance for all 53,876 JavaScript files in test262, using Acorn's
  ECMAScript 2026 module grammar: 47,885 accepted and 5,991 rejected. The language
  subset contains 24,009 files (18,509 accepted, 5,500 rejected). This comparison
  checks parsing, not interpreter runtime conformance.
- Regression tests cover escaped export/default/meta tokens, import.meta trivia,
  resource declarations in switch clauses, source-position preservation, and
  fatal source compilation budgets. Asynchronous disposal participates in
  top-level-await detection.
- Source-module execution through Node, core and Workerd source entry points
  succeeds with Acorn resolution explicitly blocked.
- The rebased candidate passes the maintained workspace build. Ad hoc CLI
  screenshots verify rooted imports with top-level await and positioned parse
  diagnostics. Source modules compile once, including one-shot result hashing.
- Repository qualification exposed stale provider-selection and archived-document
  fixtures. Focused tests reproduce those failures; corrected fixtures use
  explicit provider metadata, empty environments and mocked command execution.
  All 172 tests across the affected files pass.
- The working checkout has unrelated committed history and a substantially newer
  remote main. Rebase only the native-parser and necessary module-integration
  commits onto current remote main in a detached validation worktree; preserve
  the existing worktree and its unrelated changes.

- Full runtime qualification found that the new switch-resource early error also
  affected the existing harness dialect. A failing regression separates harness
  parsing from standard module/eval grammar; apply that early error only when
  ECMAScript grammar is selected, preserving archived harness recovery behavior.


## Final local delivery checks

The delivery was rebased onto remote main c75f0499a without merging. The original
working checkout retains its unrelated history and dirty changes; its native
parser and harness regression fix are committed separately.

The maintained rebuild and repository lint routes pass. The full unit route
passed 128,609 shared tests, 851 op tests, 29 Python tests, 522 Bash runner tests
and 38,994 Bash native tests. Its initial SafeJS run passed 30,515 tests across
1,428 files; failures identified deleted legacy fixtures, the harness switch
regression and a checkpoint deadline exceeded during overlapping checks.
All ten affected regression files pass on the rebased candidate: 431 tests.
The historical transport fixture failure was separately reproduced with its old
imports; the relocated original bytes pass all six transport tests.

The affected maintained Bash shards were repeated sequentially after other
heavy checks completed. Shard 1 passes 8,212 tests with 284 skips; shard 2 passes
9,092 tests with 74 skips. Both have zero failures and zero cancellations.
Unavailable optional profiles remain skips. These local authenticated GNU Bash
5.2.37 results establish the Darwin profile; GitHub must independently qualify
Linux before stable publication.

Fresh built Node, core and Workerd entry points execute an imported source module
with top-level await, returning 42 while Acorn resolution is blocked. The
production dependency tree contains no Acorn. Following remote Braintrust
removal, Acorn remains only through development ESLint's Espree/Acorn-JSX chain.
GitHub validation and successful stable publication remain the final delivery
steps after push.
