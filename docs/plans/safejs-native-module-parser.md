# Native SafeJS module parser

Replace the Acorn pass with the existing budgeted tokenizer and parser. Match
the configured Acorn ECMAScript 2025 module grammar, including import/export
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

- The installed Acorn 8.18.0 comparator and the native parser agree on syntax
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
- The working checkout has unrelated committed history and a substantially newer
  remote main. Rebase only the native-parser and necessary module-integration
  commits onto current remote main in a detached validation worktree; preserve
  the existing worktree and its unrelated changes.
