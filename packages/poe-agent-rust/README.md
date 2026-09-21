# Poe Agent Rust

Resolve plugin-provided models with an independent Rust core and no npm runtime dependencies. Providers register through plugins; matching runs in order and stops at the first supported model.

- Collect provider registrations and report name collisions with both contributors.
- Preserve provider/callback identity and opaque plugin options.
- Wrap support-check failures with the model, provider names and original cause.
- Validate tool names with an ASCII scanner, without a regular-expression engine.

```typescript
import { collectProviders, resolveProvider } from '@poe-code/poe-agent-rust';

const providers = collectProviders(plugins);
const provider = resolveProvider(providers, 'openai/gpt-5');
const model = await provider.createModel('openai/gpt-5', context);
```

This private experimental package currently provides runtime foundations. Agent builders, sessions, iteration/tool execution, built-in plugins and transcript persistence are still being implemented. Existing consumers retain `@poe-code/poe-agent`. Shipped declarations describe supported APIs and their structural contracts only. Native artifact checks currently cover macOS arm64; additional platforms and Python bindings remain pending. Small Node-to-Rust calls can be slower than the original TypeScript implementation.
