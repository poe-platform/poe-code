# toolcraft-schema-rust

Validate JSON with an independent Rust schema compiler and native Node bindings.
The addon ships inside the package with zero external npm runtime dependencies.
The reusable core depends only on the standard library and our JSON primitives.
This private package is an additive implementation checkpoint.

| Capability       | Available behavior                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Types and values | Boolean schemas, JSON types, `const`, `enum`, numeric bounds and multiples                                      |
| Strings          | Unicode scalar length and bounded Unicode-mode patterns, including preserved lone UTF-16 surrogates             |
| Objects          | Properties, required fields, dependencies, property names and additional properties                             |
| Arrays           | Draft-specific tuples, item schemas, contains counts and uniqueness                                             |
| Composition      | `allOf`, `anyOf`, `oneOf`, `not`, conditionals and unevaluated members                                          |
| References       | Resource IDs, local/remote registry pointers, anchors, dynamic/recursive references and draft-7 `$ref` siblings |
| Vocabularies     | Registered metadata controls validation keywords while retaining applicators                                    |
| Formats          | Explicit custom validators, snapshotted registrations, synchronous errors and reentrant validation              |
| Diagnostics      | Structured issue paths, messages, keywords and formatted summaries                                              |
| Host values      | JSON admission with node/depth budgets; default cloning with cycles, sparse arrays and resource identity        |
| DSL validation   | Every descriptor kind, default modes, union selection, host callbacks and structured diagnostics                 |

```ts
import { compileJsonSchema, formatIssues } from "toolcraft-schema-rust";

const validate = compileJsonSchema({
  type: "object",
  properties: { message: { type: "string", minLength: 1 } },
  required: ["message"],
  additionalProperties: false
});

const result = validate.validate({ message: "Hello" });
if (!result.ok) console.error(formatIssues(result.issues));
```

Successful validation returns the original caller value. Compiled schemas own
their Rust graph, so later edits to the source schema do not change validation.
Input copying rejects accessors, serialization hooks, cycles and sparse arrays
without executing getters or hooks. It preserves own UTF-16 names and strings.
Graphs retain each child schema once rather than copying subtrees at every node.

Use `isJsonValue(value, { maxNodes, maxDepth })` to check JSON safety without
executing getters or serialization hooks. Defaults are 10,000 nodes and depth 64;
explicit `Infinity` removes either budget. Repeated references consume the node
budget each time, and ancestor cycles are rejected.

Use `cloneDefaultValue(value)` to isolate plain object and array containers while
preserving cycles, shared references, sparse slots and null prototypes. Functions
and opaque resources retain identity. Enumerable getters run once in depth-first
order, and thrown values propagate unchanged. Both utilities use iterative Rust
traversal with host property operations and work independently of the compiler.

`validate(descriptor, value, { defaults })` accepts the existing schema descriptor
shapes, including objects, records, arrays, optional values, unions and tagged
unions. The default mode is `"optional"`; `"none"` omits defaults and `"all"` also
applies defaults to missing required properties. Present `undefined` stays distinct
from an absent required property. Output objects safely retain keys such as
`__proto__`, and optional array slots become dense output slots.

The validator preserves live schema/value getters, resource identities, custom
array methods, native-schema callbacks and arbitrary thrown values. Traversal and
JSON constraint comparison are iterative. A depth guard at 16,384 prevents cyclic
descriptors from hanging and throws `RangeError`; its threshold is intentionally
independent of a JavaScript engine's stack size. Matching engine-specific resource
exhaustion behavior remains a replacement qualification item.

The default dialect is 2020-12. Declare draft 7 with `$schema` when needed.
Equality retains the existing compiler's signed-zero behavior. Diagnostic paths
support lone surrogates even where the TypeScript compiler's URI scanner throws.
Graph depth, node count, evaluation calls and diagnostic count are bounded.

Supply offline resources with `compileJsonSchema(schema, { registry: { [uri]: schema } })`.
References never fetch from the network. Relative resource IDs resolve against their
retrieval or declared base; parent pointers can cross nested resource boundaries.

Use `normalizeLegacyNullability(schema)` before compilation for legacy schemas
with `nullable: true`. The Rust normalizer creates a null alternative, preserves
resource identities and annotations, and rewrites in-document pointer references
when their targets move. The source schema remains unchanged; annotation objects
such as defaults are copied without being interpreted as child schemas.

Patterns support classes/ranges, alternation, groups, repetition, lookahead,
word boundaries and Unicode general categories using bundled Unicode 17 data.
Pattern compilation, evaluation work and retained matcher states are bounded.
Backreferences, lookbehind, named groups, script properties and most binary
Unicode properties remain pending and fail explicitly at compilation.

Register formats with `compileJsonSchema(schema, { formats: { name: value => boolean } })`.
Only `true` accepts a string; other instance types skip format checks. Callbacks
retain their original exception and may safely reenter validation. Unregistered
formats remain annotations. Registration getters are rejected without being called.
Native callbacks are borrowed only for a synchronous evaluation and are isolated
between worker environments. Rust callers inject validators through `ValidationOptions`.

Full schema compatibility is still in progress.
The fluent builders, Standard Schema adapters, JSON Schema conversion and compiler
support for arbitrary non-JSON host values remain pending. Validator declarations
currently reuse the original schema contract types. Known
unfinished constraints fail at compilation rather than being silently ignored;
unregistered `format` remains an annotation. Current ingress requires JSON values.
Keep existing applications on `toolcraft-schema` until the full conformance gates
and native distribution checks are complete.
Schema URI resolution covers hierarchical/opaque bases and common Node URL
normalization. Full WHATWG URL and Unicode host/IDNA conformance remain pending.
