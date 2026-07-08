# Drop ajv: own JSON Schema validator in toolcraft-schema

Replace ajv in `tiny-stdio-mcp-server` with our own **fully compliant** JSON Schema validator living in `toolcraft-schema`. Removes ajv (and its transitive deps) from `tiny-stdio-mcp-server`, root, and `toolcraft`.

## Compliance target

Full JSON Schema compliance — no keyword left out. A schema a spec-compliant validator accepts must behave identically here.

- Dialects: draft 2020-12 (MCP's dialect, default) and draft-07, selected by `$schema`, each with its own semantics (`items`/`prefixItems`, `dependencies` vs `dependentSchemas`/`dependentRequired`, etc.).
- All core + validation + applicator vocabularies: boolean schemas, type unions, `const`, `multipleOf`, `exclusiveMinimum`/`exclusiveMaximum`, `uniqueItems`, `contains`/`minContains`/`maxContains`, `prefixItems`, `patternProperties`, `propertyNames`, `minProperties`/`maxProperties`, `allOf`/`anyOf`/`oneOf`/`not`, `if`/`then`/`else`, annotation-driven `unevaluatedProperties`/`unevaluatedItems`.
- References: `$ref`, `$defs`, `$id`, `$anchor`, `$dynamicRef`/`$dynamicAnchor` (and draft-07 `definitions`/`$recursiveRef` forms). Resolution is document-local plus an optional preloaded schema registry passed to `compileJsonSchema`. No network fetching ever; an unresolvable ref is a compile-time error.
- `format`: annotation-only, per the spec default (the format-assertion vocabulary is not enabled; matches current ajv-without-ajv-formats behavior).
- `pattern`/`patternProperties` compile via `new RegExp(source, "u")` at compile time; invalid pattern = compile-time error.

## Compliance oracle

The official JSON-Schema-Test-Suite is the acceptance test:

- Vendor `tests/draft2020-12` and `tests/draft7` (plus the `remotes/` fixtures) into `packages/toolcraft-schema/test/json-schema-test-suite/`, synced by a JS script recording the vendored commit.
- Required tests must pass 100% for both drafts. `refRemote` tests run with the remote fixtures preloaded into the registry (no network).
- `optional/` tests (format assertion, bignum, ecmascript-regex edge dialects, …) are excluded from the gate.
- One vitest file drives the whole suite; per-case failures report suite path + description.

## API

New `packages/toolcraft-schema/src/json-schema/` module:

```ts
compileJsonSchema(schema: unknown, options?: { registry?: Record<string, unknown> }): CompiledJsonSchema
// throws on malformed schema, invalid pattern, unresolvable $ref

CompiledJsonSchema.validate(value: unknown): ValidationResult<unknown>
// reuses ValidationIssue { path, expected, received, message } from validate.ts
```

Plus `formatIssues(issues): string` producing the `errorsText()`-style joined message used in `Invalid tool arguments: ...` / `Invalid structured tool result: ...`.

## Changes

1. `toolcraft-schema`: implement `src/json-schema/` TDD — unit tests per keyword first, official suite as the final gate.
2. `tiny-stdio-mcp-server`: swap `ajv` → `toolcraft-schema` in `src/server.ts` (compile at register, validate on call/result); dependency `ajv` → `toolcraft-schema`. Existing official-SDK interop tests and e2e suite must pass unchanged.
3. Root `package.json` + `packages/toolcraft/package.json`: drop mirrored `ajv`; ensure `toolcraft-schema` is in each bundle set (root bundles tiny-stdio-mcp-server; toolcraft already bundles toolcraft-schema). Run package-lint.
4. Error-message parity: keep the `Invalid tool arguments:` / `Invalid structured tool result:` prefixes; bodies come from `formatIssues`.

## Out of scope

`uri-template` / `uri-template-lite` removal — see `docs/plans/tiny-mcp-drop-uri-template-own-rfc6570.md`.
