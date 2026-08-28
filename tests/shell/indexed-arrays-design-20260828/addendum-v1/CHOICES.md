# Source-grounded choices, not a normative freeze

Anchors below use accepted runtime **R=c26892c3** and other source
**B=5137a74e**, with full hashes in SOURCE-BINDING. Original PROFILE remains
historical proposal; this addendum narrows its unresolved decisions only.

## Scalar consumers and exact first-profile policy

Reject indexed conversion/creation for exactly **PATH, PWD, OLDPWD, HOME,
CDPATH, IFS, OPTIND, OPTERR, OPTARG, REPLY, LANG, LC_ALL, LC_CTYPE**.
This is a proposed compatibility restriction, not Bash's reserved-name list.
Reject before an array RHS; ordinary scalar assignments remain unchanged.

| Names / boundary | Actual source observation | Reason / proposed treatment |
| --- | --- | --- |
| PATH | R:1579,2029 search executable/source paths; unset flag at 2363 | Scalar path list; retain unset distinction. |
| PWD, OLDPWD, HOME, CDPATH | R:2264–2281 cd reads HOME/OLDPWD/CDPATH, publishes PWD/OLDPWD and exports them; B shell.ts:238 seeds PWD | cwd is separate state, not an array or a PWD alias. Refuse conversion; neither scalar overlay PWD nor array operations change cwd. |
| IFS | R:2418,2515,2695 splitting, positional joining | Preserve unset/default versus empty separator. |
| OPTIND, OPTERR, OPTARG | R:795–821,2219–2246 cursor/integer attribute, error policy and output variable | Keep scalar getopts bookkeeping; the result-name operand is otherwise an ordinary variable. |
| REPLY | R:2413–2415 default read destination | Explicit core write, not a guessed special. |
| LANG, LC_ALL, LC_CTYPE | B locale.ts:1–4, called during parsing/read/expansion | Direct core locale reads; refuse array conversion regardless of export state. |
| LC_COLLATE; TMPDIR | B commands/expr/internal.ts:99–115, table-text/internal.ts:50–51; metadata/mktemp.ts:63 | Boundary-only consumers, not additional core refusals. Unexported indexed bindings are ordinary; exported scalar conversion is already rejected. |
| TERM, COLUMNS, LINES; other LC names | No references found in the inspected shell/contracts and non-held command source search | Generic scalar env entries can cross dispatch/invoke. No automatic special semantics, no blanket LC-prefix exclusion. This search does not certify held modules or arbitrary plugins. |

Unknown syntactically valid names use ordinary typed bindings. A name associated
only with an unimplemented Bash special (for example RANDOM or SECONDS) receives
no special-variable conversion/side-effect claim. New concrete consumers require
separate source review, not expansion of this list by regex.

## Environments and attributes

| Path | Proposed choice and source reason |
| --- | --- |
| Exported scalar → array | Status 1, unchanged target/export bit, array RHS not started. R:1379 constructs only string env values from exported names; reject rather than silently drop a formerly visible value. Export membership on an unset name also blocks indexed creation. First-profile escape: unset, then array assignment. |
| Export array / listing | `export a` and `export a=value` on indexed fail 1 before mutation; array stays unexported. Scalar-only no-argument export listing keeps existing behavior. Current `export -p` is an invalid identifier, not a supported option (R:2318–2338); native `export -p` rows describe GNU only. |
| Scalar prefix / standalone | Reject `a=value command` if a resolves indexed; reject indexed/compound prefixes syntactically. Do not leak element zero as environment or temporarily destroy the array. Standalone `a=value`/`a+=value` retains indexed kind and targets zero. R:1293–1311 scalar RHS-before-readonly and sequential writes remain unchanged on the scalar path. |
| invokeScoped / shebangState | R:2100–2134,1735–1744 clone state, remove inherited exported bindings, apply scalar env entries. Preserve unexported arrays when absent from env; explicit colliding env entry shadows the entire child binding with scalar, not element zero. Clone-owned replacement never modifies parent storage/attributes. A readonly indexed collision rejects 1 before dispatch. Validate the entire env first. |
| replaceEnv / processState | Exact `options.env ?? {}` exported map, no inherited exports/PWD injection/local promotion; merge mode retains existing PWD treatment. R:1609 processState starts only from string env plus interpreter PWD/OPTIND/OPTERR initialization; no inherited arrays. B contracts/command.md:3–17 distinguishes child interpreter initialization. |
| Middleware | R:1407–1420 overlays string changes in current state and conditionally restores at 1477. Save whole typed binding, apply temporary scalar shadow; reject readonly array collision. Restore only if overlay token/version still owns target, not value equality. Legitimate downstream writes survive. Pre-admit all snapshots/overlay values before publication; use existing cwd/getopts restoration rules. |
| Scalar callbacks | No accepted `environment()` function exists: R:1379's export projection is the equivalent boundary. `state.variables`, arithmetic proxy, parameter fast paths, read/getopts/for writes and declaration args need explicit scalar/element-zero accessors, not Map coercion. LET remains synchronous, name-only, 10k steps/depth64/indirection64; array arithmetic access is refused, not implicitly serialized. |

