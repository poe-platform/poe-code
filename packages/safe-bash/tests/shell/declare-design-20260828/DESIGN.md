# Bounded declare/typeset — design only, 2026-08-28

**Disposition: PROPOSED; no implementation, execution, acceptance or rescore.**
Ownership is only this directory's documentation/data. Applicable live parent
and repository AGENTS were read; no tests/shell ancestor or nested AGENTS was
found, and this directory did not exist before this work. The initial index was
empty; foreign artifacts/staging are preserved. The CLI-owned `-o` path is not ours.

## Binding and evidence classes

The indexed-array foundation is **FROZEN and UNACCEPTED under Plato review**:
product `c7dae6e884d1a144266dfc1bb80785bf007a667f`, source/tests
`50117fc54fdfd650e8f57e84b82ba21297ab8a0f`, selected source identity
`d6c17f62d2d3062b5ab074044a86b8a455820373`. That identity is a computed projection,
not an available loose Git tree; attempting a tree lookup did not resolve it.
It derives from accepted DOTGLOB `37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e`
plus owned overlays, **not accepted moving HEAD**. Its complete projection was
not reconstructed here. Exact inspected source bindings are in SOURCES.md.
Author `38b2318d` FOUNDATION-HANDOFF/FOUNDATION-AUDIT and map `d8ac8c2e`
PRIVATE-REVIEW-BINDINGS remain author evidence, not independent certification.

Evidence labels throughout: **O** official GNU documentation; **C** static
candidate inference; **P** project proposal requiring root disposition; **H**
historical native observation. SOURCES.md separates them and records official
GNU reference **Edition 5.3, 18 May 2025**, accessed **2026-08-28**. No GNU source
implementation was copied. MATRIX.md has 40 design rows, not passes.

## Root decisions and staged recommendation (P)

1. After independent foundation disposition and a **different explicit freeze**,
   authorize internal declaration membership, formatting and genuine runtime
   dispatch. Neither builtin is a registered/default plugin command. Preserve
   registry/default counts; runtime `type`/`command` must discover both as real
   builtins, with normal function shadowing and `command` bypass. Do not mark
   them special builtins. Share a real implementation, not an alias expansion.
2. Ratify the finite grammar below, typed-local continuity with the candidate,
   and strict refusals instead of pretending full GNU declaration compatibility.
3. Ratify the explicit preparation/publication phases below. Compound syntax is
   a second integration stage, **not completed by scalar-only stage one**. It
   needs exact parser/runtime/private-array write authorization; do not amend
   the frozen foundation while its independent review is pending.
4. Ratify lossless declaration output only on the representable string subset,
   with explicit rejection of NUL/lone-surrogate output. No byte-array variable
   model or public limit/API is proposed. Existing expansion/control behavior
   and all seven private formulas remain unchanged.
5. Optionally authorize PRESEAL's eight native observations only after separate
   supervisor review/freeze/ROOT GO. They answer GNU edge questions; they cannot
   ratify project policy or certify the foundation. No open-ended follow-on loop.

Stage one includes real scalar/empty-indexed declarations, attributes, listing,
membership, scope/copy/cleanup and literal-argv invocation. Stage two includes
source compound/element declaration operands and integration proof of the whole
profile. Neither stage is authorized for implementation by this document.

## Exact finite grammar (P)

`declare` and `typeset` have identical semantics and diagnostics identifying the
invoked name. Names are ASCII `[A-Za-z_][A-Za-z_0-9]*`; values are existing JS
strings. Parse leading option tokens until the first operand or exact `--`.
After that, every token is an operand, even `-x` or `--`. A lone `-` or `+` is
an invalid option (2) before the operand boundary; an invalid identifier (1)
after it. No long options, help/version side route, or option arguments.

