# `[[ … ]]`: source-bound design, not implementation acceptance

2026-08-29. No product, Bash oracle, compiler, installer, Worker, private engine,
or service was executed. All 40 proposed differential identities and 10 host
protocols are UNRUN. Existing surface-40 inputs are unchanged.

## Source authority

`BINDING.json` binds 38 inspected stored blobs selected from the 292-input Unit2
manifest SHA256 `75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2`.
Selected derived tree: `26215b99cb379a9f825f803454f758fab5a3c8e9`.
This is accepted public80 c83 plus accepted Unit1
`1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e` and **provisional** frozen Unit2
`928be5585f05c15867fbbb5f4b5debe153b0734e`, not live HEAD or Unit2 acceptance.
Unit1 root acceptance is `b0934e90c13f43c6a9b929e10c31388b2054036d`.
Computed composition identity is not a claim that this tree is a stored object.

GNU reference: official online Reference Manual Edition 5.3, updated May 18,
2025, inspected August 29, 2026. This identifies the documentation edition,
not the latest binary patch or the local Bash version. `REFERENCES.md` records
primary locators and separates normative rules from our proposed restrictions.

## Inspected implementation hooks

All line numbers below refer to the frozen blobs, not moving files.

| Frozen source / line | Fact and consequence |
| --- | --- |
| `src/shell/parser.ts:7`, `:14`, `:277` | Word parts retain quote bits, spelling, expansion nodes and array metadata. Preserve these; expanded argv is insufficient. |
| `src/shell/parser.ts:61`, `:697` | No conditional node; `[[`/`]]` explicitly refused. This requires grammar, not registering a command named `[[`. |
| `src/shell/parser.ts:127`, `:298` | Ordinary lexer treats `<`, `>`, parentheses and `&&`/`||` as shell operators. A conditional lexical context must disambiguate them. |
| `src/shell/parser.ts:600`, `:733` | Arithmetic has a dedicated parse route; compound commands already accept trailing ordered redirects. Reuse the latter. |
| `src/shell/parser.ts:694` | Function-body starters are enumerated. Supporting `f() [[ … ]]` requires an explicit addition, not incidental simple-command parsing. |
| `src/shell/index.ts:2` | `parseShell` is exported. An additive conditional AST node is observable in inferred public declarations even without a new root export. |
| `src/shell/display.ts:11`, `:29` | Compound display and redirect rendering are separate; add a conditional branch preserving syntax/quotes, never execute display text. |
| `src/shell/runtime.ts:3710`, `:3725`, `:3810` | `word(..., false)` avoids field splitting/path globbing; pattern mode preserves quoted glob literals. One evaluation per operand is essential. |
| `src/shell/runtime.ts:1533` | `case` demonstrates a bounded pattern-work counter with signal/yield checks. It is not a complete extglob or ERE implementation. |
| `src/shell/runtime.ts` command wrapper | Errexit eligibility currently lists simple/subshell/arithmetic kinds. Add conditional eligibility without rewriting existing ignore-errexit/pipeline rules. |
| `src/commands/predicates.ts:16`, `:27`, `:46`, `:88` | `test`/`[` use argv-count grammar, decimal BigInt, literal equality and already-expanded operands. Their later predicate closures cannot provide lazy shell expansion. |
| `src/commands/predicates.ts:50` | `-ef` compares inode/device without identityScope. Do not reuse this as cross-provider identity authority. No change to `test` is authorized here. |
| `src/contracts/filesystem.ts:3` | File/directory/symlink types and optional identity metadata do not establish tty/FIFO/socket/device/owner predicates. |
| `src/shell/pattern.ts:12`, `:69`, `:79` | Basic glob engine, constrained bracket RegExp, cooperative work checks; no extglob or locale collation. Some arrays allocate before per-character charging. Admit bounded strings first. |
| `src/shell/arithmetic.ts:37`, `:85`, `:134` | Existing numeric syntax includes octal/base notation, signed64 arithmetic, finite recursion/work. It is not `test`'s decimal-only parser. Arithmetic nounset/indexed reads remain separately unresolved. |
| `src/commands/regex-execution/protocol.ts`, `matching.ts:55`, `client.ts:28` | Existing bounded worker lifecycle is useful, but grep/rg adapters use JS matching; expr uses a separate BRE profile and only one capture. Neither supplies Bash POSIX ERE plus all captures. |

