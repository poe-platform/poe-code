# Optional background execution and wait

## Installation and scope

`jobsExtension()` explicitly enables the `&` list terminator, `$!`, and the
`wait` builtin. It takes no configuration and reads no environment variables
of its own. The extension is available through the repository's optional build,
not the default root or browser entry, command aggregate, or package payload.
No native processes, host PIDs, or host job table are used by the implementation.

This is an incremental implementation, not full Bash job control. The current
reference is the pinned Bash 5.3 build on Darwin, with the C locale in the native
fixtures. Native observations, unchanged program replays, and adapted VFS or
host-controlled lifecycle tests are distinguished in their fixtures.

## Launch and shell state

The asynchronous unit is the complete parsed AND/OR list before `&`, not just
its last command. Preparation snapshots the child shell before the parent
continues; it does not reconstruct or reparse source text. Launch returns status
zero. `$!` names the latest launched virtual child, including a child which has
already completed. Preparation yields a single-use child execution handle.

Assignments in the child do not modify parent shell bindings. Functions, groups,
`eval`, and sourced scripts use their current shell's wait ownership. Forked
shells inherit the visible `$!` value but do not acquire the parent's waitable
children. Explicit `bash` and `sh` execution uses the virtual filesystem and
the same opt-in extension, without a host-shell fallback.

Asynchronous default stdin is empty. An explicit input redirection overrides
that default. Shared input cursors and surviving descriptor aliases keep their
normal ownership and byte behavior.

## Wait operands

Bare `wait` waits for this shell's children and returns zero when their ordinary
statuses have been collected. Explicit numeric operands return the last
selected child's status; an unknown numeric child returns 127. A retained
completed child can be waited for again until the relevant registry is cleared.

The qualified reference has a non-obvious direct-command boundary: waiting for
`! true &` returns0 and waiting for `! false &` returns1. In contrast, waiting for
`: && ! true &` returns1 and `: && ! false &` returns0. The directly asynchronous
simple command exits with its raw status before the enclosing inversion path;
the AND-list executes its selected command synchronously inside the child shell.
The four native observations are preserved separately. Ten additional native
programs cover negated groups and subshells, three pipeline/pipefail combinations,
a function returning7, and explicit exit7. Those asynchronous boundaries retain
the observed raw status; `pipefail` still selects the pipeline result, and an
explicit exit is not logically inverted. These selected programs do not establish
every combination of traps, functions, redirections, and pipeline syntax.

Ordinary numeric operands must begin with an ASCII digit. Trailing C whitespace is
accepted, but leading whitespace, signs, and embedded nontrailing whitespace
are not. The qualified profile accepts numeric values through 2147483647;
larger values fail operand validation. This is the observed reference boundary,
not a portable assertion about every platform's `pid_t` type.

A malformed digit-leading operand returns 1 immediately, leaving later operands
unprocessed. Other invalid operands produce a diagnostic and allow subsequent
operands to determine the final status. `--` ends option processing. `-f` is
recognized for the current termination-only execution model. Unknown option
diagnostics preserve the single original option byte, including invalid UTF-8.

## Next wait and destination publication

`-n` selects an eligible active, unnotified child. Explicit operands first search
saved numeric statuses, in operand order, before validating active targets or
writing their diagnostics. This prepass can return a previously saved status
repeatedly. Bare `wait -n` does not search saved statuses. An explicit active but
already-notified child is known, but not eligible: a selection with no eligible
child returns127 without treating that child as unknown. A successful next wait
saves its selected numeric status after the child's owned cleanup completes.

The explicit next-wait numeric path accepts C leading/trailing whitespace and
signs, unlike ordinary wait's digit-leading dispatch. Spelling does not cause
retirement. Negative numeric values cannot identify the positive virtual child
tokens. Unknown operands retain raw diagnostic bytes; job-specification lookup
is not implemented merely because its diagnostics are recognized.

`-p` accepts an attached argument or the next argument, including option-looking
text. Only the last destination is prepared, after all option parsing succeeds.
The generic reference bridge validates captured reference syntax and performs
early whole-name unbinding, then later assigns the selected integer process ID
against the current canonical binding. Bracketed whole-name unbinding does not
remove an indexed element. Scalar, local, readonly-unset, and literal indexed
effects have selected primary observations; this is not full arithmetic,
nameref, declaration-attribute, or late-readonly reference qualification.

An interrupted or unsuccessful selection leaves an early-unbound scalar unset;
bare ordinary wait does not publish a PID. For ordinary operand lists, a trailing
invalid operand clears the final publication candidate rather than publishing
the last earlier valid PID. Reference cleanup is awaited, and a secondary close
failure does not replace an escaping primary failure, including falsey reasons.

## Status residence and remaining integration

The registry distinguishes active-unnotified, active-notified, saved, and
forgotten records. Ordinary waiting cleans already-notified completed records
before marking its current active target notified. The captured generic
`loop-body-complete` checkpoint archives notified numeric completions; starting
another background job also cleans prior notified records. Neither arbitrary
simple-command completion nor repeated next-wait spelling triggers retirement.
Bare ordinary wait forgets collected records. Failed tasks are never converted
to numeric saved statuses. Active and saved records share the existing bounded
job admission limit; this does not emulate native CHILD_MAX pruning or PID reuse.

Foreground retirement remains a concrete integration gap. Four authenticated
Bash5.3 observations place an intervening colon, subshell, pipeline, or command
substitution after ordinary wait. The colon leaves explicit next wait at127;
the other three return the saved7. Current leaf-only integration matches the
colon and still returns127 for the other three. It needs explicitly approved
generic core cleanup boundaries, not reaping after every command or inferring
native job-table membership from the substitution's output. No foreground core
hook is implemented by this leaf increment.

