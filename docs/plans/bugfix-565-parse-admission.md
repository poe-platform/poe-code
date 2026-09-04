# #565: cumulative shell parse-structure admission

## Scope and policy

Implementation baseline: `3ff5bba346c738a0d92f0fbd827ca4698ce2f818`.
The shell targets match the earlier read-only validation at `a6092b16a`.

Add `ShellLimits.maxParseUnits`: 262,144 by default and 65,536 in the
explicitly selected `cloudflareWorkerLimits` profile. These are approved
syntax-complexity policies, not estimates of heap bytes or guarantees against
isolate OOM. The reported 130x heap multiplier was not validated and does not
determine either default.

Use one cumulative internal `ParseBudget` for a root execution and all its
nested/runtime parses. The allowance is a nonnegative safe integer. Zero
rejects any parse, including empty source. Constructor limits and per-execution
overrides retain their existing precedence; executions do not share allowance.

Standalone `parseShell(source, depth, options)` adds a narrow optional
`ShellParseOptions` with only `maxParseUnits`. Existing one- and two-argument
calls remain valid. Standalone parsing still does not promise the execution
entry point's source-byte admission. Export the options type, not the ledger,
through the existing shell/root/browser exports; no new package subpath.

## Accounting

Admit before constructing each variable parse record, including attempted
construction that subsequently fails:

- Shell word/operator/end tokens and arithmetic tokens.
- Words, word parts, arithmetic nodes, arithmetic-program records, and
  shallow-copy replacements. A deferred arithmetic-error wrapper is a separate
  attempt from its failed tree-bearing wrapper.
- Scripts, commands, pipelines, and/or lists, conditionals, branches, clauses,
  parse-result/display records, and command diagnostic frames.
- Parser/lexer instances, redirects (including implicit `|&`), and heredoc
  descriptors; deferred heredoc words/parts use the same ledger when generated.
- Array indexes/selectors/assignments/entries, matched compound heads, and
  prefix-removal word/part copies.
- The owned byte-value wrapper and record created for invalid UTF-8 ANSI-C
  values, before entering the ownership constructor.

Fixed collection headers/reference entries are covered by their owner, not
charged again when the same object is pushed into another collection. Ordinary
literal characters and mutation of an already-coalesced text part cost no new
structural unit. Distinct quoted/unquoted runs, empty quote markers, and raw
byte identities retain their existing representation.

Do not refund consumed allowance for discarded tokens, failed syntax, or
incomplete-input retries. Reusing a prepared AST does not charge parsing again;
reparsing a variable or a substituted arithmetic program does.

Payload bytes, individual newline offsets, string slices/concatenations,
regex-engine internals, fixed helper machinery, and arithmetic evaluation
frames are not measurements in this ledger. Existing source/expansion and
execution limits remain independent. This is not a complete allocation census,
live-heap bound, or per-unit native CPU bound.

## Shared call graph and failures

`Budget.parsing` is passed through initial/subsequent shell input units,
backticks and `$()`, arrays, arithmetic syntax, deferred heredocs, `eval`,
source/dot, `sh -c`, script-file pre-parsing, and stdin/incomplete-unit parsing.
Runtime arithmetic shares it for `let`, integer `OPTIND`, substring
offset/length, positional rewriting, and arithmetic variable-value reparses.
Runtime indexed `unset` parsing also shares it and preserves limit failures.

The first quota failure is a terminal `ShellLimitError("maxParseUnits")`;
execution aborts its existing budget controller with that same object.
Already-observed cancellation is checked before admission. This synchronous
check cannot deliver queued abort events and does not claim preemption.
Syntax-only catches must neither defer nor translate a quota error into a
syntax status, incomplete-input result, failed substitution, or arithmetic
diagnostic. Earlier completed effects are not rolled back.

Keep the existing 64-level nesting guards, 4,096 conditional-node guard,
10,000 arithmetic evaluation-step guard, and source/expansion limits.
Issue #569's missing word/expansion recursion guards are separate work; this
quota is not a stack-overflow fix. Arithmetic suffix matching/tokenization is
unchanged.

## TDD and verification

Before production edits, bounded public-parser/runtime tests produced 24 real
missing-admission failures and one compatibility pass. A subsequent focused
ownership test failed before adding raw-byte ownership-record admission.

New maintained unit files:

- `packages/safe-bash/tests/shell/parse-budget.test.ts`
- `packages/safe-bash/tests/shell/parse-admission.test.ts`
- `packages/safe-bash/tests/shell/arithmetic-admission.test.ts`
- `packages/safe-bash/tests/shell/parse-admission-runtime.test.ts`

Cover inclusive exact counts, terminal error identity, rejected integer
conversion, shared nested and runtime parses, incomplete-attempt charging,
heredoc chunk/word admission, literal coalescing, raw bytes, invocation abort
identity, override isolation, and existing syntax/expansion behavior. Fixtures
use in-memory VFS and bounded generated inputs, not actual OOM/heap/RSS stress.

Keep the existing 100,000-semicolon line-index regression and its timing
assertion unchanged, supplying an explicit 2,000,000-unit allowance so it tests
line indexing rather than default admission.

Register the four unit files by exact literal path in
`packages/safe-bash/scripts/integration-inputs.test.mjs`. Add the strict
`current-shell-parse-limits.mts` consumer and its emitted runtime to the
maintained consumer registry; change the independent exact consumer inventory
from 36 to 37 and assert the new literal member. Do not derive expected counts
from the registry. Preserve all historical seals.

Add the browser admission check in `scripts/bundle-safe-bash.test.ts` but leave
its build-dependent execution to root. The public consumer uses `virtual-bash`
and the existing filesystem peer, not an assumption that an independently
installed peer already contains this shell change.

Local verification uses Node 22 from `/tmp/kamilio-toolchain.path`, private
TMPDIR from `/tmp/kamilio-561-562-tmp.path`, `TSX_DISABLE_CACHE=1`, no `NO_COLOR`,
and cleared Git-local variables in unit children. Run focused unit/registration
and shell compatibility tests, package-local no-emit types, and a source-mapped
strict consumer type check. The latter is not built/packed consumer evidence.
The package's known 24 baseline type diagnostics are outside this change.

Logs and the final explicit-file SHA-256 manifest are retained beneath the
private TMPDIR's `issue-565` directory and reported in the handoff. Root owns
review, browser/public-consumer builds, full gates, commits, pushes, and release
monitoring. No README edits are authorized.