## Proposed implementation unit and write set

First unit: dedicated grammar and lazy scalar/basic-pattern/VFS evaluator.
Proposed production paths (NOT edited): `src/shell/parser.ts`,
`src/shell/runtime.ts`, `src/shell/display.ts`, new private
`src/shell/conditional.ts`. Existing pattern helper can be consumed read-only;
change `src/shell/pattern.ts` only under a separately enumerated need/review.
No commands/predicates, shared contracts, registry, package, default count, new
public limits or regex worker files in this first unit. Tests get a new author
scope only after GO. Shared regex work would require its own ownership grant.

Suggested AST: `Command.kind = "conditional"`, an expression tree, original
source/spelling for display, and the existing redirects/source-line envelope.
Expression nodes: unary, binary, nonempty, not, and, or; operands are original
`Word` nodes. Parentheses determine structure, not an eagerly evaluated list.
Conditional helper types may be imported type-only by parser/runtime; no new
callable public API. This **does** add one observable parseShell AST variant.

```text
or      := and ( '||' and )*
and     := not ( '&&' not )*
not     := '!' not | '(' or ')' | primary
primary := operand | unary operand | operand binary operand
```

This is precedence sketch, not a replacement lexer. Conditional operators are
recognized only in syntactically unquoted positions, not from expansion output.
It also is not an ordered-choice rule that always consumes a unary operator:
single-word forms such as `[[ -n ]]` need context-sensitive primary selection.
Bind these ambiguous arity cases with C05 before freezing a parser grammar;
do not inherit the separate `test` argument-count algorithm.
`-a` is the file-existence unary, `-o` an option unary: do not import `test`'s
binary `-a`/`-o` argument-count rules. Parse the complete supported syntax before
running it; evaluate only visited nodes, operands left to right once each.
`&&`/`||` must skip command substitution, variable lookup, filesystem access and
pattern compilation on the unused side. Parse-time malformed grammar still
fails independently of execution short circuit.

Lexer work must use existing quote/substitution scanning, not split strings or
search for the next `]]`. Recognize unquoted closing `]]` only in its grammar
position; quoted `"]]"` remains data. Inside the condition `<`/`>` are comparisons,
outside it redirects. Nested substitutions retain their own parser. Newline,
comment, escaped delimiter, and direct function-body cases require explicit
future cases; no claim the sketch resolves every Bash token ambiguity.
Extglob/ERE RHS parentheses need operator-aware scanning if later enabled.

## Finite proposed profile

### Low-risk first set (still needs runtime/oracle verification)

* Nonempty operand; `-n`, `-z`; parentheses, `!`, `&&`, `||`.
* `=`, `==`, `!=` with whole-string basic glob matching: `*`, `?`, validated
  literal/range brackets in the declared C profile. Quoted portions are literal.
  Quoted `*` and unquoted `*` are not interchangeable. Pattern variables must
  preserve whether their expansion was quoted.
* VFS `-e`/`-a`, `-f`, `-d`, `-s`, `-L`/`-h`, `-r`/`-w`/`-x`, using supplied FS,
  cwd and signal. Access reflects the adapter contract, not a remote OS DAC claim.
  `-nt`/`-ot` are possible follow-up leaf predicates with explicit missing-target
  rules; initially hold them rather than infer timestamp precision.
* `-v` scalar presence and existing canonical indexed-array element/aggregate
  presence, without dereferencing a missing value; restrict selectors to the
  accepted array grammar. No associative/nameref or new arithmetic selector API.
