# INITIAL restricted expr: source-bound review handoff

August 27, 2026. Actual delegated leaf, working directly without redelegation.
Only this new evidence directory is owned. Source, old tests/evidence, package,
exports and root files are read-only. This is a source/docs-only consolidation:
**no build, product/test/native execution, new corpus, or normative re-research**.

Accepted product: `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`, including quota
ancestor `c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`. All source line references
below refer to that exact accepted commit, not concurrent HEAD or working files.
`MANIFEST.json` binds source and reused evidence by full commit, Git blob, SHA-256,
byte count and line count; it also identifies the historical packed artifact.

**Root/public expr remains HOLD.** There is no unresolved demonstrated core
defect in the scoped accepted proof. That is not proof of bug absence, a clean
all-assertions gate, universal parity, superiority, or full completion. The
separate exact-sink-assertion migration review is pending; see `PENDING.md`.
No genuine core defect was discovered in this source audit, so no issue receipt
was written. Historical red expectations remain red in their original records.

## Physical-module API, not a public export

`src/commands/expr/index.ts:8` exports exactly these named values and types:

```ts
createExprCommand(options?: ExprCommandsOptions): CommandDefinition
createExprCommands(options?: ExprCommandsOptions): readonly CommandDefinition[]
exprCommands(options?: ExprCommandsOptions): VirtualShellPlugin
type ExprCommandsOptions
type ExprLimits
```

All three factories default options to `{}`. The single definition is named
`expr`; the plural returns a one-element array. Plugin name is `expr-commands`.
Setup preflights an existing `expr` and throws unless `replace` is true, then
registers with `replace: options.replace ?? false` (`index.ts:75`). `replace`
does not change expression semantics. There is no default export here.

`src/commands/expr/internal.ts:5` defines readonly numeric fields listed below;
`ExprCommandsOptions` has readonly `replace?: boolean`,
`limits?: Partial<ExprLimits>`, and `regex?: RegexExecutionOptions`. The last
type comes through the shared client from its protocol, not a third type export
from the expr entry. Its eight readonly optional numeric fields are also below.

Physical build entry: `dist/commands/expr/index.js`, with declarations. The
accepted `package.json:12` has no expr subpath; `src/index.ts:1` and
`src/plugins/index.ts:51` do not export/register this family. Do not advertise
`import ... from 'virtual-bash'`, `virtual-bash/commands/expr`, or default agent
availability for it. Package identity remains `virtual-bash@0.0.0`, private,
ESM, Node >=22, no runtime dependency entries (`package.json:1`). No product
subprocess, implicit host FS, eval, ambient locale lookup, or main-thread
untrusted regex is introduced. Loading the explicitly shipped worker module is
not an expr filesystem capability; direct execution does not consume stdin.

## Grammar, values, ordering and status

`src/commands/expr/syntax.ts:8`: one argv element per token; increasing binary
precedence is `|`, `&`, `< <= = == != >= >`, `+ -`, `* / %`, `:`. Every binary
level is left-associative. Prefixes are `length STRING`, `index STRING CHARS`,
`substr STRING POS LENGTH`, `match STRING REGEXP`; their arguments recursively
accept prefixes/primaries, not unparenthesized lower-precedence expressions.
Primaries include `( EXPRESSION )` and `+ TOKEN`. Forced literal consumes exactly
one token, even a keyword or parenthesis; it does not prevent later numeric
coercion. Bare `)` is invalid; other operator-looking operands can be literals.
An initial `--` is removed once. Only sole `--help`/`--version` is informational;
unknown option-looking strings are operands (`src/commands/expr/index.ts:21`).

`src/commands/expr/evaluate.ts:20`: empty bytes and optionally-minus-prefixed
all-zero bytes are false; `+0`, lone `-`, and other nonempty nonzero strings are
true. `|` selects the first true value or integer zero; `&` retains the left
value only if both are true, otherwise integer zero (`syntax.ts:98`). Integer
syntax is ASCII decimal digits with optional minus, no plus or whitespace.
Raw literal spelling survives until coercion. Arithmetic uses bounded BigInt,
division truncates toward zero and remainder follows the dividend's sign.
Noninteger arithmetic and zero divisors are status 2. Comparisons are numeric
only when both operands have integer syntax, otherwise byte-lexicographic under
the admitted collation. Numeric comparisons yield integer 0/1.

