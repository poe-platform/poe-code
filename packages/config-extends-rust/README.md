# config-extends-rust

Compose owned configuration from highest to lowest priority, with provenance
for every resolved field. Nested objects fill missing values, arrays replace,
nulls delete, and empty prompts inherit from lower-priority layers.

The Node adapter currently exposes `parseDocument` and `mergeLayers` with
TypeScript declarations and a self-contained napi-rs addon. It needs no npm
runtime dependencies. Existing package tests check both functions against the
current TypeScript SDK, including observable getter ordering, sparse/custom
array maps, opaque value identity and safe prototype-named keys.
Ordinary records and dense arrays use one binary snapshot/native call. Getters,
proxies and custom array behavior use foreign handles so observable operations
stay in JavaScript. Recursive foreign array mapping is capped at 32; ordinary
snapshots support depth 256 and deeper object merges use the iterative handle path.

```typescript
import {parseDocument, mergeLayers} from '@poe-code/config-extends-rust';

const document = parseDocument('---\ntitle: Demo\n---\nWrite a review', 'review.md');
const resolved = mergeLayers([
  {source: 'document', data: document.data},
  {source: 'defaults', data: {model: 'default'}}
]);
```

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

`discover::find_base` searches each configured directory in `.md`, `.yaml`,
`.yml`, `.json` order. Its host validates containment before reading and reports
missing reads separately from errors. `resolve::resolve` combines one document
with overrides, fallback data and inherited bases, loads Markdown partials,
composes prompts and renders an optional owned template graph. It records every
document and partial in the returned chain and limits extends depth to five.
Supply a `resolve::Host` for platform paths and in-memory or real filesystem I/O.
Host errors are returned intact through `discover::Error::Host`.
`resolve::prepare` returns the ordered document/base layers before data merging.
Foreign adapters can inspect their original data layers at the final merge stage
without discarding lower object candidates. Hosts can admit runtime values and
render runtime views; the default capabilities use the own parser and template engine.
Discovery and resolution return standard Rust futures. Host reads and canonical
path lookups may suspend; use your runtime to await them. The core adds no async
runtime dependency and does not replay earlier work when a read resumes.

`prompt_document::resolve_prompt_document` adds rooted document paths, symlink
containment, absolute base directories, in-memory base-document overlays and
optional missing-document inheritance. It returns both the composed template
and rendered prompt, plus metadata, provenance and source files. Supply a
`prompt_document::Host` with canonical path lookup; missing paths use the owned
core's policy errors rather than retaining an absent host exception object.

The core uses the standard library and own path crates. Merging and cloning use
explicit work stacks with a depth bound of 1,000. This additive package currently
provides owned merging, async rooted document resolution, templates and portable
foreign-handle merge decisions. Async Node resolution and Python adapters remain
in progress; existing TypeScript packages and production imports are unchanged.