* `-o` only actual implemented shell options; no fabricated SHELLOPTS or version.
  Unknown-option false is a proposed policy pending oracle qualification.

Reuse `word(..., false)` for ordinary operands. Pattern expansion must return
both semantic value and quote-aware pattern/provenance in one pass if needed;
never expand a substitution twice. Existing `word(..., false, true)` is a useful
starting lane, not proof of full conditional array/quoted-empty semantics.
Do not call glob(), split on IFS, or retokenize expanded operators. Process
substitution is not implemented by the inspected Word model and stays unsupported.

### Root decisions before implementation

| ID | Recommended selection | Reason / held alternative |
| --- | --- | --- |
| D01 | Approve additive conditional AST + four paths above | Public parseShell declaration changes must be acknowledged; no broad AST redesign. |
| D02 | Basic glob subset initially; reached unquoted extglob, collating/equivalence classes or unsupported locale features explicitly refuse | GNU equality enables extglob regardless of shopt; silently treating these as literals/false would be a compatibility bug. Do not silently alter existing case matching. |
| D03 | Add `<`/`>` only under explicit C/POSIX collation with UTF-8 byte ordering; other locales refuse | Existing JS UTF16 order and host localeCompare are not GNU locale collation. Resolve LC_ALL, LC_COLLATE, LANG in that order; default C is our selected virtual profile, not host discovery. |
| D04 | Numeric six-operator initial subset: signed integer literals/base forms and empty-to-zero, using existing signed64 numeric parser; refuse names/operators/assignments | Full expression evaluation is GNU behavior but depends on unresolved Unit2 arithmetic nounset, recursion and array policy. Alternative: hold all six until that policy resolves. Do not use decimal-only test parser. |
| D05 | Recognize `=~` as a held feature with explicit refusal when reached; no worker acquisition/BASH_REMATCH publication yet | No current engine gives POSIX ERE/captures. Need separate bounded ERE dialect/protocol, quote-fragment mapping, global capture-array publication, configuration and cleanup ownership design. |
| D06 | Limit host-only predicates explicitly: hold `-ef`, ownership/device/tty/FIFO/socket/nameref and special `/dev/fd` emulation | Unknown identity must not become false proof or synthetic disjointness. Do not reinterpret Bash special descriptors as ordinary VFS files without a disclosed profile decision. |
| D07 | Existing source/expansion/output budgets plus private maximum 4096 expression nodes, nesting64; shared visited-pattern work from maxExpansionBytes | Numeric internal limits are proposed, not existing public caps. Admit before allocation; avoid resetting work per leaf. No new public Budget field. |
| D08 | True0/false1; unsupported reached profile status2 with one budgeted diagnostic, grammar ShellSyntaxError; no fatal reinterpretation of infrastructure failures | These diagnostic/status bytes are proposed product policy, not captured GNU goldens. Nounset follows frozen Unit2 logical-boundary control provisionally; wait for its acceptance. |

For D02/D05, parse valid-but-unsupported operators without executing/compiling
unused branches where lexical grammar can be represented faithfully. This does
not permit swallowing malformed syntax. If the first lexer cannot distinguish
unsupported RHS grammar safely, report that concrete blocker before claiming
lazy compatibility; do not scan runtime-expanded strings as shell grammar.
Quoted text that resembles extglob remains literal and must not be refused.
The proposed C comparison domain is valid Unicode scalar strings encoded as
UTF-8. Existing shell decoding/replacement behavior is not proof of arbitrary
non-UTF8 Bash byte-string parity; retain that separate restriction. Locale
selection must distinguish nonempty precedence values, not treat an empty
LC_ALL as an override of a nonempty LC_COLLATE.

## Control, resources and error obligations

