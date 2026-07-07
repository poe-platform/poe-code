# Drop uri-template + uri-template-lite: own RFC 6570 implementation

Replace `uri-template` and `uri-template-lite` in `tiny-stdio-mcp-server` with our own RFC 6570 implementation. Companion to `docs/plans/tiny-mcp-drop-ajv-own-json-schema-validator.md`; together they make the package dependency-free.

## Current usage (all in `src/server.ts`)

- `assertReadableUriTemplate` (line 889): parses the template, then expands it with a Proxy returning `"value"` for every variable to check the result is a valid URI — a workaround for not having direct syntax validation.
- `resourceTemplate` registration (line 640): `new UriTemplate(definition.uriTemplate)` with the result discarded — parse-check only.
- `matchesUriTemplate` (line 947): boolean match of a concrete URI against a template, used by `resources/read` to find a template-backed resource.

## Compliance target

Full RFC 6570, all four levels:

- Operators: simple `{var}`, reserved `{+var}`, fragment `{#var}`, label `{.var}`, path `{/var}`, path-style `{;var}`, form `{?var}`, form continuation `{&var}`.
- Modifiers: prefix `{var:n}` and explode `{var*}`, including combinations with every operator.
- Value types: string, list, associative array; undefined/empty handling per operator as specified.
- Percent-encoding per operator class (unreserved-only vs reserved+unreserved), UTF-8 based.
- Syntax errors (bad operator, bad varname, bad modifier, unclosed expression) throw at parse time — replacing today's proxy-expand hack with real validation.

Matching is not defined by RFC 6570; spec it explicitly: the template is parsed into literal and expression segments; literals must match the URI exactly; each expression captures the maximal span consistent with the following literal, honoring the operator's prefix character (`?`, `#`, `/`, …). Returns captured variables or `null`. No `RegExp` is constructed from template input. This must accept at least everything `uri-template-lite.match` accepted for our registered templates (interop/e2e tests are the regression gate).

## Compliance oracle

The official `uritemplate-test` suite (github.com/uri-templates/uritemplate-test):

- Vendor `spec-examples.json`, `spec-examples-by-section.json`, `extended-tests.json`, `negative-tests.json` into `packages/tiny-stdio-mcp-server/test/uritemplate-test/`, synced by a JS script recording the vendored commit.
- Expansion must pass 100%, including negative tests (parse/expand errors).
- Matching gets its own unit tests (round-trip: expand with known vars, then match recovers them) since the suite covers expansion only.

## API

New module `packages/tiny-stdio-mcp-server/src/uri-template.ts`:

```ts
parseUriTemplate(template: string): UriTemplate  // throws on RFC 6570 syntax error
UriTemplate.expand(vars: Record<string, string | string[] | Record<string, string>>): string
UriTemplate.match(uri: string): Record<string, string> | null
```

It lives in `tiny-stdio-mcp-server` (single consumer, keeps the package self-contained); promote to its own package only if a second consumer appears.

## Changes

1. TDD `src/uri-template.ts` against the vendored suite + matching unit tests.
2. `src/server.ts`: `assertReadableUriTemplate` becomes `parseUriTemplate` (syntax validation is now direct — drop the Proxy expand); registration keeps one parsed instance instead of the discarded `new UriTemplate(...)`; `matchesUriTemplate` uses `.match(uri) !== null`.
3. Delete `src/uri-template-lite.d.ts`; drop `uri-template` and `uri-template-lite` from `packages/tiny-stdio-mcp-server/package.json` and their mirrors in root `package.json` and `packages/toolcraft/package.json`. Run package-lint; update lockfile.
4. Official-SDK interop tests and e2e suite must pass unchanged.
