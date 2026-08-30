# Directory-stack root ratification

Status: Accepted design; different precode freeze and implementation GO pending.

Implemented Through: Not applicable to pushd/dirs/popd. Accepted cd prerequisite
is `4641075df5355a91c83bf5b2cc3a88dfaf1f5153`; no stack implementation exists in
this handoff. Future implementation must bind the accepted CD + LET composition.

Purpose: make the complete author-facing packet normative without rewriting its
earlier proposal, native observations, pending-decision history or source proofs.

## 1. Authority and reading order

ROOT ratified the complete `../PACKET.md` at
`053505fcb5b63d8872991eb09655bc927dd7080d`, first R2-R4 and then R1 with the
explicit enclosing-frame behavior below. The authoritative design is that exact
packet plus this later ratification. Its historical words "proposed", "recommend"
and "await ratification" record the earlier stage; they do not leave R1-R4 open
now. Neither document authorizes production writes. This overlay takes precedence
for scheduling, the clarified stamp behavior and the no-new-types restriction.

The implementation MUST retain the approved grammar, signed64 project profile,
transitions, admission order, diagnostics and limitations. No native cohort was
rerun or rescored to record these decisions. ROOT is the policy authority; Locke
will independently freeze cases before a later, separately authorized candidate.

## 2. R1: process ownership and private representation

Existing `Shell.exec` constructs fresh cwd, variables and State per call from
constructor/exec options (`src/shell/shell.ts:237`, `src/shell/shell.ts:245`). It
does not persist execution cwd/env into constructor options. Filesystem/registry
configuration can persist independently. A fresh tail therefore follows current
process scope rather than adding a special reset or persistence API.

| Boundary | Required stack treatment | Accepted construction |
| --- | --- | --- |
| Each consecutive/concurrent Shell.exec | Fresh empty tail, no prior stamp | shell.ts:245 |
| Function, source/eval, braces, successive input units | Share the same State/tail | runtime.ts:1433,2076,2005; shell.ts:267 |
| Subshell, pipeline member, command substitution | Copy tail, no mutable array/object alias | runtime.ts:1010,908,2442 through cloneState:278 |
| context.invoke, including cwd/env replacement | Copy before child overrides; no parent/sibling writeback | runtime.ts:2102 |
| Interpreted sh/bash and executable-script process | Fresh empty tail/stamp | runtime.ts:1609,1646,1950 |
| Isolated inline input, redirect-state spread, shebang forwarding | Clone at their existing clone/spread boundary until a fresh process boundary | runtime.ts:1298,1324,1735 |

The packet's private tail/UTF8-byte metadata and immutable publication symbol
belong to the existing internal State. No public types/API, types.ts edit, new
shared counters or new state-wrapper type merely to hide fields is authorized.
Missing private tail means empty for existing internal State literals. Published
tail entries MUST NOT be edited in place; each child gets its own tail object and
array. Immutable strings and the primitive stamp value may be copied by value.
Replacing a child's stamp property MUST NOT affect its parent. Local variable
restoration does not implicitly restore directory-stack state.

## 3. R1: exact stack-specific cwd-publication rule

The private stamp MUST change immediately after an actual stack-originated cwd
assignment, before checked PWD. This includes successful same-path assignment and
subsequent readonly-PWD failure. Lookup failure and readonly-OLDPWD failure do not
reach assignment and MUST NOT change it. dirs, -n and other operations without cd
MUST NOT change it. Ordinary cd alone MUST NOT update this stamp.

Each same-State dispatch frame saves the stamp before applying its middleware cwd
overlay. The current conditional restoration at `runtime.ts:1477` remains, with
the additional requirement that the saved and current stamp are equal. The
explicit cd exception, path-equality comparison and variable restoration remain
unchanged. This is not a general middleware-cwd repair.

Concrete design trace, NOT a new native or virtual execution:

1. Outer cwd/PWD is `/origin`, tail is empty. Middleware forwards function `f`
   with cwd `/borrowed` and otherwise unchanged environment.
2. In that same State, `f` executes `pushd /borrowed`. Shared cd publishes OLDPWD,
   cwd `/borrowed`, the new stamp, then checked PWD. On complete cd success the
   ordinary push publishes tail `[/borrowed]` and prints the stack.
3. Baseline equality-only restoration would restore outer cwd `/origin` because
   the final cwd equals the borrowed path, while leaving the resulting PWD/tail.
4. Under the approved rule, the changed stamp prevents that outer restoration;
   cwd remains `/borrowed`. The direct builtin frame alone is not sufficient.

