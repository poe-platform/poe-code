# Foreign eval realms

Baseline `870563dec`: three native differential cases confirmed that a foreign
eval function used its caller's global object. Normal identifier syntax,
indirect comma syntax and optional calls all returned `undefined:caller`
instead of `undefined:owner`. Caller lexical variables were already excluded.

The eval intrinsic now supplies its owning budget to the evaluation callback.
The interpreter captures each realm's global-scope context with a weak budget
key, then selects that owner context for foreign eval. Same-realm calls retain
the existing direct/indirect rules. The stored scope excludes both owner-script
and caller-script private lexical bindings. Non-string arguments still return
unchanged before requesting an execution context.

All 331 tests passed across 32 eval, snapshot, lifecycle and accounting files.
The new tests verify global writes and var declarations, owner/caller lexical
exclusion, owning TypeError prototypes, and independent replay of both realms.
Scoped lint and TypeScript passed. All 1,700 tests in the 127-file snapshot
suite passed. No full package gate, push, release, or issue closure.

The callback signature change in `values.ts` is separate from existing weak
collection work in that file; only the eval signature belongs to this change.

The maintained build completed 23 workspaces and passed four fresh-process
import checks. Three built-SDK probes verified normal identifier, indirect
comma, and optional foreign eval calls. A separate function-prototype audit
then reproduced eight failures for ordinary/arrow and async function creation,
with four passing generator controls. That red audit is not part of this fix
or its passing test counts.
