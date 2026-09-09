# Proxy member deletion in the interpreter

Five tests fail on 86c0645df (81872): strict and sloppy refusal, nested symbol
deletion, revocation and invocation of a guest-authored trap. The previous
Reflect implementation was not reached by delete expressions.

Dispatch Proxy member references through sandboxDeleteProperty with the active
budget and guest call context. Await its result and throw TypeError on refusal
in strict mode; return false in sloppy mode. Keep ordinary deletion synchronous
and preserve existing nullish, primitive, optional-member and super handling.

The focused validation includes these new interpreter tests, the Proxy deletion
matrix, ordinary value/primitive deletion, eval binding deletion and eval update
reference tests, followed by TypeScript and scoped lint.
The command (25637) completed successfully: 71 tests across six files,
TypeScript and scoped lint all passed.

Unqualified references resolved through a with object and array-method deletion
callbacks still require integration alongside Proxy HasProperty/Get/Set support.
The public constructor and snapshot support remain unfinished. This change is
not a full-package or JavaScript-conformance claim. Publication remains paused.
