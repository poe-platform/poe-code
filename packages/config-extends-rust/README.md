# config-extends-rust

Compose owned configuration from highest to lowest priority, with provenance
for every resolved field. Nested objects fill missing values, arrays replace,
nulls delete, and empty prompts inherit from lower-priority layers.

```rust
use config_extends_rust::{Layer, merge_layers};
use config_mutations_rust::value::Value;

let layer = Layer {
    source: "local".encode_utf16().collect(),
    data: Value::Object(vec![
        ("count".encode_utf16().collect(), Value::Number(2.0))
    ]),
};
let resolved = merge_layers(&[layer]).expect("valid layers");
assert_eq!(resolved.sources.len(), 1);
```

`prompt::compose_prompts` combines document and base prompts through a single
`{{yield}}` per prompt, records consumed base layers, and rejects unresolved
tokens. UTF-16 values preserve JavaScript source text, including lone surrogates;
provenance paths escape literal dots and backslashes.

`document::parse_document` admits Markdown, YAML and JSON, strips a leading BOM,
extracts and validates `extends`, and retains Date/Symbol alias metadata when
Markdown body text replaces a metadata prompt. Supply the platform's absolute
path predicate; document parsing does not read files. The extension argument is
the already normalized lowercase extension. YAML diagnostics use the own parser;
JSON diagnostics and bounded parsing differ from Node's engine-specific messages.

The core uses the standard library and own path crates. Merging and cloning use
explicit work stacks with a depth bound of 1,000. This additive package currently
provides the owned Rust merge/prompt/document core. Document resolution, filesystem
adapters, JavaScript graph behavior and Node/Python bindings are still in
progress; existing TypeScript packages and production imports are unchanged.