## Local, readonly, creation and display

| Operation | Future first-profile recommendation; no GNU outcome asserted |
| --- | --- |
| `local a` / `local a=word` | Preserve R:2328 function-context check, argument expansion before builtin validation, identifier then readonly check. Save outer typed binding exactly once per local frame before shadow creation. Indexed outer: fresh empty indexed shadow, or zero=value; no copied entries. Scalar outer: current unset/value behavior and export membership. Absent outer: unset/value scalar. Exported indexed outer is impossible under the proposed invariant. |
| Local snapshots / unset | Save presence/kind/entries/export/readonly/identity and OPTIND cursor+integer state, including prefix snapshot precedence at R:2343. Unset local leaves an absent shadow/tombstone until return, never reveals outer early. Assign after unset creates scalar. Repeated local does not overwrite original snapshot. Restore saved contents/attributes with a fresh generation, invalidating stages across restoration. |
| Readonly outer / inner | Reject local shadow of readonly outer, even without initializer, as R:2339 does. `readonly a` freezes entire indexed binding, no element-only flag; subsequent writes/unset fail. `readonly a=value` writes zero then marks readonly only on success. Missing-name `readonly a` remains unset scalar+readonly, not an empty array. |
| New empty array / conversion back | `a=()` creates a present empty indexed binding. `a=(); readonly a` freezes it. Whole `unset a; a=value` creates scalar with export/readonly removed unless blocked by readonly. `declare -a`, `readonly -a`, `local -a`, `declare +a`, typeset and other declaration attributes remain future/unsupported; no new success placeholders. |
| Display | R:2333 uses JSON quoting for scalar readonly/export/local-no-arg listing. It cannot format arrays. Preflight selected names and refuse entire listing with status 2 and no stdout if any indexed binding appears; do not emit fabricated JSON or silently omit it. Scalar listing unchanged. R:2285–2312 `set` no args is already status 2; B display.ts formats functions only. Root declaration-stage formatter is future. |

Function finally at R:1439 restores locals after return, error and caller abort.
Restore via pre-owned snapshots, without new allocation/admission failure; release
staging first where possible. Register idempotent release synchronously before
acquisition with existing InvocationScope (B cleanup.ts:33–56). Cleanup failures
remain observed through existing settlement; restoration must not replace the
primary cancellation/control/escaping-error outcome. None of these proposals
promises rollback of host work.

## Compound target publication

| Phase | Proposed invariant |
| --- | --- |
| Resolve/prevalidate | Parse/profile-check the whole assignment unit first. At operation entry capture scope-owner identity, name, generation (including absent-name generation), mutation version, kind/attributes. Reject known readonly first, then control/export restrictions; resolve literal indices once and reject statically knowable overflow before RHS. Admit each later implicit-index increment when expanded fields establish its position. Save/pin old immutable values. No array publication yet. |
| Stage | Replacement starts empty; append copies existing sparse slots incrementally into admitted stage. Use full Map metadata copy, shared immutable values (ACCOUNTING). Process RHS in source order once, command substitutions once, with ordinary splitting/field boundaries only where the original profile requires. RHS resolves live prior target, never stage; earlier staged entries are invisible. Native visibility is unqualified until separate GO. |
| Reentrancy | A RHS parameter assignment can mutate the target in the current state; command-substitution function mutations instead affect its isolated clone (R:2488). Host callbacks/awaits might change, unset, recreate or mark the parent readonly: generation/version guard catches even same-value writes and unset/recreate. No native row pretends subshell mutation proves parent reentrancy. |
| Commit/fail | After final await check caller cancellation/escaping failure precedence, then current readonly (status 1) before stale-target conflict (status 1). Reject stale state; never re-resolve/re-evaluate. Transfer the admitted stage in one synchronous no-await step and advance version. Failed stage releases only stage ownership; no old-target resurrection, no undo of RHS state/file effects or earlier scalar assignments. |

A readonly target known at entry suppresses array RHS; a target becoming readonly
during an await preserves effects already observed and refuses publication. If an
RHS expansion already fails, do not override that failure with a later readonly
diagnostic. Root must ratify these proposed diagnostic priorities independently
of native observations. This is target-atomic publication, **not command atomicity**.

Generation/version counters must never wrap: admit checked increments before
mutation and reserve restoration identity capacity with the saved local frame.
The no-throw restoration path cannot discover an exhausted counter after return.
