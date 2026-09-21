# Providers Rust

Choose authentication providers and API shapes through a reusable Rust core with
no npm runtime dependencies. Provider metadata stays declarative; credential
stores and interactive secret prompts are supplied by your application.

- List Poe, Anthropic, OpenAI and Cloudflare AI Gateway providers.
- Match API shapes in the agent's preference order.
- Reject duplicate provider identities and shared credential storage keys.
- Resolve explicit keys, own environment variables and stored credentials.
- Support preferred login callbacks, interactive prompts and read-only store access.

```typescript
import { ProviderRegistry, allAuthProviders } from '@poe-code/providers-rust';

const registry = new ProviderRegistry(allAuthProviders, provider => secretStore(provider), {
  envVars: process.env,
});
const available = registry.forAgent({
  id: 'codex',
  apiShapes: ['openai-responses', 'openai-chat-completions'],
});
const key = await registry.resolveCredential('openai', {}, { readOnly: true });
```

Explicit credentials take priority over environment values, followed by stored
credentials. Environment lookup uses own properties; inherited values are ignored.
Login can use a preferred authentication callback or your `promptForSecret` callback.
Credential stores retain their identity and error causes. Whitespace trimming for
primitive strings uses Rust's ECMAScript rules; opaque host trimming methods remain
host effects.

Each provider has one declarative definition. Identity comes from its filename;
registry exports and catalog entries are generated automatically. Provider routing
uses API shape metadata without branching on individual provider IDs. Catalog
objects and their auth, shape and environment metadata are frozen. Custom registry
collections retain caller provider references and snapshot their construction order.
API shape selection preserves getter order, custom array methods and iterator
cleanup; rejected callback values are released during native iteration.

This private, additive package exposes the original public runtime exports and
structurally compatible public methods. Original classes with private TypeScript
members retain their nominal class identity. Existing consumers remain unchanged.
Current native artifact checks cover macOS arm64; other platforms and Python
bindings remain pending. Small registry/credential operations are slower than the
TypeScript reference in the current mocked benchmark. The bounded-heap iterator
checks establish finite retention coverage, not general memory superiority.