Stopped-job semantics, job specifications, foreground job control, notifications,
general signal delivery, trapped-signal interruption outside the bounded
cooperative profiles below, POSIX-mode saved-status
deletion, and remaining reference forms are unfinished. Recognizing `-f` in the
termination-only model is not stopped-job qualification. The next-wait and
destination work is therefore not full jobs/wait completion.

## Descriptor and cleanup ownership

Logical child completion and whole-execution resource retirement are separate.
Ending a subshell or waiting for its status must not force its descendants to
finish before the parent can provide their input. The execution root retains
cooperative descendants and drains them, including late registrations, before
public execution settlement and output collection complete.

Each prepared descriptor frame enrolls cleanup before acquiring retained
bindings. At a direct asynchronous command's non-restoring redirection boundary,
replaced inherited bindings are released while surviving aliases remain live.
An explicit fd3 alias to command-substitution output therefore remains a writer
even if fd1 is redirected elsewhere. Inner commands that require later
restoration must not release their enclosing frame merely because they appear
in tail position. Pipeline stages retain their own effective descriptor maps.

EXIT processing and local frame cleanup remain distinct from descendant drain.
Cancellation and failure settle registered cooperative cleanup, preserve falsey
failure reasons, and retain the existing failure-precedence rules. Uncooperative
host callbacks do not gain preemption or sandboxing guarantees.

## Cooperative trapped wait

With an explicit trap signal host, ordinary and next-wait paths can enroll one local
cooperative interruption in its current shell scope. It does not abort the job
owner, consume a still-running child's status, or turn a trapped signal into a
stored job failure. Ignored and unhandled signals do not interrupt. A host that
omits the optional context capability retains the existing wait path.

The bounded virtual profile uses one numeric child, USR1/USR2 catalog values
30/31, and a child status of seven. The parent observes 158/159 and one trap
before continuation while the child remains live; its later ordinary wait
returns seven. The test observes actual wait-listener registration before
delivery. VFS gating replaces the historical Bash 5.2.37 witness's native IPC;
it is not a new native observation or identical source replay. Root cancellation,
escaping falsey failures, descriptor cleanup, checkpoints, disposal, budgets and
trap exit retain separate outcomes.

The WF1 source controls additionally cover pending `wait -n` with no operands,
one or two numeric targets, optional `-p`, and negation using virtual USR1=30.
An interrupted next wait returns before PID publication, leaving its early-unbound
scalar destination unset and preserving live children for later ordinary waits. Ordinary
multi-operand controls also interrupt on a later operand without publishing an
earlier PID. Negation yields caller/trap status zero while retaining interruption
and live-child ownership. These are admitted VFS controls, not new native timing
observations or full option/grammar parity.

Deterministic completion-before-delivery and interruption-before-completion
controls preserve the existing bridge selection: a completed result is not
converted into interruption, while private interruption rejection does not
consume a later completion. Falsey wait, reference and child-cleanup failures,
root cancellation, trap checkpoints, disposal and source budgets are separately
checked. Jobspecs, arbitrary compound timing, stopped/continued jobs and opaque
host-work interruption remain outside this qualification. Fresh compiled/public
acceptance of WF1 remains pending its reviewed committed build.

The destination/transition follow-up checks existing indexed references without
changing reference semantics: `values[1]` textual-name unbinding does not remove
that element or the array, so interrupted waits leave both elements intact.
Initially readonly scalar and whole-array destinations refuse before waiting;
their queued action observes status one. A readonly indexed reference can wait,
but completed PID publication still refuses unless interruption returns first.

An ordinary explicit operand list now keeps one cooperative interruption receiver
across its selections. A pending signal after an earlier completed operand cannot
be lost when advancing to another pending or completed operand, and an earlier
PID is not published on interruption. Replaced/ignored/removed trap actions govern
subsequent wait admission. The canonical controls use explicit virtual USR1=30
and deterministic VFS/JobState observation, not new native race measurements.

## Evidence

The canonical source tests cover syntax admission, factory/runtime identity,
state isolation, wait ownership, descriptor aliases, lifecycle, and cancellation.
The primary and grammar reference helpers authenticate bounded immutable native
evidence and return fresh byte buffers. Public optional-build tests exercise
the compiled command runtime and memory filesystem, including `.sh` files under
both interpreters. Dynamic native PIDs and script diagnostic labels have only
explicit, narrow mappings; raw option bytes, other output, and exit statuses
are not normalized. The plan records the exact snapshots, remaining findings,
independent reviews, and packaging gates for each increment.

The next53 capsule retains106 authenticated artifacts and28 observations. Its
case12 is exploratory, not a golden; case25 is diagnostic-frame calibration,
not a product replay. R8 gates release on the complete calibrated diagnostic
frame and proves selected registration, not kernel wait entry. The new leaf
cohort compares26 selected observations:13 exact original-source replays and13
explicit adaptations. Twelve adaptations provide owned VFS control/input
descriptors; indexed case17 additionally uses canonical binding fixtures.
Case23 also adapts indexed setup/observation. The original indexed17/23 programs
currently fail before wait on unsupported indexed parameter operators; their
unaltered failures remain evidence, not passes. Adaptations preserve compared
status and output bytes, with only the declared case14 PID-diagnostic mapping.
They do not certify unsupported array grammar or identical native control IPC.
