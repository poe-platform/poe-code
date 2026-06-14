---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft improvements (vs Stainless / Speakeasy / Fern)

Improvements to `toolcraft`, `toolcraft-schema`, and `toolcraft-openapi` informed by reverse-engineering Stainless's config + generated SDK shape and contrasting with Speakeasy and Fern.

## 0. Competitive landscape

### Stainless (stainless.com)

Used to generate the OpenAI, Anthropic, Cloudflare, Google SDKs. Built by the team behind Stripe's codegen.

**Two-file model:** `stainless.yml` config + OpenAPI spec. The config is the source of truth for *shape*; OpenAPI is the source of truth for *wire*.

Config top-level keys (reverse-engineered from [docs.reference.config](https://www.stainless.com/docs/reference/config/)):

| Key                     | Purpose                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `edition`               | Versioned generator output (e.g. `2025-10-08`). Pins the surface; new edition = opt-in breaking changes.             |
| `organization`          | Display metadata: name, docs URL, contact, GitHub org, security contact.                                             |
| `resources`             | Tree of resources → `methods` (verb → `<http-method> <path>` shorthand), `models`, `subresources`. `$shared`, `$client`. |
| `environments`          | Named base URLs: `production`, `sandbox`, …                                                                          |
| `targets`               | Per-language emit config (`typescript`, `python`, `go`, `ruby`, `java`, `kotlin`, `php`, `csharp`, `terraform`, `cli`, `openapi`, `sql`). |
| `pagination`            | Named schemes (cursor, offset, page_number) with role-mapping for params and response fields.                        |
| `client_settings`       | `idempotency` header name; named auth `opts` with env var bindings.                                                  |
| `query_settings`        | `nested_format` (brackets), `array_format` (repeat, comma, brackets, indices).                                        |
| `streaming`             | Streaming response handling.                                                                                          |
| `security`/`security_schemes` | Overrides OpenAPI auth where the spec is wrong/incomplete.                                                      |
| `custom_casings`        | Initialism handling per-language (`API` vs `Api`).                                                                    |
| `readme`                | Example requests; seeds generated README + IDE hovers.                                                                |
| `unspecified_endpoints` | Explicit exclusion list (so omissions are intentional, not silent drift).                                             |

**SDK ergonomics shipped out of the box:** auto-pagination iterators, retries with exponential backoff, idempotency keys, environment selectors, streaming/SSE, raw response access (`.withResponse()`-style), typed error hierarchy keyed on HTTP status + error code, request hooks, polymorphic types, file uploads.

**Diagnostics catalog:** [docs.reference.diagnostics](https://www.stainless.com/docs/reference/diagnostics/) lists stable codes (e.g. `non_camelcase_property`) so config authors fix root causes instead of guessing. A language server gives in-editor feedback ([blog](https://www.stainless.com/blog/iterate-on-your-sdks-locally-with-the-stainless-language-server)).

**Distribution:** cloud-hosted, opens GitHub PRs against your SDK repos when the spec changes; you approve, they publish. 25+ runtime deps in generated TS SDKs.

### Speakeasy (speakeasy.com)

OpenAPI-only; no config DSL layer. Single runtime dep (Zod) for TS SDKs, runtime-validated. Standalone CLI binary — runs air-gapped, no vendor cloud. 10 languages. Custom code injection via overlays.

### Fern (buildwithfern.com)

Custom DSL like Stainless. Bundles SDK generation with API reference docs. Acquired by Postman, January 2026.

### Toolcraft today (this repo)

| Component           | What it does                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `toolcraft-schema`  | Zero-dep typed schema builder; emits JSON Schema via `toJsonSchema()`.                                                            |
| `toolcraft`         | `defineCommand` / `defineGroup` → CLI + MCP server + in-process SDK from one tree. Secrets, preconditions, human-in-loop, MCP proxy. |
| `toolcraft-openapi` | Reads an OpenAPI spec, emits `defineCommand` files grouped by noun. `--check` drift detection via `openapi.lock`. `bearerTokenAuth()` helper. |

**Differentiator no competitor has:** one definition → three surfaces *including MCP*. Stainless ships SDKs only (CLI is a target, MCP is not first-class); Speakeasy ships SDKs; Fern ships SDKs + docs. Toolcraft is the only one where the same node becomes a CLI subcommand, an MCP tool callable by an agent, and a typed in-process method. Plus framework-level human-in-loop approvals — none of the SDK generators have this.

**Differentiator we should embrace, not fight:** TypeScript-only, in-process, no cloud. Multi-language emit is Stainless's moat and a distraction for us.

## 1. What we're building

Six bundles of work. Each is independently shippable; order is roughly highest leverage first.

1. **Config layer (`toolcraft.yml`)** — interpose a thin, declarative config between an OpenAPI spec and emitted commands. Reshape resources, rename methods, exclude endpoints, declare pagination schemes, declare environments, declare auth opts. No regex. YAML parsed and deep-merged on regenerate (per `CLAUDE.md`).

2. **Pagination as a first-class concept** — declarative pagination schemes resolve to typed auto-paginating iterators on the generated SDK and to a `--paginate` flag on the CLI.

3. **Retries + idempotency** — config-driven retry policy with exponential backoff; per-command override. Idempotency-Key header injection for non-GET commands when a scheme is configured.

4. **Typed error hierarchy + raw response access** — generated commands throw structured errors (`HttpError` subclasses keyed by status + parsed error code). SDK callers can request the underlying `Response` and headers via an opt-in shape.

5. **Diagnostics catalog + drift UX** — replace ad-hoc warnings/throws with a stable code catalog (`TOOLCRAFT_OPENAPI_*`). `generate --check` and `generate` print actionable diagnostics with the code, the spec location, and the fix.

6. **Examples + MCP tool descriptions** — config-declared examples flow into CLI `--help`, MCP tool descriptions, and SDK JSDoc. Agents pick the right tool because the description carries an example, not just a path.

### Non-goals

- Multi-language code generation. We stay TypeScript-only.
- Replacing Stainless. We are not trying to publish polished public SDKs for third parties.
- A hosted service. Everything runs locally, including `--check`.
- Streaming/SSE. Defer until a concrete consumer needs it; the current shape returns parsed JSON and that is enough for every existing call site.
- File uploads / multipart. Defer; orthogonal to the above bundles.
- Polymorphic discriminated-union responses beyond what `toolcraft-schema` already supports via `oneOf`.
- A language server. The diagnostics catalog gives us 80% of the value without one.
- Renaming or restructuring `defineCommand` / `defineGroup`. These are stable.

## 2. User-facing shape

### 2.1 `toolcraft.yml` next to `openapi.json`

```yaml
# toolcraft.yml
edition: 2026-05-16

environments:
  production: https://api.example.com/v1
  sandbox:    https://sandbox.example.com/v1

client_settings:
  idempotency_header: Idempotency-Key
  auth:
    bearer:
      env: EXAMPLE_API_TOKEN

pagination:
  cursor:
    request:  { cursor: cursor, limit: limit }
    response: { items: data, next_cursor: meta.next_cursor }

retries:
  max: 3
  backoff: exponential
  retry_on: [429, 502, 503, 504]

resources:
  messages:
    methods:
      list:    get  /messages       { pagination: cursor }
      create:  post /messages       { idempotent: true }
      get:     get  /messages/{id}
      delete:  delete /messages/{id}
  threads:
    subresources:
      messages:
        methods:
          list: get /threads/{thread_id}/messages { pagination: cursor }

unspecified_endpoints:
  - get /internal/health
  - post /internal/replay
```

Everything in this file is optional. With no `toolcraft.yml`, the existing OpenAPI-only behavior is unchanged.

### 2.2 Generated SDK shape

```ts
import { defineClientFromSpec } from "toolcraft-openapi";

const client = await defineClientFromSpec("openapi.json", {
  environment: "sandbox",
  services: { tokenSource },
});

// Auto-pagination iterator
for await (const message of client.messages.list({ limit: 50 })) {
  console.log(message.id);
}

// Idempotent POST: SDK injects Idempotency-Key when configured
await client.messages.create({ body: "hi" }, { idempotencyKey: "msg-42" });

// Raw response access via second arg
const { data, response } = await client.messages.get(
  { id: "msg_1" },
  { rawResponse: true },
);
response.headers.get("x-request-id");

// Typed error hierarchy
try {
  await client.messages.create({ body: "" });
} catch (err) {
  if (err instanceof RateLimitError) { /* 429 */ }
  if (err instanceof ApiError && err.code === "invalid_request") { /* … */ }
}
```

### 2.3 Generated CLI shape

```sh
mytool messages list --paginate         # iterates all pages, streams JSON Lines on stdout
mytool messages list --limit 10         # single page
mytool messages create --body "hi" --idempotency-key msg-42
mytool messages get --id msg_1 --raw    # prints headers + body, exit code = HTTP status class
mytool --env sandbox messages list      # environment selector
```

### 2.4 Diagnostics catalog (excerpt)

```
TOOLCRAFT_OPENAPI_001  unmapped_endpoint           paths./foo.get not in resources or unspecified_endpoints
TOOLCRAFT_OPENAPI_002  duplicate_method_path       resources.messages.list and threads.messages.list both bind GET /messages
TOOLCRAFT_OPENAPI_003  unknown_pagination_scheme   resources.messages.list references undeclared pagination 'cursor'
TOOLCRAFT_OPENAPI_004  spec_drift                  generated/messages.ts differs from spec; rerun without --check
TOOLCRAFT_OPENAPI_005  reserved_method_name        resources.messages has method 'delete' which conflicts with JS keyword in target 'cli' — set casing or rename
```

Codes are stable across releases (per the diagnostics catalog idea in [docs.reference.diagnostics](https://www.stainless.com/docs/reference/diagnostics/)). Users can grep for codes in CI output.

## 3. Implementation details and technical decisions

### 3.1 Config parsing and merge

- Use the `yaml` library already in the monorepo (per `docs/plans/23-toolcraft-yaml-output.md`). Add to `packages/toolcraft-openapi/package.json` as a direct dep.
- Parse and validate via a `toolcraft-schema` schema (`S.Object({...})`). No zod, per `feedback_no_zod`.
- Deep-merge order: built-in defaults → `toolcraft.yml` → CLI flags (`--env`, `--check`). Never regex-edit on regenerate, per `CLAUDE.md`.
- Validation failures are diagnostics with codes, not exceptions. `generate --check` exits non-zero with the code list.

### 3.2 Resource mapping resolves to existing `defineGroup`

The config's `resources` tree maps 1:1 onto `defineGroup({ children: [...] })`. The existing `groupByNoun` becomes the fallback when `resources` is absent or partial — unmapped endpoints fall through to noun grouping, then to a final `TOOLCRAFT_OPENAPI_001` diagnostic if `unspecified_endpoints` doesn't list them. No new abstraction; the config is a thin lens over what `defineGroup` already does. Reuse, do not duplicate (per `feedback_extend_not_duplicate`).

### 3.3 Pagination

- `pagination.<name>` defines role mappings. The generator emits, per paginated method, two function shapes:
  - Default call: returns the typed page object (`{ data, meta }`) — same as today.
  - `for await` iteration: the SDK wrapper detects pagination metadata on the command and returns an async iterator.
- CLI gets `--paginate` to iterate; output is JSON Lines so it streams. Without `--paginate`, single-page behavior.
- MCP tools do NOT auto-paginate — they return one page with a `next_cursor` field. Agents iterate explicitly. Auto-iteration inside an MCP tool would hide cost from the model.

### 3.4 Retries + idempotency

- `retries` block lives on the runtime, not generated per-command. Implemented in `http.ts` (`requestJson`) as a fetch wrapper. Exponential backoff with full jitter; honor `Retry-After`.
- `client_settings.idempotency_header` + per-method `{ idempotent: true }` causes the generator to:
  - Add an optional `idempotencyKey` SDK option.
  - Add a `--idempotency-key` CLI flag.
  - In MCP, surface it as an optional input param documented as "set to retry safely".
- If `idempotent: true` and the caller omits the key, the runtime generates a UUID v4 and logs it via `progress()` so retries can use the same one.

### 3.5 Typed error hierarchy

Replace the single `HttpError` with:

```
HttpError
├── ClientError (4xx)
│   ├── BadRequestError (400)
│   ├── AuthenticationError (401)
│   ├── PermissionDeniedError (403)
│   ├── NotFoundError (404)
│   ├── ConflictError (409)
│   ├── UnprocessableEntityError (422)
│   └── RateLimitError (429)
└── ServerError (5xx)
    ├── InternalServerError (500)
    └── ServiceUnavailableError (503)
```

Each carries `status`, `code` (parsed from response body when shape matches `{ error: { code } }` or `{ code }`), `requestId` (from `X-Request-Id`), and the original `Response`. The hierarchy is fixed; we do not generate per-API error subclasses (Stainless does; for us it adds churn without proportional value).

### 3.6 Raw response access

Add a per-call option object (second arg to SDK methods):

```ts
{ idempotencyKey?: string; rawResponse?: boolean; signal?: AbortSignal }
```

When `rawResponse: true`, the SDK returns `{ data, response }` instead of `data`. Preserves the simple shape for the 95% case. CLI gets `--raw` which prints status, headers, body separated by `---`.

### 3.7 Environments

`environments` block maps names to URLs. Runtime resolves via:

1. `--env <name>` CLI flag (or `environment: "name"` SDK option).
2. `TOOLCRAFT_OPENAPI_ENV` env var.
3. First entry in the map.
4. Falls back to the OpenAPI `servers[0].url`.

If both `toolcraft.yml` environments and `servers` are defined, the config wins (it's the explicit choice; per `feedback_explicit_over_implicit`).

### 3.8 Examples → CLI help + MCP description

A `readme.examples` block in the config seeds per-command examples:

```yaml
readme:
  examples:
    messages.create:
      - title: Send a message
        params: { body: "hello" }
```

Generator emits these into:

- `defineCommand({ description, examples: [...] })` — new optional field on `Command`.
- CLI `--help` renders an "Examples" section after the param list.
- MCP tool description gets `\n\nExamples:\n- mytool messages create --body hello` appended so the agent has a concrete usage to anchor on.

This is the single highest-leverage change for MCP quality. Today, MCP tool descriptions are paths and verbs — agents misroute. With an example, accuracy goes up substantially without retraining anything.

### 3.9 Drift UX

Keep `openapi.lock` (existing). Augment with:

- `generate` (no flag) writes both files *and* prints diagnostics for anything skipped, unmapped, or renamed silently.
- `generate --check` exits non-zero on either spec drift or unresolved diagnostics. CI integration is one line, per `toolcraft-openapi/README.md`.
- `generate --diff` prints a unified diff of what would change without writing. Useful in PR review for spec bumps.

### 3.10 Edition pinning

Add an `edition` field to `toolcraft.yml`. The generator reads it and selects a generation strategy. Editions are dates (`2026-05-16`). When we ship a breaking change to emitted code, we cut a new edition and old configs keep their old behavior until they bump. Mirrors Stainless's approach and is the only sustainable way to evolve a code generator without breaking pinned consumers.

For the first release: `edition: 2026-05-16` is the only valid value and is required. No back-compat code yet. The mechanism exists so the next bump is non-disruptive.

## 4. Interfaces and test plan

### 4.1 Public surface additions

**`toolcraft-openapi`** new exports:

```ts
export interface ToolcraftConfig { /* validated config shape */ }
export function readToolcraftConfig(path: string): Promise<ToolcraftConfig>;
export function diagnose(config, document): Diagnostic[];
export interface Diagnostic { code: string; severity: "error" | "warn"; message: string; location?: string; }
```

**`toolcraft`** new exports:

```ts
export class HttpError extends Error { status: number; code?: string; requestId?: string; response: Response; }
export class ClientError extends HttpError {}
export class AuthenticationError extends ClientError {}
// …full hierarchy from §3.5
```

`defineCommand` config gains:

```ts
{
  examples?: Array<{ title: string; params: Record<string, unknown> }>;
  // pagination is set by the generator, not by hand
}
```

### 4.2 Tests (all in-memory, no real files, no network — per `CLAUDE.md` testing rules)

- `toolcraft-openapi/src/config.test.ts` — YAML parse, deep merge with CLI flags, validation failures emit codes.
- `toolcraft-openapi/src/diagnose.test.ts` — for each `TOOLCRAFT_OPENAPI_NNN`, a fixture spec + config that triggers it.
- `toolcraft-openapi/src/pagination.test.ts` — generated iterator yields pages, stops at empty `next_cursor`, propagates errors mid-iteration.
- `toolcraft-openapi/src/retries.test.ts` — `requestJson` retries on 429/503/network error, exhausts after `max`, respects `Retry-After`, jitter is bounded.
- `toolcraft-openapi/src/idempotency.test.ts` — header injection when configured, UUID generation when caller omits, no header when `idempotent: false`.
- `toolcraft-openapi/src/errors.test.ts` — each subclass thrown for the matching status; `code`, `requestId`, `response` populated.
- `toolcraft-openapi/src/environments.test.ts` — resolution precedence (CLI flag > env var > config first > OpenAPI servers).
- `toolcraft-openapi/src/examples.test.ts` — examples appear in CLI `--help` snapshot, in MCP tool description snapshot.
- `toolcraft-openapi/src/edition.test.ts` — missing edition fails with `TOOLCRAFT_OPENAPI_006`; unknown edition fails likewise.
- `toolcraft-openapi/src/generate.test.ts` — extended: drift detected when handwritten edit is present; `--diff` prints expected diff.

Snapshots use the existing `__snapshots__` mechanism. Mock LLMs are not involved here; everything is local code generation.

E2E spot check: `npm run dev -- toolcraft-openapi-generate --input fixtures/petstore.json --output tmp/` against a fixture spec exercises the full pipeline end to end. Add as a step in the existing `toolcraft-openapi` test suite, not as a separate script (per `feedback_no_bash_scripts`).

### 4.3 Backward compatibility

- No `toolcraft.yml` → today's behavior, byte-identical generated output for existing consumers.
- `openapi.lock` format unchanged.
- `bearerTokenAuth()` keeps its current signature; the new `client_settings.auth.bearer` is an alternate, declarative entry point. Both compose.

## 5. Code plan

Concrete file-level changes, ordered to land incrementally. Each bullet is one PR-sized unit.

### Phase A — diagnostics + config skeleton

1. `packages/toolcraft-openapi/src/diagnostics.ts` (new) — code catalog (`TOOLCRAFT_OPENAPI_001`…), formatter, `Diagnostic` type.
2. `packages/toolcraft-openapi/src/config.ts` (new) — `ToolcraftConfig` shape via `toolcraft-schema`, `readToolcraftConfig(path)`, deep merge.
3. `packages/toolcraft-openapi/src/diagnose.ts` (new) — runs over a parsed config + OpenAPI doc, returns `Diagnostic[]`. Wired into `generate.ts` and `bin/generate-cli.ts`.
4. `packages/toolcraft-openapi/src/bin/generate-cli.ts` — `--diff`, prints diagnostics, exits non-zero in `--check` mode on either drift or error-severity diagnostics.
5. `packages/toolcraft-openapi/README.md` — document `toolcraft.yml`, every key, every diagnostic code (per `CLAUDE.md`: each package documents env vars and config).

### Phase B — environments + raw response + error hierarchy

6. `packages/toolcraft-openapi/src/runtime.ts` — environment resolution precedence.
7. `packages/toolcraft-openapi/src/http.ts` — return `{ data, response }` when `rawResponse: true`; thread option through generated commands.
8. `packages/toolcraft/src/http-errors.ts` (new) or extend existing `user-error.ts` — full subclass hierarchy from §3.5. Export from `toolcraft` index. `requestJson` in `toolcraft-openapi/src/http.ts` throws the right subclass.

### Phase C — retries + idempotency

9. `packages/toolcraft-openapi/src/http.ts` — retry loop, exponential backoff with full jitter, `Retry-After` parsing.
10. `packages/toolcraft-openapi/src/generate.ts` — emit `idempotencyKey?` SDK option and `--idempotency-key` CLI flag for methods marked `idempotent: true`.
11. `packages/toolcraft-openapi/src/runtime.ts` — UUID v4 fallback when caller omits the key on an idempotent method.

### Phase D — pagination

12. `packages/toolcraft-openapi/src/pagination.ts` (new) — pagination scheme resolution; generator hook that wraps paginated commands.
13. `packages/toolcraft-openapi/src/generate.ts` — when a method has `pagination: <name>`, emit two call shapes (single-page + iterator).
14. `packages/toolcraft-openapi/src/runtime.ts` — `for await` wrapper that calls the command with the updated cursor until the response indicates exhaustion.
15. `packages/toolcraft/src/cli.ts` — `--paginate` flag handling; JSON Lines stdout.

### Phase E — examples + MCP polish

16. `packages/toolcraft/src/index.ts` — add `examples?` to `defineCommand` config type. No runtime change beyond carrying the array on the node.
17. `packages/toolcraft/src/cli.ts` — render "Examples" section in `--help`.
18. `packages/toolcraft/src/mcp.ts` — append examples to tool description text.
19. `packages/toolcraft-openapi/src/generate.ts` — read `readme.examples` from config, attach to the matching generated command.

### Phase F — edition pinning

20. `packages/toolcraft-openapi/src/config.ts` — require `edition`, accept exactly `2026-05-16` for v1. Diagnostic on mismatch.
21. Bump `toolcraft-openapi` minor version. Update `docs/plans/22-toolcraft-release-notes.md` migration table.

### Out of scope for this plan, parked for later

- Streaming/SSE — wait for a consumer.
- File uploads / multipart — wait for a consumer.
- Multi-language emit — explicitly not a goal.
- Stainless-style `$shared` model namespace — `toolcraft-schema` doesn't need it yet; revisit if shared types become painful.
- Language server — diagnostics + `--diff` cover the editing loop adequately.

## Sources

- [Stainless config reference](https://www.stainless.com/docs/reference/config/)
- [Stainless diagnostics catalog](https://www.stainless.com/docs/reference/diagnostics/)
- [Stainless: configuring resources/methods/models](https://www.stainless.com/docs/guides/configure/)
- [Speakeasy: choosing an SDK generator (Speakeasy vs Stainless vs Fern vs APIMatic vs OpenAPI Generator)](https://www.speakeasy.com/blog/comparison-sdk-generators-openapi)
- [Speakeasy: in-depth Speakeasy vs Fern](https://www.speakeasy.com/blog/speakeasy-vs-fern)
- [Stainless: announcing the SDK generator](https://www.stainless.com/blog/announcing-the-stainless-sdk-generator)
- [Stainless: iterate on SDKs locally with the language server](https://www.stainless.com/blog/iterate-on-your-sdks-locally-with-the-stainless-language-server)
- [Five SDK Generators Compared (apicoding.com)](https://apicoding.com/five-sdk-generators-compared-speakeasy-stainless-fern-apimatic-and-openapi-generator/)
