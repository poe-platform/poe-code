# agent-human-in-loop-rust

Add human approval to an operation using native request/result policies and
compatible Node providers. This private additive package keeps the existing
JavaScript implementation available during migration.

| API | Purpose |
| --- | --- |
| `requestApproval` | Validate a request, call its provider and normalize the result |
| `osascriptProvider` | Ask for approval in macOS, optionally collecting a decline reason |
| `mockProvider` | Supply fixed or asynchronous answers for application tests |

```ts
import { requestApproval, osascriptProvider } from "@poe-code/agent-human-in-loop-rust";

const result = await requestApproval({
  provider: osascriptProvider({ title: "Review deployment" }),
  message: "Deploy the reviewed revision?",
  declineInputPrompt: "What needs to change?"
});
```

Rust owns normalization, response parsing, script selection and process-error
policy. Node retains process execution, callbacks, getter order, promise timing
and JavaScript string methods, preserving lone UTF-16 surrogates and custom methods.
The package has no npm runtime dependencies. The macOS provider needs `osascript`;
it does not launch a dialog until called. Native platform distribution and broader
Toolcraft replacement qualification remain separate gates.
