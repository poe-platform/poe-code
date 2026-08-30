# Next surface gaps: source-only implementation plan

Date: 2026-08-29. Decision request, not implementation permission or acceptance.

## Recommendation and evidence boundary

Land **B35 first**, as one parser-local successor. Then implement PIPESTATUS against an explicitly accepted ERE/core composition. Current production ownership remains Plato; this packet changes no product files. The frozen ERE commit is separately inspected, not promoted or mixed into the accepted core.

The accepted finite virtual cohort contains 19 equal/18 different identities. Its campaign final-accounting HOLD remains unchanged. Existing B30/B35 are two local GNU Bash3.2.57 observations, not GNU5.3 goldens. SOURCE-BINDINGS.json preserves their six source/installed/moved rows, exact program bytes/hashes, stdout/stderr/status and filesystem records. No native/product/parser/build/Worker execution occurred for this plan. All 32 future proof IDs remain UNRUN.

| Existing identity | Exact native observation | Accepted-core counterpart |
| --- | --- | --- |
| B30: false/true pipeline followed by quoted PIPESTATUS expansion | stdout bytes \x3c1\x3e\n\x3c0\x3e\n; status0; empty stderr | stdout \x3c\x3e\n; status0; empty stderr |
| B35: function-keyword definition and invocation | stdout f:value followed by LF; status0; empty stderr | empty stdout; status2; 62-byte unsupported-function diagnostic |

Both have unchanged fixture effects. No output normalization is proposed. Native invocation argv0 surface-case versus public Shell.exec remains an existing diagnostic-context limitation.

## B35: minimal useful v1

