# toolcraft-schema-rust

Validate JSON with an independent Rust schema compiler and native Node bindings.
The addon ships inside the package with zero external npm runtime dependencies.
The reusable core depends only on the standard library and our JSON primitives.
This private package is an additive implementation checkpoint.

| Capability       | Available behavior                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Types and values | Boolean schemas, JSON types, `const`, `enum`, numeric bounds and multiples                                      |
| Strings          | Unicode scalar length, including preserved lone UTF-16 surrogates                                               |
| Objects          | Properties, required fields, dependencies, property names and additional properties                             |
| Arrays           | Draft-specific tuples, item schemas, contains counts and uniqueness                                             |
| Composition      | `allOf`, `anyOf`, `oneOf`, `not`, conditionals and unevaluated members                                          |
| References       | Resource IDs, local/remote registry pointers, anchors, dynamic/recursive references and draft-7 `$ref` siblings |
| Vocabularies     | Registered metadata controls validation keywords while retaining applicators                                    |
| Diagnostics      | Structured issue paths, messages, keywords and formatted summaries                                              |

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

The default dialect is 2020-12. Declare draft 7 with `$schema` when needed.
Equality retains the existing compiler's signed-zero behavior. Diagnostic paths
support lone surrogates even where the TypeScript compiler's URI scanner throws.
Graph depth, node count, evaluation calls and diagnostic count are bounded.

Supply offline resources with `compileJsonSchema(schema, { registry: { [uri]: schema } })`.
References never fetch from the network. Relative resource IDs resolve against their
retrieval or declared base; parent pointers can cross nested resource boundaries.

Full schema compatibility is still in progress. Patterns, custom formats,
the fluent schema DSL, and arbitrary non-JSON host values remain pending. Known
unfinished constraints fail at compilation rather than being silently ignored;
unregistered `format` remains an annotation. Current ingress requires JSON values.
Keep existing applications on `toolcraft-schema` until the full conformance gates
and native distribution checks are complete.
Schema URI resolution covers hierarchical/opaque bases and common Node URL
normalization. Full WHATWG URL and Unicode host/IDNA conformance remain pending.
