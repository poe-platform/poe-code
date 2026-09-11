# Eval class-initializer syntax context

## Validated gap

Nine native comparisons produced six failures and three controls. Direct eval
of arguments inside instance fields, static fields, static blocks, and arrows
created by these initializers must throw SyntaxError. SafeJS instead attempted
binding lookup and threw ReferenceError. Eval returning an arrow that references
arguments also failed to reject the source. Ordinary nested functions retain
their own arguments, and new.target remains allowed with undefined value.

## Implementation

Carry a classInitializer marker in the function environment used by field/static
initialization. Direct eval passes the corresponding arguments restriction to
the existing eval parser. Arrows inherit the environment; ordinary functions
already replace it. Indirect eval does not inherit the restriction.

Serialize and validate the marker with closure/generator function environments,
and restore it for ordinary and asynchronous arrow state. Reject malformed
marker values and markers lacking a home object.

## Validation

- Runtime/parser/eval-source recovery selection: 73 passes.
- Four new low-level restored-arrow cases, malformed marker checks and existing
  source-validation/call-recovery selection: 28 passes.
- Class/private-element/super/constructor-recovery regression selection: 160
  passes. TypeScript, focused lint and whitespace checks pass.

The earlier non-extensible-global diagnostic did not establish a difference
from native Node, so no change was made on that evidence. Class-initializer
fixes remain part of the uncommitted eval work. No push, release or complete
JavaScript-conformance claim.
