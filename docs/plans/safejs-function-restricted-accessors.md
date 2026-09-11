# Restricted Function.prototype accessors

Native controls confirmed that reads and writes of Function.prototype.caller
and arguments throw TypeError. Guest reads returned undefined and writes
succeeded. Eight of ten regression cases failed before the repair; deletion
and explicit redefinition were passing controls.

Install both configurable, non-enumerable accessor properties with the same
guest throwing closure as all four getters/setters. Preserve the thrower's
empty name, zero length, non-configurable metadata, non-extensibility and
Function.prototype inheritance. Use existing accessor adapters and intrinsic
identity/retention registration rather than native accessor execution.

Validate runtime descriptors, inheritance, mutation controls, snapshots,
TypeScript and lint. This main-tree followup is outside the running frozen
integration candidate. It does not implement the separate legacy own caller/
arguments properties of non-strict function instances.

The initial implementation made the thrower's property table non-extensible
before assigning its prototype, and initialization correctly rejected that
ordering. Set its prototype first, then prevent extensions. The corrected
three-file runtime/function-property selection passes all 71 tests. The first
snapshot/accounting run loaded the initial ordering and failed initialization;
its terminal result is not evidence against the corrected ordering. A fresh
snapshot/accounting/history run is active, along with TypeScript and lint.

The corrected implementation passes the fresh 43-test snapshot/accounting/v6
history selection, for 114 focused tests total. TypeScript and focused lint pass.

A separate explicit strict-function probe still exposes a related gap:
Object.getOwnPropertyDescriptor(arguments, "callee") fails with "Native accessors
cannot execute in the sandbox". Native JavaScript returns the same shared
throwing getter/setter as these Function.prototype properties. The earlier
top-level arguments probe was invalid for the guest module scope and is not
evidence; the explicit function reproduction is. Complete that arguments
descriptor integration with its own failing tests, preserving per-realm identity
and snapshot restoration. This prototype repair alone is not full completion.

## Atomic isolation from dynamic constructors

The tests now obtain the intrinsic function prototype from an ordinary function,
rather than requiring the uncommitted Function global. All descriptor, invocation,
identity, mutation and recovery assertions remain. This enables independent
verification and delivery of the prototype restriction repair.

Against committed HEAD 8947de641 in the isolated source checkout, eight runtime
cases and both recovery cases fail; two controls pass (86650). Applying only the
16-line production addition to globals/function.ts passes all 83 checks across
the two new files and three existing function/recovery files (76507). A requested
nonexistent intrinsic-retention.test.ts path matched no file and is not counted;
the three actual retained-intrinsic suites pass all 18 tests separately (39172).

TypeScript and focused lint pass (session 5701, exit 0). The candidate was frozen at
`/tmp/safejs-reference-error-commit.1afxzl/checkout`; the proposed atomic index is
`/tmp/safejs-function-restrictions-commit.HE7BlN/index`. The larger dynamic/eval,
weak-collection and strict-arguments-descriptor changes are excluded. Re-stage
this plan before committing. No push or release. The exact isolated change has
101 passing tests across eight files and passes whitespace checks.