`src/commands/expr/evaluate.ts:94`: length counts selected character units;
index returns the one-based first subject position in the character set, else
zero. Substr is one-based; nonnumeric/nonpositive position or length, or a
position beyond the subject, produces empty bytes. Valid large lengths clamp
after numeric/work checks. Raw numeric digits need not fit the numeric limit
when merely retained as strings/truth-tested; actual coercion/result generation
does. No fixed 32/64-bit range is promised. GNU overflow behavior is a separate
dialect boundary, not automatically reproduced by bounded BigInt.

`src/commands/expr/syntax.ts:14`: a single token cursor, one invocation Budget
and one Matcher callback perform awaited reductions at encounter time. Required
RHS/prefix operands finish before their enclosing reduction. Active regex jobs
are submitted/awaited once in encounter order; no reparse, AST replay, speculative
matcher jobs, budget reset, or second evaluation pass. Earlier active failures
can precede later missing-close/trailing errors. Inactive frames still enforce
syntax, arity, structural node/depth and work checks, but have no Value: no
operand encoding, numeric conversion, locale operation, prefix reduction or
worker compilation/submission. Global argv validation and diagnostic quoting
still operate, and structural objects allocate. This is not zero-allocation or
zero-work skipping. Suppressing skipped string prefixes is explicit project
policy, not universal GNU short-circuit equivalence.

`src/commands/expr/index.ts:47`: evaluation writes exact result bytes plus LF;
status 0 means true, 1 false, 2 syntax/argv/profile/operand failure, and 3 logical
resource/worker/execution failure. Sole help/version is status 0. Sink failure
and cancellation reject rather than being converted into status 3; quota can
replace an otherwise status-2 diagnostic with the fixed status-3 emergency.

## Encoding and locale admission

`src/commands/expr/internal.ts:74`: preflight rejects NUL and unpaired UTF-16
surrogates (status 2) and encodes valid argv as UTF-8. Values/results remain
Uint8Array; byte-profile slicing/capture can split UTF-8 without replacement.

`src/commands/expr/internal.ts:99`: each category independently selects first
nonempty `LC_ALL`, category (`LC_CTYPE` or `LC_COLLATE`), `LANG`, then virtual
`C`. Empty falls through; whitespace/case/modifier variants do not normalize.

- CTYPE accepts exactly `C`, `POSIX` (byte units), `C.UTF-8`, `C.utf8`, and
  `en_US.UTF-8` (Unicode scalar encoding, not graphemes or named-locale rules).
- COLLATE accepts exactly `C`, `POSIX`, `C.UTF-8`, `C.utf8`, all byte collation.
  Unsupported named collation refuses even ASCII string equality; numeric
  comparison does not consult it. Character operations consult CTYPE only when
  executed. Arithmetic/literals do not reject irrelevant locale categories.
- Regex bracket admission requires BOTH categories in the four baseline names.
  Otherwise any unescaped `[` is refused, including literal/negated lists,
  not just classes/ranges. Escaped `\[` remains eligible. Pattern/subject caps
  precede this scan, and the complete pattern byte length is charged before
  scanning (`internal.ts:120`). CTYPE must still admit the encoding profile.
- String scanning preserves BOM and counts combining marks separately without
  normalization; malformed intermediate bytes advance individually
  (`internal.ts:137`). Scalar regex instead rejects malformed UTF-8, preserving
  BOM (`src/commands/expr/bre-worker.ts:252`).

The prior README/native evidence explicitly does not qualify `C.utf8` as scalar
on its pinned Darwin GNU host (which fell back to bytes). `en_US.UTF-8` encoding
acceptance is not named-locale ctype/collation support. GNU/Darwin, Apple/Darwin,
public libc probes, and GNU/Linux are not interchangeable profiles.

