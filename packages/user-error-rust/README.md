# @poe-code/user-error-rust

Represent recoverable agent errors in Rust and Node without runtime npm dependencies.
This private additive package preserves the existing `UserError` and `isUserError`
TypeScript APIs and provides a standard Rust error type for future native agents.

```ts
import {UserError,isUserError} from '@poe-code/user-error-rust';
const error=new UserError('No API key found.',{
 hint:'Create a key at https://poe.com/api_key',
 cause:new Error('Credential lookup failed')
});
if(isUserError(error))console.log(error.message,error.hint);
```

| Capability | API |
| --- | --- |
| Recovery guidance and native error causes | `UserError(message, {hint, cause})` |
| Cross-bundle recognition | `isUserError(error)` |
| Rust errors with owned hints and typed source chains | `UserError::new`, `with_hint`, `with_cause` |

The Rust core uses only the standard library. Node supplies its own Error object,
stack trace, arbitrary cause and realm identity. The native taxonomy is loaded once;
construction and classification do not copy messages or causes across Node-API.
Causes remain visible to JavaScript GC, including cycles. Rust errors implement
`std::error::Error`, `Display`, `Send` and `Sync` and release their cause with the owner.

Existing applications keep using the original package. Supported-platform artifacts
and the full agent rewrite are still in progress; this package makes no speed or
memory improvement claim over the original Node Error adapter.
