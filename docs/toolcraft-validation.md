# Toolcraft validation and defaults

Schema validation accepts an explicit default policy:

```ts
import { S, validate } from "toolcraft/schema";

const schema = S.Object({ count: S.Optional(S.Number({ default: 2 })) });
const result = validate(schema, {}, { defaults: "none" });
```

The example returns `{ ok: true, value: {} }` rather than inserting `count`.

| `defaults` option | Behavior |
| --- | --- |
| `"optional"` | The existing default policy: apply defaults for missing or explicitly undefined optional values. |
| `"all"` | Also apply defaults for missing non-optional members. Explicit undefined non-optional values are still validated as supplied values. |
| `"none"` | Validate supplied values without inserting defaults. Missing optional members remain absent; missing required members still fail. |

The policy propagates through objects, arrays, records, and selected union/discriminator branches. It does not disable type or constraint validation. A parent's default is not merged into an explicitly supplied partial object.

## Applied SDK and MCP defaults

Ordinary and streaming SDK/MCP calls validate a default when they actually apply it. For example, if an externally modified numeric default exceeds its declared maximum, invocation rejects before the handler runs. SDK calls reject with `UserError`; MCP calls and stream subscriptions report invalid parameters (`-32602`). Diagnostics identify the parameter whose default is invalid and its first schema issue.

Defaults are schema-native values, not caller-cased arguments. Validation uses the original schema before surface filtering, preserving canonical field names and existing scoped default contents. Supplied arguments still follow the selected surface's casing and scope rules.

An applied object default keeps its existing contents. Validation does not inject further optional defaults into that object, remove explicitly undefined optional members, or reject an unused nested default. A supplied value that overrides a descriptor default does not cause the unused default to be validated.

Existing default-copy behavior remains: ordinary data containers are isolated per invocation, while permitted opaque additional-property values retain their identities. Validating a default is not a deep clone of arbitrary application resources, and it does not change how CLI object containers collect or apply defaults.
