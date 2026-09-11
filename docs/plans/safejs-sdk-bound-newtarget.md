# SDK-created bound constructor identity

The Function prototype fallback used the same outdated invocation convention
as SDK Reflect: newTarget was supplied only through context, not the explicit
argument read by invokeBuiltinClosure. Two failing tests reproduce loss of
constructor identity through one and two SDK-created bindings. Bound argument
values remain intact. A default-newTarget substitution control already passes.

Forward the existing newTarget value as the helper's explicit seventh argument.
Do not change guest call semantics or the bound-target substitution rule.

Run the new file, existing binding/bound snapshot/function prototype tests, and
Reflect tests, plus package TypeScript and scoped ESLint. Update the README for
the tested SDK behavior. This is focused verification, not a full package gate.
Other SDK adapters and host data-copy boundaries remain audit work.
Pushes and releases remain paused.

Verification: 118 tests passed across five selected files, including all three
new SDK binding cases.