This deliberately changes enclosing function/source/command frames that execute
a same-State stack-originated cd. If the function later runs ordinary cd back to
the borrowed path, the changed stamp still prevents restoration. That behavior is
explicitly approved, not an accidental consequence hidden behind the builtin.
Frames with no stack-originated publication keep baseline behavior. A dirs/-n
operation in a borrowed cwd still restores it where baseline would. A child's
publication cannot suppress the parent's restoration. Already-published state
MUST NOT be rolled back after PWD/output/abort failure.

## 4. R2-R4: complete previously ratified behavior

The detailed normative algorithms remain in packet sections 3-7; this list binds
them rather than replacing their exact accounting with a summary:

- R2: complete separate-token grammar and selector ordering; exact signed64
  project parsing; the observed G01-G08 distinctions. Help and unmeasured extreme
  overflow behavior remain qualified project targets, not native observations.
- R3: pre-admit/preconstruct the next tail, including inserted cwd. Charge exactly
  reached tokens, used HOME, path/entry scans and final partial-work flush as
  specified. Limits remain 4096 remembered entries, 4MiB tail UTF8 bytes, 64KiB
  path/token/used-HOME, 8Mi helper steps, yield every128 steps, 8MiB display and
  16KiB chunks. The stack and accepted CdLookup 8Mi counters are SEPARATE, not a
  global work bound. No extra command tick, shared-Budget reset or new public limit.
- R3: the single stack display allowance includes required cd-selected path print
  AND stack print. Writes are awaited, may be partial, and retain existing parent
  output budgets and exact sink/caller failure behavior.
- R4: ordinary push/top-pop publish their tail only after the shared cd completes,
  INCLUDING required CDPATH/dash printing. Swap/rotation pre-cd tail changes stay
  published on later failure. Automatic display failure does not roll back tail.
- R4: checked OLDPWD precedes cwd; stamp follows cwd immediately; checked PWD then
  follows. Existing stronger readonly protection is retained, not native parity.
  The cd-owned path with no stack hook remains unchanged.
- R4: 65,792-byte owned diagnostic payload, including command text and internal
  usage newlines but excluding existing shell origin prefix/final newline;
  truncation reserves the exact 12-byte ` [truncated]` suffix. This is not a whole
  line/global stderr/RSS guarantee. Exact private messages remain packet-defined.

DIRSTACK arrays/special binding and stack-tilde expansion remain deferred. Three
builtins do not increase the aggregate plugin command count. No parser, provider,
permission, physical-cd, public-limit or root-export changes are included.

## 5. Source ownership, release and future binding

The stack author EXPLICITLY RELEASES the current idle runtime window for the tiny
LET implementation first, once its different freeze/root GO permits that work.
Only stack docs/precode work continues now. There MUST NOT be concurrent runtime
writers. Approval of this design is NOT approval to implement stack runtime.

Expected later stack production write set remains `src/shell/runtime.ts` and the
fresh initializer in `src/shell/shell.ts`, subject to ROOT's future exact GO. No
types.ts, parser, contracts, exports, package, AGENTS or new public API changes.
The accepted CD source/proofs remain prerequisites. After LET is independently
accepted, ROOT must supply its exact composition; author/reviewer bind those bytes
and preserve LET, accepted cd, getopts, cancellation and owned-output behavior.
No LET source hash, acceptance or combined package is invented in this seal.

## 6. Evidence and conformance boundary

Original34 native/34 virtual observations and 0/34 comparison remain unchanged;
four topology observations and eight later presealed native-only observations are
separate. No new native/product run occurred for this ratification. Binary and
manual hashes, full inputs and raw outputs remain in the sealed parent binding.
The original invalid bundled snapshot flags and all help/overflow/source-only
qualifications remain visible; this is not full Bash/native parity.

CD L24 ran the actual candidate Runtime with a scripted provider in all3 layouts.
Its target was `'/' + '\uD800'.repeat(21845)`, 65536 UTF8-accounting bytes with
the original string preserved. Memory could not represent its component; the
historical batch stopped at L07 setup after61 passes, leaving L24 BLOCKED, not an
executed assertion failure. Private-invariant roles remain their declared pinned-
source proofs, not claimed dynamic counter measurements.

The handoff maps required independent controls. No stack implementation acceptance
or new runtime score is claimed. All policy choices R1-R4 are resolved; only the
different freeze, accepted CD+LET binding and explicit implementation GO remain.