Standalone false participates in existing errexit; if/while conditions, !,
and/or lists and pipeline stages retain existing exception/boundary semantics.
Do not rewrite errexit/pipefail, Unit1 ordered redirects, or Unit2 nounset.
Visited unset ordinary expansions can trigger Unit2 private fatal control;
unvisited operands cannot. `-v name` is presence inspection, not `$name` expansion.
Exact GNU line/status/diagnostic bytes and aggregate-array edge cases remain UNRUN.

Apply compound redirects once through the existing command wrapper, before
evaluating even a false condition. Preserve truncation/creation effects, writer
alias ownership and close-once rules. A predicate does not consume stdin or
write stdout. Required diagnostics use original caller stderr and existing
budget/escaping-error rules; no extra output-operation scope for an argv-only
condition. Caller reason, ShellLimitError, sink and cleanup failures must retain
their existing identities/priorities rather than be converted into false/2.

FS negatives need a finite reviewed errno mapping: existing test metadata treats
ENOENT/ENOTDIR/EACCES/ELOOP as absence, and access adds EPERM/EROFS. Reusing that
profile is a proposal, not normative proof. Unexpected provider failures must
follow existing shell error routing, never become a successful false predicate.
Follow links for normal metadata, lstat for -L/-h. No host filesystem or network.

Parse nodes charged/admitted before growth; depth64 mirrors existing parse
nesting, node4096 is new proposed private admission. Iterative logical traversal
or depth-safe structure avoids a long-chain JS stack overflow. Expanded strings
remain charged once by existing expansion machinery; quote masks/fragments also
need bounded ownership. Basic matching shares one work counter across visited
patterns, checks abort and yields on the existing 1024-step cadence. Input
admission precedes Array.from/token allocation. No hard RSS/preemption promise.
If a later regex phase acquires worker leases, register cooperative cleanup
before acquisition and await owned retirement; sibling sessions remain isolated.

## Future differential/host proposal — no execution grant

`CASES.json` holds exactly40 literal scripts and10 host protocols, zero filled
native goldens and zero outcomes. Scripts deliberately include held features;
these remain measured compatibility gaps, not filtered/skipped green rows.
All fixtures are synthetic under one owned root: ordinary/empty files, directory,
symlink/dangling symlink, explicit mode/mtime where capability qualified.
The eventual native runner must bind a real GNU5.3 binary and dependency/tool
profile, empty environment except fixed owned HOME/TMPDIR/PATH/locale, literal
`--noprofile --norc -c` scripts, no BASH_ENV/ENV, no network/private/user data.
Only builtins are needed for these scripts; paths are relative owned fixtures.
`-rwx` native provider observations are separate from virtual adapter assertions.

Capture status, stdout/stderr bytes, every file effect and cleanup before deriving
any expected output; do not normalize quoting, status, newline, messages or effects.
At most a separately recorded, predeclared owned-root path substitution may align
diagnostic roots; keep raw bytes. `set -e` termination cases execute in independent
instances. Malformed syntax records raw parse status/diagnostic, not a guessed2.

Suggested future bounded grant: 20min total including publication, <=96 ALL
processes peak3, case5s, 64MiB capture/256MiB scratch, stdout+stderr256KiB/case,
owned process cleanup5s. Forty native + forty virtual cases must be batched through
one authenticated virtual runner if used; host protocols are a separate <=10-case
in-process suite. Exact runtime/fence/child accounting and loader admission must
be presealed before execution. Safety/capture/integrity/retirement failure stops;
ordinary assertions aggregate only after safe cleanup. No implicit current GO.

## Release path

Ratify D01–D08 (especially partial pattern/numeric/regex policy), then author the
small separate grammar/evaluator with structural/safety tests. Independently
bind native observations before claiming GNU compatibility; a different reviewer
must exercise quote provenance, skipped side effects, redirects and budgets in
source and moved package. Pending regex/arithmetic/collation/descriptor rows stay
visible. Neither this design nor passing a finite profile means full Bash parity.