## Complete configured limits and fixed bounds

`src/commands/expr/internal.ts:30`: every ExprLimits field is a positive safe
integer. Except for listed stricter ceilings, the only configured upper bound
is `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991), not a promise that huge
policies can execute safely. Factory validation throws RangeError. Policies
are trusted host choices; family budgets do not replace shared Shell budgets.

| ExprLimits field | Default | Additional ceiling and actual unit/admission |
| --- | ---: | --- |
| maxArgumentBytes | 65,536 | Sum of UTF-8 argv bytes before encoding; UTF-16 length is an early lower-bound check; all args, even inactive ones |
| maxNumericDigits | 1,024 | Decimal input digits excluding minus, before BigInt; generated/arithmetic result digits; leading zero digits count |
| maxNodes | 4,096 | Structural literal/prefix/binary node count, including inactive frames; argv count also <= 4 * maxNodes |
| maxDepth | 128 | Hard 256; both parser recursion and structural expression depth, including left-deep flat chains |
| maxSteps | 8,000,000 | Cumulative invocation logical work including parse/evaluation/allocation and successful worker steps; not milliseconds |
| maxStringBytes | 65,536 | Per checked byte allocation, including encoded literals/diagnostic tokens, copied substr/capture and conservative arithmetic render capacity |
| maxOutputBytes | 65,537 | Ordinary output admission in bytes, stdout including LF and normal stderr including prefix/LF; fixed emergency exception below |
| maxRegexPatternBytes | 8,192 | Hard 65,536 pattern bytes, before worker admission |
| maxRegexNodes | 4,096 | Hard 8,192 combined BRE tree nodes and emitted instructions, not independent allowances |
| maxRegexDepth | 64 | Hard 128 group nesting; worker parse starts at zero |
| maxRegexStates | 16,384 | Hard 65,536 cumulative initial/fork search states, not only simultaneously live states |
| maxRegexAllocatedUnits | 1,000,000 | Hard 4,000,000 cumulative logical worker allocation units, not bytes or RSS |

`src/commands/expr/index.ts:28`, `src/commands/regex-execution/protocol.ts:68`:
each worker receives `maxSubjectBytes = min(maxStringBytes, 1,048,576)` and
`maxSteps = min(remaining invocation work, 50,000,000)`; fewer than one remaining
unit refuses before submission. Worker-reported steps charge the SAME Budget.
No separate configurable expr maxRegexSteps/maxRegexSubjectBytes exists.

`src/commands/expr/internal.ts:49`, `src/commands/expr/evaluate.ts:41`: allocation
checks also charge bytes; numeric parsing charges input byte length squared;
arithmetic charges the product of operand representation lengths (including
minus when present) and conservatively reserves multiplication sum-length, or
other-operator max-length+1, plus another byte before computation. Result digits
are checked after computation. Work or conservative allocation may refuse first
even if final text fits. Checkpoints yield only when called and >=4,096 charged
units elapsed since the previous yield; this is not per-iteration scheduling.

`src/commands/regex-execution/protocol.ts:1` and `client.ts:167`:

| RegexExecutionOptions field | Default | Unit and admission |
| --- | ---: | --- |
| requestTimeoutMs | 1,000 | Active dispatch through reply validation; queue/startup/output waits excluded |
| startupTimeoutMs | 3,000 | New worker ready-exchange timeout, separate from request timeout |
| maxWorkers | 2 | Per definition's executor, including retiring slots until retirement releases them |
| maxQueuedRequests | 64 | Waiting FIFO entries; zero allows immediate admission only |
| maxQueuedBytes | 134,217,728 | Waiting expr accounting: 256 + pattern byte length + subject byte length per request |
| idleTimeoutMs | 100 | Cached unused-worker retirement delay; session cleanup may retire earlier |
| workerOldGenerationMb | 128 | Requested Node/V8 old-generation resource limit in Mb |
| workerStackMb | 4 | Requested Node/V8 worker stack resource limit in Mb |

All eight are safe integers; only queue count/bytes may be zero, others >=1.
The three millisecond timers have hard ceiling 2,147,483,647; no other stricter
numeric policy ceiling is coded. Available immediate slots bypass waiting
count/byte caps, but not expr input limits. Owned pattern/row copies follow
admission. The legacy descriptor formula (128 + UTF-16 pattern accounting + row
overhead) is NOT expr's formula. Neither queue accounting, logical allocations,
V8 resourceLimits, nor timers guarantee total heap/RSS or real-time settlement.

Other fixed bounds: at most 32 capture groups; references only 1–9 to already
closed groups; interval decimal fields at most five digits and value 32,767;
class-name scanning checks a 16-UTF-16-unit prefix bound and then the fixed name
allowlist (`bre-worker.ts:81`, `:100`, `:123`). Protocol accepts exactly one
subject row, positive-safe request identity, checked byte spans, and error text
at most 512 UTF-16 code units (`protocol.ts:99`, `:117`, `:124`). Worker node
creation charges eight allocation units, initial/fork states and copied history
are cumulatively charged, and exhaustion errors rather than returning a partial
best match (`bre-worker.ts:13`, `:272`). These are implementation units, not a
portable operation-count or physical-memory contract.

## Safe BRE forms and exact current refusal

`src/commands/expr/bre-worker.ts:42`: admitted forms include literals, dot
(including newline), contextual `^` at branch start and `$` at branch/group/end
boundary (not per-line anchors), bracket lists/negation and ASCII ranges,
escaped groups, closed-group backreferences 1–9, `*`, GNU-style `\+`, `\?`,
`\|`, and `\{m\}`, `\{m,n\}`, `\{m,\}`. Leading unescaped `*` can be a
literal. Named classes are exactly alnum, alpha, blank, cntrl, digit, graph,
lower, print, punct, space, upper, xdigit, using ASCII membership. Descending
ASCII range pairs are admitted but contain no values; no universal BRE claim.

Explicit status-2 syntax/unsupported refusals include malformed groups/brackets/
intervals/references, leading escaped repetitions, repeated anchors, stacked
repetitions, alphabetic/word/buffer escapes (including `\0`), collating symbols,
equivalence classes, class range endpoints, non-ASCII range endpoints, and
named classes with any non-ASCII scalar subject. Locale screening above also
refuses all unescaped bracket lists outside the baseline pair. Unsupported
does not mean the syntax is invalid in every native dialect.

**Nullable-backreference guard, precisely** (`bre-worker.ts:161`): traverse the
whole parsed tree, collecting every referenced group. Propagate a flag into
each repeat child iff already flagged OR
`repeat.maximum > 1 && nullable(repeat.child)`. Mark each group encountered
under that flag. Refuse iff a referenced group is in that marked set. Nullability
treats anchors and backreferences conservatively as nullable, recurses through
groups, accepts repeats with minimum zero or nullable child, requires every
sequence child, and accepts any alternative child. The exact worker message is
`unsupported BRE: backreference to a capture in nullable repetition`;
ordinary command stderr adds `expr: ` and LF, with status 2 unless quota intervenes.

This is NOT a refusal of all nullable captures. Source-derived examples (not
new executed cases): `\(a*\)\1`, `\(a*\)\?\1`, `\(a*\)\{1\}\1`,
and `\(a\)*\1` are not rejected by this guard; `\(a*\)*\1` is. A nullable
capture without a reference does not alone trigger it. Maximum-one repeats
can still be inside a different flagged ancestor. Passing the guard promises
neither a match nor universal nested/repeated-capture compatibility.

`bre-worker.ts:272`: anchored start-zero DFS tracks the longest whole match;
equal whole extent retains the first greedy/ordered completed path. This is not
a universal POSIX subexpression comparator. Only syntactically first capture
determines expr's value. Without captures return whole matched character count,
or zero; with captures return first capture bytes, or empty for no match/absent
first capture. Participating empty is distinct from absent in the protocol.
Transport offsets are half-open ORIGINAL BYTE offsets, not UTF-16/scalar indices.
Scalar matching maps boundaries back to bytes; main thread validates shape,
bounds and scalar boundaries. Pattern compilation still runs for empty subject.

## Worker lifetime, quota and rejection identity

`src/commands/expr/bre-worker.ts:273` refuses main-thread entry. Shared
`regex-execution/worker.ts:11` dispatches expr separately from legacy matching.
The client lazily acquires workers, copying admitted input, and validates reply
identity/operation/steps/spans. Queue cancellation removes its own entry; active
cancellation/errors/timeouts retire the slot and await termination before request
settlement (`client.ts:167`, `:223`). Worker timeout is not a Shell deadline.

`src/commands/regex-execution/client.ts:28`, `:264`: cleanup registers
synchronously before session acquisition; registration failure prevents admission.
The same idempotent close is awaited from finally, closes admission, cancels that
session, drains admitted requests/retirements, and preserves sibling sessions.
Direct contexts may omit the hook; finally remains. Caller cancellation reason
has precedence, including falsy/errno-shaped reasons; an existing rejection
survives a separate cleanup failure, while cleanup failure after otherwise
successful execution rejects. No forced preemption of opaque host work follows.

`src/commands/expr/index.ts:49`: ordinary stdout and diagnostic admission checks
include LF/prefix before their byte encoding/output allocation. Normal stderr
uses UTF-16 length+7 then UTF-8 byte length+7 checks. If ordinary diagnostic
admission fails, at most one exact **34-byte** emergency is written:
`expr: output bytes limit exceeded\n`, status 3. It is the only fixed exception,
not a reusable allowance for arbitrary same-sized diagnostics. This policy is
**ordinary quota plus one fixed emergency, NOT an absolute combined stdout/stderr
cap**. No stdout write is attempted when result admission fails.

Stdout is outside the evaluation catch; ordinary/emergency stderr writes also
escape it. A failed sink is not retried, recast, or followed by fallback stderr.
`src/contracts/io.ts:140`, `:181` await the supplied sink with the supplied signal,
retaining exact sink/caller reasons and observing late promise rejection. No
opaque sink identity wrapper or destination ownership enrollment is added.
Already-completed effects cannot be undone; cleanup waits cooperative owned
worker work, not arbitrary uncooperative sink completion after cancellation.

## Reused evidence and exact package identity

`MANIFEST.json` gives immutable full locators for these short labels. Counts are
reported separately, not added or inflated by replay, subset, author overlap,
model checking, or historical native observations.

| Evidence | What it establishes, with limits |
| --- | --- |
| Author `2dd1ca10` | Exact c3 encounter source/quota ancestry, once-only reductions and frozen source delta; author evidence, not independent acceptance |
| Independent `beba7b00` | c3 original61 **61/61**, comprising GNU44 **44/44** and project17 **17/17**; all original19 encounter failures close; Shell5 repeats existing inputs |
| Same review, preserved reds | Nearby **15/16**, old quota **46/47**, source legacy **236/237**, old installed core **145/146** retain stdout-recasting expectations; old-cap separate **0/1** remains historical |
| Same review, separate acceptance | Corrected quota21 **21/21**, additional source **338/338**, moved physical smoke **19/19**; no blanket full-source/native gate |
| Quota `5e8aaf6b` | c25 independently twice: original47 **46/47**, versioned21 **21/21**, quota boundaries, awaited sinks/cleanup and falsy exact identities; c3 separately replays these controls |
| Shared correction `3ad8f4d5` | Exact c3 same eleven files **276/276**, zero fail/skip/cancel/TODO, after frozen outside-Git TMPDIR/source relocation; original beba **275/276** preserved, not rescored |
| Historical `cf5caabe` | Different 4f source: named policy10 **10/10 direct + 10/10 Shell**, actual GNU named **9/10 strict**, encoding/admission evidence with original failures; not c3 native recertification |
| Historical `8897ece3`, `954ddde4`, `b6eaa23a` | Narrow semantic judgment and isolated experimental repeat history; no production worker overlay, promotion or new denominator |

Shared correction discloses identical executable/argv, physical TMPDIR outside
all Git ancestors, relocated build cwd, and inability to reconstruct historical
ambient environment equality. Its 276 names include 86 native-rg differential
tests. All 349 selected candidate source/test/root files and the entire 828-file
compiled build match the prior review; this is not a new expr-native run.

The **beba primary** source selection archive hash is
`c29675ec05c0697b3d56b13a0fad075bd148df6b0c3a91e597f628a21cee0fa7`.
Its independently built/offline-packed `virtual-bash-0.0.0.tgz` SHA-256 is
`8331e853455f295dfda24ff53d612514212067ca2075df09e8b60339bda58a5e`:
701,500 compressed bytes, 3,918,496 unpacked bytes, 829 package file entries.
The compiled inventory has 828 files / 868 entries (root excluded); installed
inventory has 829 files / 870 entries (including dist root and package.json).
After prefix normalization installed dist exactly equals built output. Complete
before/after entry sets detect additions/removals as well as byte changes.

Offline pack/install used separate initially empty caches; the consumer was
physically renamed before execution, with no installed source or runtime deps.
The 19/19 smoke enforces installed physical imports/Node builtins and the installed
`dist/commands/regex-execution/worker.js` URL, excludes caller-thread matcher
imports, and reports zero active workers/unhandled rejections. Static worker
closure is worker.js -> matching.js, ../expr/bre-worker.js, protocol.js (plus Node
builtins); exact emitted hashes, declaration hashes and full-inventory receipt
hashes are in the manifest. The separate old-core moved artifact is not silently
substituted for this primary tarball. Historical temporary installs/tarballs were
cleaned; this audit authenticates committed receipts, not a newly rebuilt tarball.
This proves that physical-module artifact, NOT root/subpath/default availability.

## Known limits and TEMP-only history plan

Keep diagnostics, overflow, short-circuit and locale dialect qualifications.
The c3 review did not execute its four native-dependent expr tests or maintained
repeat-history invariants; scoped typechecking is not their runtime acceptance.
No fresh native availability, Linux, full canonical/repository gate, public API
release, service interoperability, performance, superiority or 72-hour claim.

The accepted module README is stale at `src/commands/expr/README.md:35` (moved
proof pending), `:49` (matching pending), `:74` (parse-all-first/active skipped
prefixes), and `:188` (synchronous parser and unrestricted diagnostics). Source
and the later bound evidence above supersede those historical statements. The
README remains untouched here; its broad nullable wording at `:238` must be read
with the exact guard above. Documentation drift is not a new core-engine defect.

TEMP history work remains a plan/isolated experiment, not this product profile:

- Include **uncaptured quantified prefixes** in any future history design;
  final capture registers alone do not describe the whole candidate history.
- Do **not promote first-completed DFS** to a general POSIX/GNU comparator.
  The isolated P/aaaa versus P/aaa witnesses do not determine every tie.
- Preserve required empty occurrences and **activation-local** empty/progress
  distinctions; global “input advanced” is not a valid substitute for repeat
  activation identity, finite required counts and present/open/completed capture.
- Declare retained completed descendants **experimental**, distinct from clearing
  at parent re-entry; recorded absence alone does not implement clearing.
- Any future history comparisons/storage need bounded work/allocation and the
  existing worker/cancellation/refusal contracts. No guard removal is authorized.

`8897ece3` supplies the narrow judgment; `954ddde4` and `b6eaa23a:145` explicitly
withhold general promotion. The isolated adopted P/aaa completed `a` is NOT the
accepted worker's behavior: c3 still refuses that guarded form. GNU's differing
tuple is preserved, not labeled an upstream-confirmed bug. No new universal
comparator or native conclusion is inferred here.

Read-only handoff verification (Git/data hashes and metadata only):
`node tests/commands/expr-stress/initial-profile-handoff-20260827/verify.mjs`.
It never imports product code or executes a test/native corpus. Its owned-file
entry check is append-aware; source bindings cover listed committed paths and
existing full-inventory receipts, not an append-proof live repository.