| Form | Exact behavior |
| --- | --- |
| `-a`, `-r`, `-x`, `-p` | Indexed kind, readonly, export, display respectively. Any negative cluster of these letters is accepted; order-independent except the export sign described next. |
| repeated letters/tokens | Idempotent supported operations, not acceptance of unimplemented flags. `-aa -rr -pp` is valid. |
| `+x` (one or more x letters) | Remove export on scalar mutation operands; the last signed x wins across tokens (`-x +x` clears, `+x -x` sets). |
| `+a`, `+r`, `+p`, other positive clusters | Unsupported option, 2, even when GNU might allow a conditional no-op. No array-to-scalar conversion or readonly removal. |
| `-A -n -i -l -u -f -F -g -G -I -t`, unknown letters | Unsupported option, 2; first offending token/letter in argument order. No successful stub flags. |
| no operands, no `-p` | Same deterministic declaration listing as `-p`; negative a/r/x filter the visible variable set by intersection. No functions. |
| `-p` without operands | Same intersection filters. Empty match is empty stdout/status0. Positive x tokens with any listing form are usage2. |
| `-p name ...` | Names only, requested order, duplicates printed repeatedly; missing name is diagnostic1, remaining names still processed. Any a/r/x option with named `-p` is usage2 rather than ignored. `name=value` and subscripts are invalid identifiers1; no assignment is performed. |
| mutation operands | `name`, `name=value`, `name+=value`, literal-index `name[index]=value`/`name[index]+=value`; plus source-recognized `name=(...)`/`name+=(...)`. Compound/element operands imply indexed kind without requiring `-a`. |

Scalar assignment RHS retains declaration-context no splitting/globbing. An
already-expanded literal argv `name=value` is data, never reparsed as shell code.
Thus invoke with `a=(x)` assigns the scalar string `(x)` (or element zero with
`-a`); only parser-authenticated source nodes denote compound syntax. A
literal-argv element assignment parses only its name/index delimiter and takes
the remainder as already-expanded string data; it never evaluates subscript
expressions or RHS shell syntax. A bare
subscript operand without `=` is unsupported2, not GNU's ignored subscript.
Canonical decimal indices 0..2147483647 and existing quoted-literal subscript
forms follow arrays/syntax.ts; negative/arithmetic/noncanonical forms are
syntax2 for source nodes, unsupported2 for literal argv. Domain overflow is1.
No nested compounds or associative entries. Duplicate mutation target names
are allowed for scalar-only commands; commands containing any compound/element
operand reject duplicate targets as usage2 before compound RHS work. This
finite restriction avoids silently rebasing prepared target identities.

`-a` on missing scalar creates an empty indexed binding; on an ordinary set
scalar preserves its value at zero; on an indexed binding preserves members.
`-a a=value` replaces zero only. Bare `a=value`/`a+=value` on an indexed binding
also writes/appends zero only; it must not stringify or erase other members.
Compound `=` replaces the target; compound `+=` appends using existing maximum
and cursor rules. `-r` freezes the **whole binding after successful value
publication**, including empty arrays. Re-declaring readonly without a value
or kind change is idempotent; any write/kind conversion still fails1.

