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

Numeric operands must begin with an ASCII digit. Trailing C whitespace is
accepted, but leading whitespace, signs, and embedded nontrailing whitespace
are not. The qualified profile accepts numeric values through 2147483647;
larger values fail operand validation. This is the observed reference boundary,
not a portable assertion about every platform's `pid_t` type.

A malformed digit-leading operand returns 1 immediately, leaving later operands
unprocessed. Other invalid operands produce a diagnostic and allow subsequent
operands to determine the final status. `--` ends option processing. `-f` is
recognized for the current termination-only execution model. Unknown option
diagnostics preserve the single original option byte, including invalid UTF-8.

The reference usage line advertises options which are not all implemented here.
Full `wait -n`, `wait -p`, stopped-job semantics, job specifications, foreground
job control, notifications, signal delivery, and trapped-signal interruption of
wait remain unfinished work. Recognizing `-f` is not qualification of those
behaviors.

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
