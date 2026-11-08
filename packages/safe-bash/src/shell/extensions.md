# Opt-in shell extension contract

`ShellOptions.extensions` is a trusted host-supplied list of `ShellExtension`
definitions from `shell/extensions.ts`. Each execution creates fresh instances.
An empty or omitted list installs nothing. Core shell modules do not import an
optional implementation. Consumers explicitly import the source leaf or the
repository-local optional build; neither creates a published npm subpath.

Definitions may declare `runtimeIdentity`, using `commandRuntimeIdentity` from
their own contract module when they depend on private byte-value helpers. All
definition names, factory methods, and identities are captured and preflighted
before any create/fork/start callback runs. The immutable captured definition
preserves the original factory receiver, including class-private state. Factory
code remains trusted host JavaScript; this is not a sandbox for malicious methods.
Runtime-bound source and compiled extensions cannot be mixed. The explicit local
optional build uses the public host's module tree and retains the same identities.

Definitions that consume runtime-owned values must declare `runtimeIdentity`
using their module's `commandRuntimeIdentity` token. Untagged host extensions
remain supported. Admission captures each definition's name, factory and identity
once, including inherited properties, and validates every identity before any
factory, fork or startup runs. Captured definitions are immutable and reused by
child scopes; later caller mutation cannot replace their factory or identity.
Source and compiled runtime tokens are intentionally distinct. The optional trap
factory declares its token; mixing it with another runtime fails at admission,
not after interpreting a byte-valued action. Shell-state monitoring preserves
extension objects and their opaque identities instead of proxy-wrapping them.

An instance supplies builtin handlers, optional `set` options, optional `shopt`
options, startup, scope forking and lifecycle events. Duplicate extension names,
builtins and options fail before startup; core builtin replacement is not
permitted. A builtin may be marked special for the `sh` execution profile.
Options are mutable instance state, not shared definition state.

`fork` distinguishes shell processes, subshells, substitutions, pipeline stages
and literal host invocations. Functions and sourced files share their shell
instance and receive paired enter/return/leave events. A host invocation is a
command scope, not an implicit shell EOF. Pipeline shell stages have their own
termination boundary. Resource release is distinct from the `exit` event.

Builtin contexts contain display arguments and their immutable canonical
`ShellValue` arguments. Deferred implementations must retain the canonical value,
not reconstruct bytes from display strings. `accountSource` admits retained
source against the shared cumulative source budget. `evaluate` charges evaluated
source again, shares command/loop/output budgets, bounds evaluation depth and
preserves byte-valued lexical source. Its optional name labels syntax diagnostics.
It does not create a new process, filesystem or unbounded evaluator.

Contexts expose borrowed byte streams, the execution signal, opaque scope
identity, variable lookup, diagnostics and cleanup registration. They do not
expose Runtime or mutable State. `registerCleanup` must precede acquisition;
callbacks are memoized and also registered with invocation cleanup. Scope release
awaits registered teardown. Aborted execution is not successful termination, and
root cancellation takes precedence over lifecycle status or cleanup failures.
Uncooperative trusted host JavaScript is not forcibly stopped or sandboxed.

Events are `command`, `error`, `exit`, `function-enter`, `function-return`,
`function-leave`, `source-enter`, `source-return` and `source-leave`. A command
event may request skipping the command or returning a validated status from the
current function/source. Other event controls are rejected. Hook evaluation
preserves the interrupted status unless it requests shell control flow.

This interface does not yet provide declaration attributes, mutable scalar/array
bindings or descriptor acquisition for subsequent extensions. No unrelated
builtin or parser feature is implied by opting into one extension.