`-x` exports scalars; `+x` removes their export even if readonly (no value write).
Any export-attribute operation on an indexed binding fails1, including `+x`:
this profile does not invent an array export representation. Indexed creation
with final `-x` fails1; conversion of an already-exported scalar fails1 even
with same-command `+x`. First clear export in a separate scalar declaration.
The exact control set PATH/PWD/OLDPWD/HOME/CDPATH/IFS/OPTIND/OPTERR/OPTARG/REPLY/
LANG/LC_ALL/LC_CTYPE cannot become indexed. Scalar writes retain existing control
semantics (notably OPTIND's candidate-specific integer/getopts handling), not
new general integer attributes. DIRSTACK remains ordinary storage.

## State, local, copy and listing (C -> P)

Candidate scalars are a string record plus export/readonly sets; an ordinary
declared-but-unset scalar currently has no durable membership bit. Introduce an
**internal** optional `declaredScalars` set on State, not an undefined string
property or empty-value surrogate. Visible scalar membership is the union of
own value keys, this set, and scalar attribute names. Array kind wins over any
scalar bookkeeping. Empty string, missing scalar value, missing element zero,
empty indexed binding and absent name remain distinct. Whole unset removes
membership and attributes; element/member unset preserves array kind.

All new declaration work activates the existing session ledger, including
scalar listing. Enroll membership as a named monitored collection; include it
in clone/snapshot/prepaid saves/restores/temporary overlays and process-state
initialization. No per-declaration ledger or reset. An unset local retains its
local frame's missing declaration until return; it does not reveal the parent.
This requires narrow hooks in existing unset/local paths, not just a new file.

Top-level declaration mutates this exec's state, not a persistent shell store.
In a function it saves once in the current locals frame, shadows dynamically,
and restores exact kind/presence/value/attributes on every exit path. Inherit
the candidate's **typed local** policy: shadowing an indexed parent creates a
fresh empty indexed local; a scalar initializer fills zero. A scalar parent
gets an unset scalar local unless initialized; existing export visibility is
retained unless `+x`. Readonly parents refuse shadowing. Repeated declarations
within the same frame modify the local without saving it twice. No `-I`/`-g`.
This intentionally differs from H N05's GNU scalar shadow of an outer array.

`source`/`.` executes in the current state/function frame: at top level changes
persist within that exec, inside a function they restore when that function
returns, not when source returns. Existing source positional/depth restoration
is unchanged. Subshells, substitution and pipeline clones isolate mutations
while sharing the invocation ledger. New process/interpreter/scriptFile state
contains only the existing exported scalar environment, not array bindings or
readonly/declaration attributes. No ambient host-variable import.

`context.invoke` remains literal argv: clone first; clear function/source/local
frames as currently; preserve parent; explicit scalar env shadows a same-name
typed child binding only, subject to readonly collisions. `replaceEnv:true`
uses exactly supplied exported keys (omitted map means empty); it neither
promotes locals nor adds PWD. Nonexported cloned state is not automatically
erased by replaceEnv. Borrowed optional signal, cancellation precedence, shared
budget and stdin provenance remain unchanged.

`declare -p` lists all selected scalar/indexed bindings, unlike the candidate's
existing readonly-array listing refusal. Do **not** silently retrofit `set`,
`export`, `readonly` or bare `local` listings: C currently refuses no-arg `set`,
uses JSON quoting for scalar attribute listings, refuses selected readonly
arrays, and bare `local` follows exported-name listing. Root must separately
authorize any correction to those existing behaviors; this profile reports
them as deliberate integration gaps, not declaration roundtrip successes.
Display creates no local binding and changes no value/kind/attribute, including
inside functions; internal ledger enrollment is not a declaration side effect.

## Parsing, preparation and observable order (C -> P)

C parser.ts:685 currently recognizes compound assignment then rejects every
mixture with a command word at :717. Adding a builtin name alone cannot support
`declare -a a=(...)`. P adds private declaration-context metadata on existing
Word/simple-command objects, adjacent to arrays/syntax.ts WeakMaps. Recognize
only literal unquoted `declare`/`typeset`, optionally behind literal `command`
and its `--`; no aliases, computed command names, or arbitrary command prefixes
gain compound grammar. Preserve scalar prefixes' existing temporary-overlay
rules; indexed prefixes remain refused. A shadowing function/registry handler
does not receive a secret executable initializer: compound use requires genuine
builtin resolution, else unsupported2; middleware retargeting also refuses.

Public Script/Command/Word/WordPart shapes, parseShell export and source offsets
remain unchanged. Preserve private metadata through actual parser-owned object
copies, not serialization/reparse. No public declaration node/subpath/options.
Compound-bearing source requires literal option tokens and literal target names;
computed flags/names refuse2 rather than changing grammar during expansion.
`scriptFile` must still parse **every unit before executing any unit**;
Shell.exec/runCurrentText/source retain their existing unit-wise read-time
behavior. Do not make earlier file effects occur before a later syntax error.
Inactive branches/functions still parse their compound grammar. Syntax errors
are distinct from runtime options, readonly, type and resource failures.

Proposed finite lowering, requiring explicit runtime-scope authorization:

1. Retain authenticated AST operand positions and prepare name watches before
   any RHS for known targets; for expanded-name operands use a whole-state
   epoch guard until the name is known (conservative refusal, no retry).
2. Walk argument words in source order, using existing eager declaration
   scalar expansion. For a compound/element node, first check known readonly,
   controls, exported conversion, grammar, final option compatibility and
   **its entire statically certain cursor demand**. Then expand its RHS once,
   left-to-right, collecting admitted fields; uncertain arity checks domain
   after that expansion. A precheck failure stops preparation, not later RHS.
   Earlier scalar/RHS/redirect/host effects already observed are not undone.
   Do not claim a later compound's precheck suppresses earlier scalar effects.
3. Pass ordinary strings through existing middleware/dispatch. For an admitted
   compound operand, construct a bounded, deterministically quoted assignment
   spelling from the expanded concrete entries; retain a private evaluated
   operand record bound to its exact argv position/content and original AST.
   **Never eval/reparse that string.** Literal invoke has no such record.
   This new shell-owned argv bridge is privately charged, not E. If middleware
   changes command, args, cwd or env for a compound-bearing dispatch, refuse2
   before publication; transparent forwarding is allowed. Already observed
   RHS effects remain. Scalar-only dispatch keeps existing forwarding behavior.
4. Redirections/prefix overlays retain simple() ordering; an earlier redirect
   failure prevents publication, but cannot undo eager argument effects.
   Once admitted into the real builtin, validate options globally; then process
   operands in order. Invalid identifiers/scalar readonly/type conflicts are
   diagnostic1 and continue; earlier successful operands remain committed.
   Compound preparation failures have already stopped this command. This
   asymmetry is explicit policy, not asserted GNU behavior.
5. Build a fresh target stage from current binding and already-expanded fields;
   reserve local save/attribute/name/watch/publication/restoration work before
   effects on TARGET. Check cancellation, readonly, then stale watch immediately
   before single publication of kind/value/attributes. Same-command scalar
   duplicates use new watches after the prior owned publication, never retry
   an externally stale stage. No partial target members escape on failure.
6. Retain RHS mutations to TARGET/other variables/files/output. A RHS change to
   TARGET invalidates its watch and prevents overwriting it with the stage.
   Readonly outranks stale if both changed. Preserve existing escaping expansion
   statuses/control flow; H N13's different final bytes do not override this.

This lowering makes compound RHS argument-like and pre-dispatch, whereas the
standalone candidate arrayAssignment combines expansion and publication. Exact
extraction of that existing algorithm is necessary; calling it twice or feeding
it reconstructed shell text is forbidden. Function-local compound RHS observes
the pre-local visible binding, then the local is installed. This timing and the
multioperand preparation barrier are **P**, not unmeasured GNU claims. Refuse
statically incompatible options before compound RHS; ordinary eager scalar RHS
may still run before usage diagnostics, as with current declaration builtins.

## Diagnostics and status (P, preserving C control paths)

0: completed mutation/listing, including empty filtered listing. 1: bad name,
missing named listing, readonly/type/export/control conflict, index domain,
stale state, lossless-format refusal or private ledger exhaustion. 2: option/
usage/unsupported declaration form; ShellSyntaxError remains syntax2 with
source location. Name-specific failures continue only in the builtin operand
loop; preparation, expansion, quota, cancellation and I/O failures stop work.
Usage failure changes no declaration target, but is not rollback of eager RHS.
Diagnostics use existing script/line framing and invoked builtin/name/category;
do not claim byte-for-byte GNU wording or emit raw unbounded hostile names.

Do not remap escaping ParameterExpansionFailure to generic declaration1:
candidate executeCommand uses127 in non-isolated state and1 in isolated state;
other ExpansionFailure uses1. EPIPE retains141, ShellLimitError its existing
public failure path, and caller cancellation its original reason/precedence.
Registered cooperative cleanup and root barriers still settle before the public
result. Diagnostic-output failure must not trigger recursive diagnostics.

## Deterministic lossless format (P; C string constraints)

Always output `declare`, including `typeset -p`. Attribute order is a/r/x;
no attributes uses `--`. Names list in ascending ASCII/code-unit order; sparse
indices in ascending numeric order, never dense scans or locale sorting.
Named requests preserve request order. End each complete declaration with LF.
An imported host environment key outside the identifier grammar refuses that
record with1; do not silently omit it or emit unreplayable shell syntax.

* Set scalar: `declare -- name='value'`; missing scalar: `declare -- name`.
* Sparse: `declare -a a=([2]='two' [9]='')`; missing zero is omitted.
* Empty indexed: `declare -a a=()`; no missing/initialized-empty distinction
  beyond the candidate's actual empty binding model is invented.
* Readonly/export forms prefix the same body with `-r`, `-x`, `-rx` or `-ar`.

Encoder: emit maximal non-control text runs in single quotes, encode apostrophe
as the concatenated shell fragment `'\''`, and C0 except NUL plus DEL in separate
ANSI-C segments `$'\xHH'` (two lowercase hex digits per byte, segment closed
before following text). Empty value is `''`. Unicode scalar text stays literal
UTF-8 inside single quotes: do not use locale-sensitive `\u` escapes. Newline,
CR and tab use escaped segments too, giving one physical output line per name.
Quotes, `$`, backticks, backslashes and substitution-looking values remain data.

C ansiWord truncates at NUL, decodes byte escapes through UTF-8 replacement,
and rejects non-scalar Unicode escapes. Script-file decoding rejects raw control
bytes and malformed UTF-8. Therefore no arbitrary 0x80..0xff byte roundtrip is
claimed. Refuse an output record containing U+0000 or an unpaired UTF-16
surrogate **before any bytes of that record**; never silently truncate/replace.
Valid C0/DEL characters, Unicode including astral characters and U+FFFD itself
are representable with this encoder. Existing input/write semantics are not
globally tightened by this refusal.

Roundtrip means: parse emitted declaration text into a **fresh compatible
virtual state**, at top level, with sufficient existing quotas, then compare
kind/presence/indices/values/attributes. Not eval of untrusted output, not a
merge into conflicting readonly/local/control state, not GNU-identical text,
and not replay of shell functions or an entire process environment. Future
roundtrip comparison excludes internal getopts cursors/control metadata not
represented by the supported a/r/x attributes. Future
checks must exercise public parseShell/Shell.exec and VFS scriptFile separately;
no roundtrip is executed here.

## Allocation, G4A and cleanup (ratified boundary; P new roles)

Keep B=maxExpansionBytes, F=maxExpansionFields. In existing refusal order:
live wrappers F; private Map/WeakMap slots F; payload B; metadata128F;
cumulative allocation8B+512F; cumulative slots8F; reserved work32B+256F.
Derive exactly/lazily; reject unrepresentable equations in that order. Existing
generation/version/epoch tentative-cursor checks precede demand counters;
failure commits neither counters nor cursor. Only released live counters refund.
Every Admission still adds metadata64/work15. No new public limit or exemption.

**G4A exactly:** new SHELL-owned stores/stages/snapshots/joins/argv bridges are
private. Existing registered-command formatting **after admitted argv transfer**
is E/existing Budget+IO. Builtin declaration sorting/escaping/encoding/formatting
is **new shell-owned work**, including after dispatch; it is not automatically
E. Qualification remains `private logical storage + E_input +
E_post-transfer-command-formatting`; no total-memory/RSS or all-derived-memory
bound follows. Sink retention remains in its existing output contract, without
excusing the private construction buffer or maxOutputBytes.

New roles must be charged **before construction**: membership/name/watch slots;
operand/descriptors/owned text; pinned old bindings; staged copies; scalar and
typed local saves; snapshot entries; names/index vectors; quote fragments;
argv spellings; encoded chunks and diagnostics. Reuse existing logical role
charges (slot32, text metadata32, typed wrapper128) and Admission overhead;
new vector cells reserve metadata32/allocatedSlots1 each, not Map slots.
Headers reserve metadata128/work8; each scanned UTF-16 unit or compared numeric
index reserves work before inspection, and name comparison charges scanned
units, not a fictitious constant string comparison.

Enumerate/count under an epoch guard without an unadmitted Object.keys/spread;
reserve two overlapping vectors before a stable bottom-up merge sort. For n
entries reserve work for each copy/comparison (or incrementally before each),
with checked arithmetic; never sort through unbounded native comparator work.
Pin/copy immutable values while the snapshot is live. Scan the encoder first
to count exact UTF-8 output bytes and validate representability; charge both
passes. Reserve fragment cells and final joined payload **while sources remain
owned**, then encode into preadmitted bounded chunks (at most1024 bytes).
Encoding boundaries must preserve surrogate pairs; never independently encode
half of an astral character into replacement bytes.
Conservative refusal if the record cannot coexist is legitimate; spilling or
releasing the source before the destination is admitted is not.

Avoid whole-list joins. Hold one bounded record through awaited writes and
release its transient buffers afterward; retain selection snapshot until done.
Prefix records already written cannot be retracted on quota/cancellation/I/O
failure. Preflight each record prevents a lossless-format error midway through
that record, not arbitrary sink failure midway. Preserve chunk ownership,
backpressure, maxOutputBytes and destination-specific ownedOutput admission.
Do not cancel sibling stdout/header/stderr/file work merely to close one sink.

Register cleanup synchronously before acquiring owners/resources. Reuse the
same idempotent completion in finally; close seals new admission and waits
admitted cooperative work via root holds/child scopes. Prepay all restoration
before temporary/local publication; no finally-time quota request. Checkpoint
scans/copies/merges/escapes/drains using existing cooperative cadence; no promise
of preempting flat primitives or opaque host work. Snapshot epoch changes
refuse rather than retry; no budget refund for failed/repeated listing work.

## Exact future write scope, not present authorization

Required existing paths: `src/shell/runtime.ts` (discovery, preparation/dispatch,
State/saves, existing write/unset/local/copy/invoke integration),
`src/shell/parser.ts` (command-context recognition),
`src/shell/arrays/state.ts` (named membership, snapshot accounting),
`src/shell/arrays/syntax.ts` (private metadata only). Proposed new private paths:
`src/shell/declarations/options.ts`, `src/shell/declarations/format.ts`,
`src/shell/declarations/syntax.ts`, `src/shell/declarations/state.ts`.
Reuse unchanged ledger/binding interfaces;
if extraction requires changing arrays/bindings.ts or arrays/ledger.ts, STOP and
request that exact additional ownership rather than quietly changing formulas.
Future owned tests: `tests/shell/declare-runtime-20260828/semantics.test.ts`,
`tests/shell/declare-runtime-20260828/parser.test.ts`,
`tests/shell/declare-runtime-20260828/resources.test.ts`,
`tests/shell/declare-runtime-20260828/public-consumer.ts`. None exists by virtue
of this proposal; fresh assignment/nested instructions must precede edits.

No planned edits to shell.ts, types.ts, src/index.ts, package.json, public AST,
contracts, aggregate registry, existing shared tests or AGENTS. Updating existing
listings or making arbitrary host JS strings losslessly serializable would need
further exact scope, not a casual public-contract redesign. Rebuild/public
consumer/type/runtime/independent evidence would be future work, not performed
under this design-only permission. mapfile/readarray/alias and other follow-ons
are excluded. No superiority/full completion/72-hour claim.
