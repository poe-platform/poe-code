# agent-hook-config-rust

Translate coding-agent hooks while preserving user-authored configuration.
The portable Rust core derives paths, hook events, handler types and placeholder
rules from the agent catalog's declarative definitions. It needs only the standard
library and own path crates.

| Capability | API |
| --- | --- |
| Supported agents, aliases and transform pairs | `Catalog` |
| Event, handler and placeholder rules | `event_mappings`, `handler_rules`, `placeholder_rewrites` |
| Ordered transformation, drops and stable generated IDs | `transform_hooks` |
| Parsed hook records with original handler fields | `files::read_settings` |
| Preserve user handlers and replace generated handlers | `files::mutate_file` |
| Check whether an existing file is fully generated | `files::is_fully_generated` |
| Portable home and scope decisions | `paths::plan_hook_path` |
| Read selected scopes and atomically write hook files | `io::read_hooks`, `io::write_hooks` |
| Link same-format hooks with generated-file rollback | `links::symlink_hooks` |
| Own overlapping runs, rollback and selective cleanup | `bridge::Bridge` |

```rust
use agent_hook_config_rust::Catalog;

let catalog = Catalog::builtins().expect("valid agent definitions");
let source = "claude".encode_utf16().collect::<Vec<_>>();
let target = "codex".encode_utf16().collect::<Vec<_>>();
let mappings = catalog.event_mappings(&source, &target).expect("known agents");
assert!(mappings.iter().any(|mapping| mapping.target_event.is_some()));
```

Transformations replace project/plugin placeholders, retain matcher and handler
ordering, and record each unsupported source by its input index. File mutations
retain unrelated fields and user handlers, distinguish missing and empty matchers,
and validate generated markers and finite timeouts before writing.

Supply an `io::FileHost` for platform paths and filesystem operations. Reading
checks final settings-file symlinks and preserves user-before-project ordering.
Writing creates temporary files exclusively, retries existing temporary paths,
renames atomically, and cleans temporary files after failed writes or renames.
Existing malformed JSON is reported before incoming entry validation. Parsed
JSON is bounded at 16 MiB, 128 levels and 262,144 values. File formatting preserves
JavaScript numeric-key enumeration and source string escapes.

Text uses UTF-16 to retain JavaScript source values, including lone surrogates.
`Catalog::resolve_normalized` expects ECMAScript-trimmed lowercase lookup input;
mapping and transformation functions resolve ordinary aliases case-insensitively.

The independent Node workspace provides `getAgentConfig`, `resolveAgentSupport`,
`supportedHookAgents`, `supportedTransformPairs`, `formatSupportedTransformPairs`,
`isTransformSupported`, `resolveHookPath`, event/handler/placeholder rules,
`transformHooks`, `readClaudeHooks`, `writeCodexHooks`, `symlinkHooks`,
`bridgeHooks`, and `cleanupBridgedHooks`. The napi-rs addon and
own host adapters have no npm runtime, peer or optional dependencies.

```typescript
import { transformHooks } from '@poe-code/agent-hook-config-rust';

const result = transformHooks([
  { event: 'PreToolUse', matcher: 'Bash', handler: {
    type: 'command', command: '${CLAUDE_PROJECT_DIR}/check'
  } }
], 'claude', 'codex', { runId: 'check' });
```

Drop records retain the original source object. Read handlers retain unknown JSON
fields, and missing and explicit null read matchers remain distinct. Transfer
metadata is bounded at 128 levels and 262,144 values; filesystem documents use
the own Rust parser. Development tests cross-check the existing SDK in memory.

Same-format symlink bridging refuses user files, checks parent traversal twice,
uses exclusive restoration after replacement failure, and retains both errors
when restoration also fails.

The initial Node transformation bridge is slower than the existing SDK for small
hooks. It remains experimental. Bridge manifests retain independent ownership for
overlapping runs, including callers using the same run ID. Cleanup removes owned
generated handlers and Git exclude blocks, preserves user handlers and existing
empty groups, and is idempotent for the original manifest. Failed preparation
releases ownership; recursive filesystem callback entry is rejected.

Python adapters, getter-stage/malformed-input fidelity and cross-platform
packaging remain in progress. Existing applications continue to use the original
TypeScript package.
