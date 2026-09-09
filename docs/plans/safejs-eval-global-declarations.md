# Indirect eval global declarations

## Evidence and oracle limits

Initial comparisons show global var/function declarations falling through to
the missing-function-boundary error. Descriptor, visibility, deletion, closure
capture and block-function cases fail; strict isolation and lexical non-leakage
controls pass.

Two native-oracle distinctions were checked explicitly:

- A configurable, non-writable global property is replaced by an eval function
  in an ordinary standalone Node global, with writable/enumerable/configurable
  all true. Node's contextified vm global leaves the old property instead. The
  maintained test uses the standalone result and the global binding algorithm.
- Both ordinary Node 22 and node:vm create an earlier var before rejecting a
  non-configurable, non-writable global function binding. ECMAScript's
  EvalDeclarationInstantiation checks function definability before creating
  variables. The maintained test explicitly documents this engine/spec
  difference and asserts the normative preflight behavior, not native agreement.

Sources:

- https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-candeclareglobalfunction
- https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-createglobalfunctionbinding
- https://tc39.es/ecma262/multipage/global-object.html#sec-evaldeclarationinstantiation

## Implementation

Global eval var declarations create configurable, writable, enumerable own
properties only when no own property exists. Function declarations validate
global property permissions before hoisting; replace configurable properties
with standard attributes; and retain attributes of permitted non-configurable
properties. Local function declarations still use their variable environment,
with retained-binding accounting preserved. Existing global var initializers
continue through the normal guest assignment path.

## Verification and remaining work

- Initial scoped runtime/function/scope selection: 60 passes.
- Expanded global/declaration/scope/recovery selection: 90 passes, including
  restored global var state and a global function retaining eval-local state.
- TypeScript and focused production lint pass.
- Final test-file lint and whitespace checks pass.

A follow-up direct runtime probe validates a remaining declaration-execution
bug: `function fresh(){};fresh=9;fresh` inside either direct or indirect sloppy
eval should return 9, but the guest throws TypeError for a const binding.
The declaration execution fallback creates an eval-local const after preflight
already installed the variable-environment function. This needs a regression
test and repair next; passing creation/recovery tests do not cover reassignment.

Global Annex B edge cases, accessors, non-extensible globals and broader eval
integration still need coverage. This is not complete JavaScript conformance.
Work remains uncommitted with the larger eval implementation; no push or release.