**Proposed production write-set: src/shell/parser.ts only.** New focused tests under tests/shell/function-keyword-author-20260829/** after permission. No runtime/public AST/types/options/registry/default-count change. Existing Command function node (parser.ts:72), runtime definition storage (runtime.ts:1531), invocation/locals (runtime.ts:2118), and deferred body redirects remain authoritative.

Recognize an unquoted plain function token in command position, consume the following unquoted name without reinterpreting it as a body keyword, optionally consume exactly (), permit newlines after name or closing parenthesis, then parse one already-supported compound body. Reuse the present body parser and nesting budget; do not reconstruct source, eval text or rewrite argv. Quoted function remains an ordinary word (lexer value comes from word.plain, parser.ts:178). No newline between function and an absent name; no semicolon replacing the required body; no arguments in (); no plain simple-command body. Preserve offsets/lines and existing legacy f() parsing.

Recommend the existing ASCII identifier domain [A-Za-z_][A-Za-z_0-9]* for this first change; explicitly document the GNU non-POSIX wider-name gap instead of claiming full grammar. Within that domain allow reserved-word names in this name position, including if; invocation can quote the name. GNU execute_cmd.c:6305 and general.c:431 support this distinction. Reject quoted/expanded names. Do not add a universal reserved-name ban. Existing sh-profile special-builtin check remains runtime-owned; no new POSIX-mode claim.

Body starters remain the currently implemented {, (, if, case, while, until, for, [[ (including existing arithmetic handling at (). This includes optional-parentheses forms rather than a braces-only stub. Redirections attached to the body are evaluated at invocation, not definition; definition alone cannot create/truncate a file. Function source/positional/local/return/recursion behavior stays existing behavior. Preserve scriptFile whole-AST preflight and Shell.exec current input-unit boundaries; no alias/read-time policy change.

Primary basis: authenticated GNU parse.y:1054–1084, execute_cmd.c:6289–6337, general.c:419–461; official [Shell Functions](https://www.gnu.org/s/bash/manual/html_node/Shell-Functions.html). These are source/manual claims. Only F01 already has a local native observation. F02–F10 are proposed tests, not measured outcomes.

## B30: typed status publication, not string substitution

**Proposed production write-set: src/shell/runtime.ts and src/shell/shell.ts only.** Focused tests under tests/shell/pipestatus-author-20260829/**. Existing arrays/bindings.ts, state.ts and ledger.ts are reused read-only; no new public API/limits. If their existing methods cannot express the stated ownership invariant, stop and propose an exact additional write-set before implementation.

Current runtime.ts:1480 already obtains ordered numeric stage results after stage-owner settlement, then line1481 discards the vector. State initialization shell.ts:245 has only scalar status. Existing expansions already support indexed arrays. Add private Runtime initialization/publication helpers, not an environment string or synthetic parameter-only answer. A fresh root and fresh virtual bash/sh invocation get an initial indexed [0] under the proposed profile; copied subshell/pipeline/command-substitution states inherit their existing typed snapshot instead of reinitializing. Fresh virtual invocation creation at runtime.ts:2366 needs its own initialization; cloneState at310 and snapshots at arrays/state.ts:256 continue sharing the invocation ledger, never counters reset. Initial [0] is a proposed startup profile pending P02 qualification, not established by B30.

### Completion table (source-derived targets unless marked proposed)

| Boundary | Publication and timing |
| --- | --- |
| Simple command, assignment-only, function invocation | Singleton completed command result; arguments/redirect expansions see the previous snapshot. Function body commands update same-state values during the call; function return then becomes a singleton. |
| Multi-stage foreground pipeline | Publish ordered stage vector once all known stage work and pipeline cleanup settle. Pipefail chooses aggregate separately. Simple/multi-pipeline ! changes aggregate, not underlying process-stage vector. |
| [[ / (( | Dedicated completion point. GNU execute_cmd.c:1203–1222 inverts before singleton assignment. Do not impose the simple-pipeline raw-status rule on these compounds; P07/P08 require qualification. Unnegated ERE syntax failure status2 must remain numeric2. |
| Brace group, definition, loops/if/case wrappers | Do not blindly replace the last inner vector with wrapper aggregate. Preserve updates caused by commands actually executed. No invented status for skipped &&/|| branches. |
| ( subshell ) | Child snapshot is isolated; parent receives subshell completion singleton. |
| Command substitution | Child updates do not leak into parent; surrounding command/assignment publishes its own completion result. Existing lazy expansion, substitution status and state-copy contracts remain. |
| Errexit and shell numeric failures | Publish at the proper numeric completion point before the applicable Flow exits. Current command():1506 invokes errexit before returning, and executeCommand catch paths:1640–1671 also throw Flow: an update only after pipeline() returns is insufficient. Preserve error ordering, never catch every rejection as an exit code. |
| Caller abort, rejected sink/cleanup, limits | Preserve exact rejection identity/primary-secondary policy. Proposed project rule: no falsely completed new vector after rejected cleanup; last successfully published snapshot remains. No fallback unbudgeted publication. This host-API rejection policy is not native Bash signal parity. |

GNU doc/bash.1:2169–2192 describes the variable; execute_cmd.c:4904 sets builtin/function singleton results; jobs.c:4464–4488 fills pipeline order; subst.c:6999–7002 saves/restores status across relevant expansion work. These source paths are pinned in SOURCE-BINDINGS.json. Unsupported timing/background/job-control/traps remain unsupported, not silently simulated.

### Special binding choices requiring explicit v1 ratification

Recommend following the visible GNU setter: absent variable is recreated; existing non-array scalar is left scalar; indexed variable is replaced with completed statuses. variables.c:6299–6377 does not check readonly before its internal updates. Therefore propose a **narrow internal PIPESTATUS publication** that can update a readonly indexed special binding while all user writes/unset still follow existing readonly checks. Do not globally bypass readonly or copy ERE BASH_REMATCH's different diagnostic policy. P16–P18 must qualify readonly, unset recreation and visible local/restoration behavior before this scope is advertised.

An inherited exported scalar PIPESTATUS must not be silently converted/exported as an array. Proposed setter leaves it unchanged, consistent with the non-array branch; verify startup/environment behavior separately in M01 state setup. Ordinary array export refusals stay unchanged. No general local/scalar-overlay bug fix. Typed internal publication must select the current visible binding and preserve typed-local restoration/overlay ownership; no global hidden shadow that ignores local PIPESTATUS. These are explicit proposed choices, not facts inferred from B30.

Use existing requireArrays/ArrayOwner/textToken/IndexedBinding, prepared name/watch and stateMonitor.prepareTypedPublication/publish. Register cleanup before acquisition, reserve all per-stage decimal tokens/slots/metadata/work and generation/epoch tickets before allocation/publication, stage once, validate stale/caller conditions, publish atomically, release old binding and drain owned staging idempotently. Failed reservations leave the prior value intact. Internal readonly exemption does not exempt stale/caller/cap checks. Existing public Budget and array ledger both remain active, including clones and saved locals; no whole-memory/RSS claim. Activating the typed store for every shell is an observable implementation-path change (runtime dispatch branches on arrayStore): M01/M04 must check that cost and completion paths, not hide it behind the B30 example.

Statuses retain existing command results including command-not-found127 and PipelineClosed141. No new host signals/processes: do not translate arbitrary AbortSignal reasons to128+N. Native signal cases need separate authority and are outside this first hostless profile.

## ERE composition and landing order

Frozen e013f817fd7700c59a144c395c80dc25856e4157 changes conditional.ts, parser.ts, runtime.ts, shell.ts. Parser hunks affect conditional regex lexing near287–380 and conditional grouping near617–640, not function branch743. **B35 is hunk-disjoint and can be an atomic parser-only feature**, but still needs the owner's exclusive file window and a content-verified rebase; this is not a promise that concurrent editing is safe.

PIPESTATUS requires runtime completion changes around1353–1509 and shell root initialization, while ERE adds conditional numeric status handling, BASH_REMATCH staged array publication and root worker cleanup registration. Text hunks may differ, but lifecycle/typed-state/status coupling is real. Land it second after an accepted ERE composition (or explicitly preserve the frozen prior core); verify conditional status2, BASH_REMATCH readonly/export/stale behavior, exact caller reason and cleanup unchanged. No ERE worker policy or protocol edits are requested.

## Finite proof and future authority

PROOF-MATRIX.json contains exactly **32 IDs: F01–F10, P01–P18, M01–M04**. Only F01/P01 cite retained observations; every future execution is UNRUN. Expected obligations are marked proposals/source-derived, not fabricated native outputs. M controls are finite product-fault/composition requirements, not native commands or proof performed now.

The 26 literal F02–F10/P02–P18 scripts are a proposed native observation list, not a runnable grant. Before any native execution a different reviewer must freeze exact argv/env/tool/dependencies/fixture bytes/capture/cleanup and root must issue fresh authority. Use authenticated, qualified GNU5.3 if available; otherwise explicitly label separately approved local3.2 observations and retain disagreement. No automatic substitution of versions. F05 alone writes fixed owned out; F06/P15 contain exact failed lookups function/__surface_missing_command__ in fresh empty PATH, not permission for external execution. All other listed scripts use builtins/control/owned substitutions; no network/user files/native product fallback. No native signal testing is proposed.

Suggested future observation envelope, NOT activated: at most26 script launches, one at a time,3s per script plus independently reserved cleanup,64KiB per stream; fresh LC_ALL=C/LANG=C/TZ=UTC and owned HOME/TMP/cwd/empty PATH, no startup input. A real launcher must separately count its admin processes and source-derived forks and receive an inclusive grant; this paragraph grants none and reuses no closed reservation. Fresh source-built/installed/moved product checks and independent holdouts need their own frozen composition and budget; no full-suite, full-Bash or overall just-bash claim.

## Root decisions / ready next action

1. Authorize B35 parser-only window after current owner review; ratify identifier-domain gap and reserved-name treatment, then freeze F01–F10 independently.
2. Ratify PIPESTATUS initialization, internal-readonly/current-local/nonarray behavior and cleanup-failure publication rule; obtain focused native/source review before implementation, particularly compound negation and local binding.
3. Choose the accepted ERE/core composition for PIPESTATUS. Keep all historical observations and accounting HOLD immutable. This packet is ready for source/design review, not executable readiness.
