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

This additive package currently exposes the Rust core only. napi-rs/TypeScript
bindings, symlink bridging, overlapping-run ownership and cleanup, Python adapters,
full malformed-input fidelity and cross-platform packaging remain in progress.
Existing applications continue to use the original TypeScript package.
