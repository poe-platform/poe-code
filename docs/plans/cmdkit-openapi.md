---
kind: superintendent
version: 1

builder:
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  code-quality:
    prompt: |
      Review builder changes for convention, SOLID, KISS. Flag any if/case branching on provider or endpoint shape — the generator must stay declarative.

  spec-fidelity:
    prompt: |
      Verify generated commands faithfully represent the OpenAPI operation: path/query/body params, enums, required fields, method semantics, MCP inputSchema shape. Flag deviations.

  testing:
    prompt: |
      Verify snapshot tests cover the cases listed in the Testing section of {{plan.path}} and the full `@poe-code/cmdkit-openapi` suite passes.

superintendent:
  prompt: |
    Review builder and inspector output, update the Task Board in {{plan.path}}, and request owner review when complete. Reject scope creep into pagination, retries, or OAuth.

    You can choose to commit work.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Code quality
    {{inspectors.code-quality}}

    ## Spec fidelity
    {{inspectors.spec-fidelity}}

    ## Testing
    {{inspectors.testing}}

owner:
  agent: claude-code
  prompt: |
    Decide whether cmdkit-openapi generates a usable CLI + MCP surface for a real OpenAPI spec with pluggable auth, without over-building. Approve or send back with feedback.

    Your career depends on this, so make it good

    Run e2e tests
    Run smoke tests
    And commit 

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 100

status:
  state: in_progress
  round: 54
  review_turn: 0
---

# cmdkit-openapi — REST → CLI / MCP codegen

## Context

Internal APIs (e.g. `https://www.i.quora.com/api/internal_agent`) need agent-facing tool
surfaces. We want OpenAPI specs to drive both an MCP tool list and a `gh`-style CLI, with
handwritten auth commands alongside the generated endpoint commands.

The existing `cmdkit` package already renders a command tree into CLI, MCP, and SDK
surfaces. What's missing is (1) a generator that emits cmdkit command files from an
OpenAPI document, and (2) a thin auth abstraction so each REST client gets
`login` / `logout` / `auth status` without handwriting them.

## Design constraints

- **Codegen, not runtime reflection.** Commands are emitted as committed `.ts` files so
  diffs are reviewable and types are real. No runtime OpenAPI parsing in the hot path.
- **Drift guard via hash.** An `openapi.lock` file captures the spec SHA; CI re-runs the
  generator and fails on any diff.
- **No client-side validation.** The server validates. Generator emits argv coercion
  (string→number/bool/array) only — that's parsing, not validation. No zod.
- **Params are declared with `@poe-code/cmdkit-schema` (`S.Object({...})`).** This is
  the chosen definition format for command params across the codebase. The generator
  emits `S.Object(...)`; handwritten auth commands use `S.Object(...)`. The earlier
  "no cmdkit-schema" reading of the project-level no-zod rule was wrong — that rule
  is about *runtime validation*, not *declarative definition*. cmdkit-schema stays.
- **gh-style naming.** `<noun> <verb> --flag value`. Noun comes from OpenAPI `tags[0]`;
  verb from `operationId` or method+path tail. Path params become required flags, never
  positional.
- **Auth is pluggable via `AuthProvider`.** Consumer passes one provider to
  `defineClient`. v1 ships `bearerTokenAuth`; OAuth lands later as a drop-in.
- **MCP excludes auth.** Agents must never see `login`/`logout`. Enforced at
  registration time, not by convention.
- **One plugin per client.** No chaining, no middleware stack.
- **Handwritten ≫ generated naming collisions fail hard.** No silent overrides.

## Target UX

### Consumer package

```ts
// packages/internal-agent-cli/src/client.ts
import { defineClient, bearerTokenAuth } from "@poe-code/cmdkit-openapi";
import * as generated from "./generated";

export default defineClient({
  name: "internal-agent",
  baseUrl: "https://www.i.quora.com/api/internal_agent",
  auth: bearerTokenAuth({
    serviceName: "poe-internal-agent",
    envVar: "INTERNAL_AGENT_TOKEN",
    whoamiPath: "/whoami",
  }),
  commands: Object.values(generated),
});
```

### MCP tool names

Format: `<client>__<noun>__<verb>`, e.g. `internal_agent__bots__set_official`,
`internal_agent__bots__list`. Double underscore separates the three segments.

The `<client>` segment is derived from `defineClient({ name })`, with hyphens replaced
by underscores (MCP tool names can't contain `-` or spaces). So:

```ts
defineClient({ name: "internal-agent", ... })
// CLI binary:       internal-agent bots list
// MCP tool name:    internal_agent__bots__list
```

One field (`name`), one transform in `naming.ts`. An optional `mcpPrefix` override
could be added later if a consumer wants a shorter MCP namespace than CLI name —
YAGNI for v1.

### Endpoint examples — CLI + MCP side by side

Five cases cover every shape the generator needs to handle in v1.

#### 1. POST with path param + scalar body — `set-official`

OpenAPI: `POST /bots/{botHandle}/actions/set-official` body `{ official: boolean }`.

CLI:

```
internal-agent bots set-official --handle my-bot --official true
internal-agent bots set-official --handle my-bot --no-official   # boolean sugar
```

MCP tool:

```json
{
  "name": "internal_agent__bots__set_official",
  "description": "Mark a bot as official.",
  "inputSchema": {
    "type": "object",
    "required": ["handle", "official"],
    "properties": {
      "handle":   { "type": "string" },
      "official": { "type": "boolean" }
    }
  }
}
```

#### 2. POST with enum body — `set-image-comprehension`

Body: `{ mode: "off" | "auto" | "forced" }`.

CLI:

```
internal-agent bots set-image-comprehension --handle my-bot --mode auto
```

MCP tool:

```json
{
  "name": "internal_agent__bots__set_image_comprehension",
  "inputSchema": {
    "type": "object",
    "required": ["handle", "mode"],
    "properties": {
      "handle": { "type": "string" },
      "mode":   { "type": "string", "enum": ["off", "auto", "forced"] }
    }
  }
}
```

#### 3. POST with array body — `set-conversation-starters`

Body: `{ starters: string[] }` (max 4).

CLI — repeatable flag for humans, `--*-json` for scripts (mutually exclusive):

```
internal-agent bots set-conversation-starters --handle my-bot \
  --starter "Tell me a joke" --starter "Summarize this" --starter "Draft an email"

internal-agent bots set-conversation-starters --handle my-bot \
  --starters-json '["a","b","c"]'
```

MCP tool — arrays are native, no flag gymnastics:

```json
{
  "name": "internal_agent__bots__set_conversation_starters",
  "inputSchema": {
    "type": "object",
    "required": ["handle", "starters"],
    "properties": {
      "handle":   { "type": "string" },
      "starters": { "type": "array", "items": { "type": "string" }, "maxItems": 4 }
    }
  }
}
```

#### 4. GET with query params + pagination — `list`

`GET /bots?owner=&cursor=&limit=`.

CLI — pretty table for TTY, JSON when piped or `--json`:

```
internal-agent bots list --owner alice --limit 50
internal-agent bots list --owner alice --cursor eyJ... --json
```

MCP tool:

```json
{
  "name": "internal_agent__bots__list",
  "inputSchema": {
    "type": "object",
    "properties": {
      "owner":  { "type": "string" },
      "cursor": { "type": "string" },
      "limit":  { "type": "integer", "minimum": 1, "maximum": 100 }
    }
  }
}
```

#### 5. GET by id + DELETE — single resource

`GET /bots/{handle}` and `DELETE /bots/{handle}`.

CLI — `DELETE` auto-injects confirm prompt and `--yes`:

```
internal-agent bots view   --handle my-bot
internal-agent bots delete --handle my-bot --yes
```

MCP tool (DELETE — no confirm, one-shot):

```json
{
  "name": "internal_agent__bots__delete",
  "inputSchema": {
    "type": "object",
    "required": ["handle"],
    "properties": { "handle": { "type": "string" } }
  }
}
```

### Cross-cutting conventions baked into every generated command

| Concern   | CLI                                               | MCP                                                   |
|-----------|---------------------------------------------------|-------------------------------------------------------|
| Auth      | resolved via `AuthProvider` (env → keychain)      | same `TokenSource`, set at server start               |
| Errors    | non-2xx → red error line + exit 2                 | non-2xx → `isError: true`, body `{status, body}`      |
| Output    | pretty by default, `--json` for raw               | always raw JSON                                       |
| Verbosity | `-v` logs request line                            | N/A                                                   |
| Dry run   | `--dry-run` prints the HTTP request and exits     | N/A                                                   |
| Naming    | `<noun> <verb>` (`bots set-official`)             | `internal_agent__<noun>__<verb>` (snake_case required)|

The CLI↔MCP name mapping is the one real asymmetry and is hardcoded in `naming.ts` —
one place to change it, not per-command branching.

## Package layout

```
packages/cmdkit-openapi/
  src/
    generate.ts              # pure: (spec, opts) → files[]
    bin/generate.ts          # CLI wrapper: read spec, write files, update lock
    define-client.ts         # merge generated + handwritten, conflict check, register
    http.ts                  # shared fetch wrapper: auth header, error mapping, --dry-run
    auth/
      types.ts               # AuthProvider = TokenSource & CommandContributor
      bearer-token-auth.ts   # built-in provider
    naming.ts                # path/tag/operationId → noun, verb, MCP name
    lock.ts                  # spec hash read/write
    index.ts                 # public surface
  README.md
```

Consumer repos own:

```
openapi.json
openapi.lock
src/
  generated/                 # committed generator output
  client.ts                  # defineClient() call
  bin.ts                     # CLI entrypoint
```

## AuthProvider

Pattern: **Strategy + Provider/Contributor**, modelled on Azure SDK's `TokenCredential`
and Go `oauth2.TokenSource` (small single-method interfaces), not Passport.js
(heavyweight strategy registry).

### Interfaces

Two-interface split so MCP-path code never sees `commands`:

```ts
export interface TokenSource {
  getToken(): Promise<string>;    // throws UserError if unresolved
  invalidate?(): Promise<void>;   // called on 401
}

export interface CommandContributor {
  commands: Command[];            // registered as cli-scope only
}

export type AuthProvider = TokenSource & CommandContributor;
```

`http.ts` depends on `TokenSource` only. `defineClient` takes the full `AuthProvider`
and registers `commands` into the CLI tree, tagged `cli`-scope so MCP emission skips
them. Type-enforced — no possibility of leaking `login` to an agent.

### `bearerTokenAuth(opts): AuthProvider`

Built-in provider; the only one shipped in v1.

```ts
export function bearerTokenAuth(opts: {
  serviceName: string;            // auth-store key, e.g. "poe-internal-agent"
  envVar: string;                 // e.g. "INTERNAL_AGENT_TOKEN"
  whoamiPath?: string;            // optional: verify on login, show in status
  commandPrefix?: string;         // default: "auth"
}): AuthProvider;
```

**Token resolution order** (enforced in `getToken()`):

1. `opts.envVar` env var — CI escape hatch, always wins.
2. `@poe-code/auth-store` entry under `opts.serviceName`.
3. Nothing resolved → `getToken()` throws `UserError("run '<commandPrefix> login' first")`, which `http.ts` lets propagate before `fetch`. Exit 2 comes from cmdkit's `UserError` renderer.

**Contributed commands** (under `<commandPrefix> …`, default `auth`):

#### `internal-agent auth login`

Interactive (TTY):

```
$ internal-agent auth login
? Paste your internal API key: ****************
✓ Authenticated as kjopek@quora.com (employee: true)
  Stored in macOS Keychain.
```

Non-interactive:

```
internal-agent auth login --token "$IA_TOKEN"
cat key.txt | internal-agent auth login --token-stdin
```

Flow: read token (flag/stdin/prompt) → call `whoamiPath` if set → reject if `!is_employee`
→ store via `auth-store` → print identity + storage location.

#### `internal-agent auth logout`

```
$ internal-agent auth logout
✓ Removed stored credential.
```

Idempotent — exit 0 even if nothing was stored.

#### `internal-agent auth status`

```
$ internal-agent auth status
✓ Logged in as kjopek@quora.com
  Token source: keychain
  Host: i.quora.com (VPN required)
```

Source precedence shown explicitly so "why is my command 401ing" is diagnosable in
one command.

### 401 handling

`http.ts` calls `tokenSource.invalidate?.()` on a 401 before surfacing the error. For
`bearerTokenAuth`, `invalidate()` deletes the stored entry — next run will prompt
re-login rather than silently re-sending a dead token.

### Forward compatibility

Future providers (e.g. `oauthAuth`, `mTlsAuth`) implement the same `AuthProvider` shape
and drop into `defineClient` with zero changes to consumer code or generated commands.
The interface is the forward-compat seam; the implementations are YAGNI-gated until a
real API needs them.

## Generator behavior

Input: parsed OpenAPI 3 doc + options. Output: `{ path, contents }[]` — pure, no I/O.

For each operation:

- Noun = `tags[0]` (required — fail if missing, with the op id in the error).
- Verb = last path segment after `/actions/` if present, else derived from method+path.
- Path params, query params, JSON body fields → flattened into flags.
- Arrays of scalars → repeatable flag (`--starter a --starter b`) plus `--<name>-json`
  for scripts; mutually exclusive.
- Booleans → `--flag` / `--no-flag`.
- `DELETE` methods → auto-inject confirm prompt + `--yes`.
- Responses: pretty table if `tags[0]` resource has a known list/item shape, else JSON.
  `--json` forces raw. Non-TTY defaults to JSON.
- Errors: non-2xx → throw `{status, body}`. cmdkit's renderer handles display.

Each emitted file carries a header banner with `spec-sha` and `operation-id`. Tests diff
against snapshots.

## Milestones

Each milestone is mergeable on its own, tests-first.

1. **Scaffold package + `AuthProvider` types.** No generator yet. Just the interfaces,
   `http.ts`, `bearerTokenAuth` implementation, unit tests with a stubbed `TokenSource`.
2. **`defineClient` + conflict detection.** Merges handwritten command list,
   enforces no-collision, tags auth commands `cli`-only.
3. **Pure `generate()` — happy path.** Covers: path param, scalar body, enum body,
   scalar query. Snapshot tests per case.
4. **Generator — array body + repeatable flags + `DELETE` confirm.** Extend snapshots.
5. **`bin/generate.ts` + lock file.** Reads spec from disk or URL, writes files, updates
   `openapi.lock`. CI recipe documented in README.
6. **First consumer: `internal-agent-cli`.** Real spec, committed generated dir,
   `bearerTokenAuth` wired, smoke test via `npm run dev`.
7. **MCP surface smoke test.** Confirm generated tools register with `tiny-mcp-client`;
   confirm auth commands are absent.

## Testing

Each test is a single assertion. Grouped by unit under test. Every generator test is a
snapshot against a handwritten OpenAPI 3 fixture; every runtime test uses mocked
`fetch` and an in-memory `auth-store` (no network, no FS).

### `generate()` — OpenAPI coverage

Naming derivation:

- `tags: ["bots"]`, path `/bots/{h}/actions/set-official` → noun `bots`, verb `set-official`.
- `tags: ["bots"]`, method `GET`, path `/bots` → verb `list`.
- `tags: ["bots"]`, method `GET`, path `/bots/{h}` → verb `view`.
- `tags: ["bots"]`, method `DELETE`, path `/bots/{h}` → verb `delete`.
- `tags: []` or missing → throws with operationId in the error.
- `tags: ["a", "b"]` → first tag wins; second ignored (documented).
- Two operations resolving to the same `noun verb` → throws, lists both opIds.

Parameter flattening:

- Path param (required string) → required `--handle` flag.
- Query param (optional string) → optional flag, no coercion needed.
- Query param (optional integer, `minimum`/`maximum`) → `--limit` flag; min/max reflected in MCP schema.
- Query param with default → flag default matches spec default.
- Body `{ official: boolean }` → `--official` / `--no-official` pair.
- Body `{ mode: "off"|"auto"|"forced" }` → enum flag; MCP schema carries `enum`.
- Body `{ starters: string[] }` → repeatable `--starter` + `--starters-json`, mutually exclusive.
- Body `{ limit: integer }` with `nullable: true` → flag accepts absent value, sends `null` only when `--limit-null` passed.
- Body with `$ref` to a component schema → inlined at generate time (ref resolver test).
- Body field `format: date-time` → string flag with a comment noting ISO-8601 expected (no parsing).

HTTP method coverage:

- `POST` with body → JSON body emitted.
- `PUT` with body → same as POST (no special handling).
- `PATCH` with body → same as POST.
- `GET` with no body → no body serialization call.
- `DELETE` with no body → auto-injected `--yes` flag + confirm prompt hook.
- `DELETE` with body → `--yes` + body flags both present.

Output surfaces:

- Emitted file contains banner with `spec-sha` + `operation-id`.
- Emitted file exports a single `Command` matching cmdkit's `Command` shape.
- MCP `inputSchema.properties` matches OpenAPI schema 1:1 for scalar, enum, array, integer.
- MCP `inputSchema.required` matches OpenAPI `required` + path params.
- CLI `--json` flag is always present on commands with non-empty response schema.
- Deterministic output: same input → same bytes (stable key ordering).

Error cases:

- Operation with `requestBody.content["application/xml"]` only → throws (JSON-only in v1).
- Operation with no `operationId` and an ambiguous path → throws.
- Spec missing `paths` → throws with clear message.

### `defineClient()`

- Handwritten + generated merge → all commands registered.
- Handwritten `bots list` + generated `bots list` → throws at startup, names both sources.
- Auth commands registered only in CLI scope — MCP emitter must not see them.
- `name: "internal-agent"` → MCP prefix `internal_agent`, CLI binary `internal-agent`.
- `name` with uppercase or underscore → throws (CLI binaries should be lowercase-hyphen).
- Missing `auth` → throws (auth is required in v1).
- `commands: []` with valid `auth` → client exposes only auth commands (degenerate but valid).

### `http.ts`

Auth header:

- `TokenSource.getToken()` returns `"abc"` → `Authorization: Bearer abc` set on request.
- `TokenSource.getToken()` throws `UserError` → error propagates before `fetch` is called (no request made).

Request shape:

- Path params substituted into URL (`/bots/{handle}` + `handle: "foo"` → `/bots/foo`).
- Path param containing `/` → URL-encoded.
- Query params: scalars serialized `?k=v`; arrays `?k=a&k=b`; `undefined` dropped; `null` sent as empty.
- JSON body: content-type `application/json`, stringified.
- `baseUrl` with trailing slash + path with leading slash → single slash in joined URL.

Response handling:

- 2xx JSON response → parsed and returned.
- 2xx with empty body → returns `undefined` (not a parse error).
- 4xx → throws `{ status, body }`; body parsed if JSON, raw string otherwise.
- 5xx → same throw shape.
- 401 specifically → calls `tokenSource.invalidate?.()` before throwing.
- Non-JSON 2xx response → throws (JSON-only in v1).

Flags:

- `--dry-run` → prints `METHOD URL\nheaders\nbody` and does not call `fetch`.
- `-v` → logs request line to stderr.

### `bearerTokenAuth`

Token resolution:

- Env var set + store set → env wins.
- Env var unset + store set → store used.
- Env var unset + store empty → `getToken()` throws `UserError` pointing at `<commandPrefix> login`.
- `invalidate()` → store entry deleted; next `getToken()` returns env if set, else throws `UserError`.

`login` command:

- `--token "foo"` → stores `"foo"`, prints identity from whoami.
- `--token-stdin` reading from piped stdin → stores stdin content trimmed.
- TTY prompt (mocked) → stores prompted value.
- `whoamiPath` unset → skips verification, stores as-is.
- `whoamiPath` set, whoami returns `is_employee: true` → stores, prints email.
- `whoamiPath` set, whoami returns `is_employee: false` → rejects, does not store.
- `whoamiPath` set, whoami 401 → rejects, does not store.
- `whoamiPath` set, whoami network error → rejects, does not store.
- Both `--token` and `--token-stdin` passed → errors, does not store.

`logout` command:

- Store has entry → entry removed, exit 0.
- Store empty → exit 0 (idempotent), no error.

`status` command:

- Env var set → prints "Token source: env (INTERNAL_AGENT_TOKEN)".
- Store set, env unset → prints "Token source: keychain".
- Neither → prints "Not logged in", exit 0 (not an error, just a status).
- `whoamiPath` set → prints identity from whoami call.

### Argv parsing (generated CLI commands)

- Scalar string flag → passed through.
- `--count 42` → coerced to number (integer schema).
- `--count abc` → errors, does not call fetch.
- `--flag` / `--no-flag` boolean pair both recognized.
- Missing required flag → errors, lists the missing flag name.
- Enum flag with bad value → errors, lists allowed values.
- Repeatable `--starter a --starter b --starter c` → array of 3.
- `--starters-json '["a","b"]'` → array of 2.
- Both `--starter` and `--starters-json` passed → errors.
- `--starters-json 'not-json'` → errors with parse message.
- `DELETE` command without `--yes` in TTY → prompts (mocked); no → no fetch.
- `DELETE` command with `--yes` → no prompt, fetches.
- `DELETE` command in non-TTY without `--yes` → errors (no silent destructive op).
- `--json` flag present → output is raw JSON, no pretty formatting.
- Non-TTY stdout + no `--json` → still JSON (auto-detect).

### Lock file / drift guard

- First generate, no lock file → lock file created with spec SHA.
- Re-run with unchanged spec → lock unchanged, files unchanged (idempotent).
- Spec changed, default run → files regenerated, lock updated.
- Spec changed, `--check` flag → exits non-zero, no files written.
- Lock file present but malformed → treated as missing (regenerates).

### Cross-cutting

- CLI↔MCP name asymmetry: `bots set-official` ↔ `internal_agent__bots__set_official`, always.
- Generated tools on MCP surface round-trip: tool schema → valid call → server call → response.
- Auth commands never appear in MCP tool list regardless of client config.

### Famous spec smoke runs (manual verification)

Run the generator against a handful of well-known public OpenAPI documents and
eyeball the output. Goal is to surface shape mismatches the fixture suite misses;
endpoints do not need to execute — auth-gated calls are expected to 401.

For each spec: download, run `generate()`, commit the output under
`packages/cmdkit-openapi/fixtures/famous/<name>/`, and note any operations that
throw or produce obviously wrong commands in a short `NOTES.md` beside the output.

- Petstore (`https://petstore3.swagger.io/api/v3/openapi.json`) — canonical tiny spec.
- GitHub REST (`https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json`) — huge, deeply tagged.
- Stripe (`https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json`) — nested schemas, polymorphism.
- Slack (`https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json`) — form-encoded bodies (expected to throw on JSON-only guard).
- DigitalOcean (`https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml`) — YAML input.

Outcome captured in the consumer `NOTES.md` per spec:

- Counts: operations in spec, commands emitted, operations skipped (with reason).
- Any `throw` not already covered by the error-case tests → file a follow-up test.
- Spot-check 3 emitted commands per spec against the source operation for correctness.

### Not covered by tests in this plan

- End-to-end against a live internal API (first consumer package owns this).
- OAuth flows (out of scope).
- Pagination, retries, streaming (out of scope).
- Functional execution of famous-spec commands — auth-gated, 401s expected.

## Out of scope

- OAuth / device-code flow — lands when a real API needs it.
- Pagination helpers — add when a paginated endpoint actually ships.
- Retries, idempotency keys, request IDs.
- File uploads, streaming responses, SSE.
- Multi-host auth (one provider per client is fine).
- Generator emitting anything other than `application/json` content types.
- Overriding / patching generated commands. Handwritten commands may wrap a generated
  one (import + call) but not replace it.

## Open questions

- Where does the `internal-agent-cli` package live — its own package, or a subpath of an
  existing one? (Probably its own package for clean separation.)
- Should `openapi.lock` be a JSON file with per-file hashes, or a single spec-level
  hash? (Leaning single hash — simpler, and per-file stamp in the banner already
  captures per-op drift.)
- Pretty table auto-detection: opt-in via a small generator config, or always JSON in
  v1? (Probably JSON-only in v1 — pretty rendering is polish.)

## Task Board

- [x] Scaffold `@poe-code/cmdkit-openapi` package with `AuthProvider` / `TokenSource` / `CommandContributor` interfaces and a README listing env vars and options.
- [x] Implement `http.ts` — shared fetch wrapper: auth header injection, URL joining, query/body serialization, non-2xx throw shape, 401 → `invalidate()`, `--dry-run`, `-v`.
- [x] `http.ts` follow-up: redact bearer token in `--dry-run` output (print `Authorization: Bearer ****`). Update the dry-run test to assert redaction so CI logs can never capture a live token.
- [x] `http.ts` follow-up (KISS): replace the manual `substitutePathParams` index-walker with a `String.prototype.replace(/\{([^}]+)\}/g, …)` one-liner; collapse the duplicated empty/JSON parsing by branching on `response.ok` before parsing.
- [x] `http.ts` hygiene: drop the pure-proxy `defaultWriteStdout` / `defaultWriteStderr` helpers (violates CLAUDE.md "no proxy-only functions"); remove `missingTokenMessage` from `HttpRequestOptions` and have `TokenSource.getToken()` throw its own `UserError` when unresolved; swap the raw `Error` thrown for non-JSON 2xx bodies to `HttpError` (include the offending `content-type` in the message) so the taxonomy stays consistent. Also: collapse the query-serialization `undefined` guard to `for (const [k, v] of Object.entries(query ?? {}))`, and drop the unreachable `|| "/"` fallback on `normalizedPath` (`normalizedPath` is always anchored).
- [x] Delete `packages/cmdkit-openapi/src/index.compile-check.ts` — `expectTypeOf` in `src/index.test.ts` already enforces the same public-surface shapes; the `IgnoredXExport` naming is misleading and the file is pure duplication. (Flagged by code-quality inspector as a must-fix in round 5; builder round 5 did not remove it.)
- [x] `http.ts` minor cleanups from code-quality inspector (round 5): (a) fold `appendQueryParams` into its caller or merge with `appendQueryValue` — it is a proxy-only iterator; (b) thread a single `hasBody` boolean so `createHeaders` and the `fetch` body assignment don't each re-check `body === undefined`. (Inspector round 6 withdrew the earlier "pick one validation pass in `substitutePathParams`" sub-item: the `replace` callback catches missing params for a well-formed template while the post-check catches malformed templates like `/bots/{handle`. Keep both.)
- [x] `http.ts` hygiene (round 6, reflagged in round 7): (a) hoist `options.method.toUpperCase()` once — it is computed at `http.ts:45` and again at `http.ts:57`; (b) align error taxonomy in `substitutePathParams` — the two raw `Error` throws at `http.ts:116` and `http.ts:122` are user-facing "your template/params are wrong" failures, swap them to `UserError` (same rationale as the token-source case in the earlier hygiene pass).
- [x] Implement `bearerTokenAuth` using `@poe-code/auth-store`: env → store → null resolution, `login` / `logout` / `status` commands, whoami verification, `is_employee` gate.
- [x] `bearerTokenAuth` follow-ups from round 9 inspectors: (a) remove the `as any` cast at `bearer-token-auth.ts:196` by fixing the `defineGroup` children generic or the `defineCommand` result type — no type escape hatches in the declarative API; (b) declare `fetch` explicitly on `BearerTokenAuthCommandServices` rather than relying on it being present on the cmdkit `HandlerContext` (satisfies the "explicit over implicit" rule); (c) add an explicit test for `logout` when the store is empty (assert `exit 0`, no throw, `store.delete` called) to literally cover the Testing-section bullet; (d) consider inlining the single-caller `formatStorageMessage` helper (borderline — leave if readability wins).
- [x] `bearerTokenAuth` follow-ups from round 10 inspectors: (a) `formatLoginMessage` at `bearer-token-auth.ts:302-312` has a dead branch — control flow guarantees `result.isEmployee` is either `undefined` (whoami unset) or `true` (employee check passed), so the `(employee: ${result.isEmployee})` suffix only ever renders `(employee: true)`. Collapse to two branches: email+employee-confirmed vs. email-only vs. no-email; (b) tighten the four login-rejection tests at `bearer-token-auth.test.ts:266-339` (`non-employee`, `whoami 401`, `network error`, `both --token and --token-stdin`) — each asserts `.rejects.toThrow` but should also assert `expect(mocks.set).not.toHaveBeenCalled()` to literally cover the "rejects, does not store" Testing-section wording; (c) add an `invalidate()` round-trip test that covers the env-fallback half of the Testing bullet — after `invalidate()`, `getToken()` should return the env value if set, else throw `UserError`.
- [x] `http.ts` KISS (round 11): collapse `appendQueryValue` + `appendQueryScalar` at `http.ts:131-152` into one function. `appendQueryScalar` is only called from inside the array branch and the scalar fallthrough of `appendQueryValue`; the split adds a function without adding clarity. Non-blocking, ~5-line diff.
- [x] `bearerTokenAuth` testing literal coverage (round 11): the positive whoami-verified test at `bearer-token-auth.test.ts:291` asserts the returned email but does not assert `mocks.set` was called with the token. Add `expect(mocks.set).toHaveBeenCalledWith("<token>")` so the "stores" half of the Testing-section bullet is literally covered (mirrors the `.not.toHaveBeenCalled()` additions made to the rejection tests in round 10).
- [x] `bearerTokenAuth` testing literal coverage (round 12): the whoamiPath-unset login test at `bearer-token-auth.test.ts:277-289` asserts `fetch` was not called but does not assert `mocks.set` received the token. The Testing-section bullet says "skips verification, **stores as-is**" — add `expect(mocks.set).toHaveBeenCalledWith("<token>")` so the "stores" half is literally covered (same pattern as the round-11 fix above).
- [x] ~~Upstream fix in cmdkit to unblock the `generate()` milestone: `defineCommand` / `HandlerContext` / SDK typing now accept a plain TS param shape (`packages/cmdkit/src/params.ts`, `index.ts`, `sdk.ts`), and `bearer-token-auth.ts:53-57` switched to the plain shape. Resolves the round-11 hard blocker and honors the "no cmdkit-schema / no zod" constraint for generated output. (Builder round 15.)~~ **REVERTED.** The "no cmdkit-schema" premise was a misreading of the project rule (see Design constraints). cmdkit-schema is the chosen params definition format. The plain-TS param shape work in `packages/cmdkit/src/params.ts` + `normalize-command-params.ts` and the consumer migrations in `packages/cmdkit/src/**`, `packages/superintendent/src/commands/**`, `packages/terminal-pilot/src/commands/**`, `packages/github-workflows/src/commands.ts`, and `packages/cmdkit-openapi/src/bearer-token-auth.ts` have been rolled back. Generator and handwritten commands both target `S.Object(...)`.
- [x] ~~cmdkit cleanup follow-up (KISS, non-blocking): collapse the dual param surface now that plain shapes are the canonical input. `CommandParamsDefinition = ObjectSchema<any> | CommandParamShape` at `packages/cmdkit/src/params.ts:94` keeps two live forms; migrate any remaining `S.Object(...)` callsites, drop the union (and the `isObjectSchema` guard at `:118`), remove the `@poe-code/cmdkit-schema` import at `:1`, and drop the `S` / schema re-exports at `packages/cmdkit/src/index.ts:775-790`. Does not block the `generate()` milestone — the generator can target the plain shape directly.~~ **OBSOLETE.** Superseded by the revert above — there is no dual param surface to collapse; `S.Object(...)` is the single form.
- [x] `http.ts` test cleanup (round 16, code-quality inspector): `packages/cmdkit-openapi/src/http.test.ts:172-183` and `:185-196` are duplicate "invalid path template" tests — same call, one asserts `instanceof UserError`, the other asserts the message. Merge into a single test asserting both.
- [x] ~~cmdkit internals note (round 16, code-quality inspector — non-blocking, scope clarification): `packages/cmdkit/src/normalize-command-params.ts` still imports `S` from `@poe-code/cmdkit-schema` to wrap plain shapes into `ObjectSchema` at runtime. The round-15 task collapsed the **public** param surface to plain TS (params.ts and index.ts are clean); fully removing `cmdkit-schema` from `cmdkit` runtime internals (`cli.ts`, `sdk.ts`, `mcp.ts` all still import it) is a larger refactor not scoped to this plan. The no-cmdkit-schema feedback applies to **consumer/generated code** — the generator will target `CommandParamShape` directly and will not pull in `cmdkit-schema`. No action required in this plan.~~ **OBSOLETE.** The premise (public param surface should be plain TS) is wrong — cmdkit-schema is the chosen format on both the public and internal surfaces. No action.
- [x] Implement `defineClient` with handwritten + generated merge, hard-fail collision detection, CLI-scope enforcement for auth commands, and `name` → MCP prefix derivation.
- [x] `defineClient` KISS follow-ups from round 18 code-quality inspector (all non-blocking, readability-only; declarative contract is intact): (a) collapse the two collision-throw branches at `define-client.ts:98-104` into one — the only recurse case is group+group, everything else is a collision (`if (existing.kind !== "group" || nextNode.kind !== "group") throw …`); (b) drop the dead `?? "generated"` fallback at `define-client.ts:126-131` in `createCollisionError` — `registerSource` always tags every incoming node before `mergeInto`, so `nodeSources.get(existing)` can't be undefined; silent fallback would mask a real bug; (c) unwind the nested ternary picking `scope` at `define-client.ts:176-180` into a 4-line if/else or extracted helper; (d) replace the manual char loop in `toMcpPrefix` at `define-client.ts:220-228` with `name.replaceAll("-", "_")` — the regex ban in CLAUDE.md applies to config-file parsing, not string transforms. (Nit 5 on the `bearerTokenAuth` `TokenSource` shim at `bearer-token-auth.ts:262-266` was reviewed and marked acceptable as-is — no action.)
- [x] `defineClient` nits from round 19 code-quality inspector (non-blocking, pick up alongside the next edit in this file — do not spin a dedicated round): (a) `define-client.ts:47-57` builds the root `Group` as an object literal with explicit `undefined` for `description`/`scope`/`requires`/`default`; swap to `defineGroup({ name, children: mergedChildren })` from `@poe-code/cmdkit` to match construction idiom used elsewhere and drop the undefineds; (b) `mergeChildren`'s `WeakMap<object, CommandSource>` at `define-client.ts:71` never escapes the call — a plain `Map` behaves identically and is the simpler default. Skip the `any`-in-`cloneCommand`/`cloneGroup` note (borderline generic-variance smell; no action until the AST generics are tightened upstream).
- [x] Implement pure `generate()` happy path: path params, scalar body, enum body, scalar query. Snapshot tests per case.
- [x] `generate()` post-revert params format (must-fix — uncovered during round 20 superintendent review): the generator now emits `S.Object({ … })` params with `S.String` / `S.Number` / `S.Boolean` / `S.Enum` and `S.Optional(...)`, snapshots were regenerated, and the auth/define-client tests pin the canonical cmdkit-schema surface so MCP coverage stays green.
- [x] `generate()` happy-path bugs from round 20 inspectors (must-fix before milestone 4): (a) `createParamDefinition` at `generate.ts:363-368` collapses OpenAPI `type: "integer"` to cmdkit `"number"`, so emitted MCP `inputSchema` advertises `{"type":"number"}` instead of `{"type":"integer"}` (plan §4 `list` example requires integer); preserve the integer distinction; (b) generated handler at `generate.ts:478-487` destructures only `{ params, baseUrl, tokenSource, fetch }` and never threads `dryRun` / `verbose` into `requestJson`, so the cross-cutting `--dry-run` / `-v` row at plan:279-281 is unreachable from any generated command — add them to the handler context pass-through; (c) `collectRequestBodyParams` does not honor `requestBody.required: false` — when the body itself is optional, required-within-body fields should still emit as optional flags. Snapshot tests must pin all three.
- [x] `generate()` declarative-drift and naming hygiene from round 20 code-quality inspector (fix before milestone 4 extends the renderer): (a) replace the four-branch `createParamDefinition` ladder at `generate.ts:341-380` with a `SCHEMA_TYPE_TO_KIND` table plus a single build path (enum stays one-line special-cased for `values`) — adding a scalar type becomes a one-line map entry; (b) extract a `renderDefaultLine(defaultValue)` helper out of `renderParamDefinition` at `generate.ts:514-531` so the enum and non-enum arms stop re-doing the default-line dance; (c) table-ize `renderRequestShape` at `generate.ts:537-562` — one pass over `[["path","pathParams"],["query","query"],["body","body"]]` replaces the triple-branch; (d) drop the `toSingular` + prefix-stripping inside `normalizeParamName` at `generate.ts:634-660`: `botHandle` must stay `botHandle` (camelCase → `--bot-handle`), never silently renamed to `handle`. `toSingular` is an English-only heuristic that mis-handles `address` / `news` / `kiss`, and the stripping violates the user's "explicit over implicit — no deriving behavior from naming conventions" rule. Alias overrides can land later if ergonomics demand; (e) table-ize `deriveVerb`'s method-based branching at `generate.ts:212` (`{ get: hasPathId ? "view" : "list", delete: "delete", … }`) so the upcoming `DELETE` confirm-injection doesn't tempt another `if (method === "delete")`. The table must include an explicit `delete → "delete"` entry: today the `get`-only branch falls through, so `DELETE /bots/{h}` with `operationId: "deleteBot"` would kebab-case to verb `delete-bot`, not the plan-required `delete` (spec-fidelity inspector, round 21); (f) extract `naming.ts` per plan:299 — `deriveNoun`, `deriveVerb`, `toKebabCase`, `splitWords`, `normalizeParamName`, and `toMcpPrefix` (currently in `define-client.ts:222-224`) belong together, and `generate.ts` is already 724 lines covering parse + collect + render + string ops + index assembly; (g) trim `splitWords` at `generate.ts:681-720` to a two-line tokenizer (collapse `-/_/space/.` then split on lower→upper boundaries).
- [x] `splitWords` acronym-boundary regression from round 23 code-quality inspector (must-fix before round 23 lands): the round-22/23 `splitCamelCaseWord` at `naming.ts:97-118` only split on `lower → UPPER`, so `createOAuthToken` → `["createoauthtoken"]`, `getSSOConfig` → `["get","ssoconfig"]`, `userAPIKey` → `["userapikey"]`. Restored the `UPPER → lower` arm (new-word when the uppercase character begins an acronym run's tail — `prev upper`, `curr upper`, `next lower`). Added naming test cases for all three acronym shapes. Existing `botHandle` / `set-image_comprehension.Mode` tokenizations unchanged.
- [x] `renderDefaultLine` proxy-only helper from round 23 code-quality inspector (must-fix — violates CLAUDE.md "no proxy-only functions"): the round-22/23 extraction at `generate.ts:557-559` was called from exactly one site in `renderSchemaOptions`; inlined back to `entries.push(\`default: ${JSON.stringify(param.definition.defaultValue)}\`)`. The plan task 697(b) motivation was to DRY the enum + non-enum arms, but the enum arm never used the helper (it emits `default` via the `S.Enum` positional ladder in `renderRequiredParamSchema`), so the helper only ever wrapped a single string template.
- [x] `generate()` — optional requestBody still sends `{}` on the wire from round 23 spec-fidelity inspector (behavior gap, milestone-4 work): when `requestBody.required !== true` and the caller supplies no body fields, `renderRequestShape` now omits the `body` entry entirely via a conditional spread, so `requestJson` sees `body === undefined` and does not send `Content-Type: application/json` or `"{}"`. Snapshot coverage and a focused multi-field generator test pin the emitted shape.
- [x] `generate()` declarative-drift regression from round 24 code-quality inspector (must-fix before round 25 lands): (a) `renderRequestShape` at `generate.ts:569-601` now has a body-specific `if (section.location === "body" && omitOptionalBodyWhenEmpty)` with a `continue` — this is exactly the per-location branching the table was built to eliminate. Attach the behavior to the table instead: extend `REQUEST_PARAM_SECTIONS` with an `omittable: boolean` (path/query → false, body → true) and pass a single derived `optionalSections` set (populated when `requestBody.required !== true`) into the renderer; the loop body becomes one code path driven by data. The `omitOptionalBodyWhenEmpty` flag that currently leaks through `createGeneratedCommand` → `createCommandFile` → `renderRequestShape` collapses to that set. (b) Revert the `SCHEMA_TYPE_TO_KIND` type regression at `generate.ts:17-25` — the previous `as const satisfies ...` form preserved per-key literal narrowing (`jsonType: "integer" | undefined` is looser than the per-key exact literal); no call-site motivated the downgrade. (c) Revert `DEFAULT_VERBS_BY_METHOD` at `naming.ts:5-17` to `Partial<Record<HttpMethod, ...>>` — the three explicit `undefined` entries for `patch`/`post`/`put` add noise without type-safety gain (lookups already returned `... | undefined`). YAGNI/KISS.
- [x] Remove the four round-25 source-scraping meta-tests at `generate.test.ts:18-30` and `naming.test.ts:7-14` flagged by the round-25 code-quality inspector: they `readFileSync` their own source and assert literal substrings (`'{ location: "body", key: "body", omittable: true }'`, `'as const satisfies Record<'`, `'satisfies Partial<Record<HttpMethod'`, `'patch: undefined'` etc.). CLAUDE.md bans tests that add code complexity — these are structural guards that break on Prettier/whitespace nudges without a regression, and let a reintroduced branch silently pass as long as the literal string differs. Behavioral tests already cover output fidelity. Deleted; suite now 89/89.
- [x] `generate()` — path-template vs `parameters[]` consistency guard from round 25 spec-fidelity inspector (behavior gap, milestone-4 work): if a spec declares path `/bots/{handle}` but the operation (and its path item) never lists a `parameters[].name === "handle"` with `in: "path"`, the generator emits a command with no `handle` flag; failure only surfaces at runtime as `UserError("Missing path parameter \"handle\"")` from `http.ts`. Add a generate-time check that every `{…}` placeholder in the path has a matching `in: "path"` parameter, throwing a `UserError` that names the operationId and the missing placeholder. Pair with task 702 (non-JSON response guard) — same class of generate-time spec-sanity check.
- [x] `generate()` — integer-enum downgrade from round 26 spec-fidelity inspector (spec-fidelity bug, must-fix before milestone 4): `createParamDefinition` at `generate.ts:372-380` takes the enum branch before consulting `schema.type`, so `{ type: "integer", enum: [1, 2] }` emits a plain `S.Enum([1, 2] as const)`. `EnumSchema` carries no `jsonType` field (`cmdkit-schema/src/index.ts:61-66`) and `getEnumJsonType` infers `type: "number"` from `typeof`, so the MCP `inputSchema` advertises `{"type":"number","enum":[1,2]}` instead of `{"type":"integer","enum":[1,2]}`. Integer-typed string enums are unaffected; numeric integer enums round-trip as `number`. Fix by either (a) threading `jsonType: "integer"` onto `EnumSchema` (mirroring the scalar fix from task 696a) and propagating it from the generator when `schema.type === "integer"`, or (b) refusing to emit integer-valued enums until cmdkit-schema supports the marker. Add a snapshot/behavior test pinning the emitted schema for an integer enum.
- [x] `createParamDefinition` declarative-drift regression from round 27 code-quality inspector (must-fix before milestone 4): the round-26 integer-enum fix at `generate.ts:378` restated the `integer → jsonType: "integer"` mapping inline (`schema.type === "integer" ? { jsonType: "integer" as const } : {}`), duplicating what `SCHEMA_TYPE_TO_KIND` at `generate.ts:17-25` already encodes for the scalar branch. Same class of rule-duplication flagged and fixed in rounds 24–26 (the `location === "body"` body-omit branch was killed by extending `REQUEST_PARAM_SECTIONS` with `omittable`). Derive `jsonType` from one lookup: compute `scalarDefinition` before the enum early-return and spread `...(scalarDefinition?.jsonType === undefined ? {} : { jsonType: scalarDefinition.jsonType })` into both the enum and scalar return objects. One source of truth; a future `format: "float"` or similar integer-like marker becomes a table entry, not a second `if`.
- [x] `generate()` — transport params leak into MCP `inputSchema` from round 27 spec-fidelity inspector (spec-fidelity violation, must-fix before milestone 4): `dryRun` / `verbose` now carry schema-level `scope: ["cli", "sdk"]` metadata in generated commands, and cmdkit's MCP emitter filters params by schema scope before building tool descriptions / `inputSchema`, so agents no longer see transport-only flags. Coverage: a generated-command renderer test pins the emitted scope metadata, and a cmdkit MCP test asserts excluded params do not appear in tool `inputSchema`.
- [x] `generate()` declarative-drift regression from round 29 code-quality inspector (must-fix before milestone 4 extends the renderer): the round-29 scope fix restated `transport → scope:["cli","sdk"]` inline at `generate.ts:611-613` (`if (param.location === "transport") entries.push('scope: ["cli", "sdk"]')`), duplicating the transport-param declaration at `generate.ts:223-239`. Same class of rule-duplication killed in rounds 24 (`location === "body"` → `REQUEST_PARAM_SECTIONS.omittable`), 25 (`jsonType` table), and 27 (integer-enum `jsonType` spread). Fix by the same pattern: add `scope?: readonly [string, ...string[]]` to `GeneratedParam` (or `GeneratedParamDefinition`), populate it at the transport-param declaration site in `collectParams`, and have `renderSchemaOptions` emit it generically like `jsonType` / `shortFlag` — one-line render, one source of truth. A future fourth scope or new transport-ish location becomes a data change, not a renderer change. Type scope as a non-empty tuple while we're there (empty `[]` would silently drop a field everywhere since `[].includes(x) === false`).
- [x] `mcp.ts` readability nits from round 29 code-quality inspector (non-blocking, fold into next edit on this file — do not spin a dedicated round): `filterSchemaForScope` now uses a `switch (schema.kind)` and keeps the narrow `params === undefined || params.kind !== "object"` guard in place as the defensive bug-check for a mis-scoped root object schema.
- [x] `generate()` spec-fidelity minor flags from round 29 spec-fidelity inspector (builder round 49): (a) query-array params now honor OpenAPI `style`/`explode` for the v1-supported forms — `form` + `explode:false` serializes as a comma-delimited single query value, `pipeDelimited` serializes as a pipe-delimited single value, and unsupported query-array styles fail fast at generate time instead of silently drifting on the wire; (b) `requestBody.description` now appends into the generated command / MCP description as `Request body: …` so body-level caveats survive codegen; (c) mixed-primitive enums are explicitly rejected at generate time (the existing `normalizeEnumValues` guard + test coverage now pin the behavior).
- [x] MCP tool-name format mismatch from round 28 spec-fidelity inspector (plan §124-133 violation; decision required before milestone 4, may require a change in `cmdkit` outside this package): adopted option (a). `packages/cmdkit/src/mcp.ts` now formats every MCP tool segment as snake_case and joins segments with `__`; single-root servers also include the root group name so `defineClient({ name: "internal-agent" })` surfaces tools like `internal_agent__bots__list`. Coverage: cmdkit MCP tests, the generated-client MCP test, and downstream superintendent / terminal-pilot MCP tool-surface tests now pin the convention.
- [x] `naming.ts` cleanup from round 26 code-quality inspector (builder round 52): `naming.ts` now uses an explicit `MethodDefaults` annotation for `METHOD_DEFAULTS`, so method lookups stay a plain `METHOD_DEFAULTS[method]` with no extra cast machinery. Kept the optional `collectPathPlaceholders` regex note out of scope — no such helper lives in `naming.ts` anymore, so there was nothing to simplify in this round.
- [x] `generate()` — non-JSON response latent runtime trap from round 23 spec-fidelity inspector (behavior gap, milestone-4 work): `http.ts:73-83` hard-requires an `application/json` (or `+json`) response content-type and throws otherwise. The generator now inspects declared 2xx responses up front and rejects non-JSON success media types (or `$ref` success responses it cannot inspect) with a clear `UserError`, while still allowing empty success responses like `204 No Content`.
- [x] `generate()` test coverage gaps on shipped code from round 20 testing inspector (builder round 53): `packages/cmdkit-openapi/src/generate.test.ts` now pins the shipped behaviors the generator already supported — `GET /bots/{h}` → `view`, `DELETE /bots/{h}` → `delete`, multi-tag ops use `tags[0]`, missing top-level `paths` throws, XML-only request bodies throw, `PUT`/`PATCH` serialize JSON bodies like `POST`, and identical inputs emit identical file arrays. Verified with `npm test -w @poe-code/cmdkit-openapi` (48 generator tests / 140 package tests green).
- [x] Extend `generate()`: array bodies (repeatable flag + `-json` variant), booleans, `DELETE` auto-confirm, `$ref` resolution, enum+nullable edge cases. Also carry over schema-constraint fidelity from round 20 spec-fidelity inspector — read and preserve `minimum` / `maximum` / `minLength` / `maxLength` / `minItems` / `maxItems` / `pattern` / `format` on the `OpenApiSchemaObject` so plan §4 `list` (`limit: {type:"integer", minimum:1, maximum:100}`) and plan §3 (`starters: {maxItems:4}`) round-trip into the MCP `inputSchema` 1:1. Also test the cookie/header `unsupported parameter location` throw at `generate.ts:404-408` (plan:508-510 currently only covers XML / ambiguous / missing-paths).
- [x] Implement `bin/generate.ts` + `openapi.lock` drift guard (`--check` exits non-zero on drift).
- [x] Create first consumer package `internal-agent-cli`: real OpenAPI spec at `packages/internal-agent-cli/openapi.json`, committed `src/generated/` output, `client.ts` wiring `defineClient` + `bearerTokenAuth({ serviceName: "poe-internal-agent", envVar: "INTERNAL_AGENT_TOKEN", whoamiPath: "/v1/whoami" })`, CLI entry at `src/bin.ts`, `README.md`, `openapi.lock` drift guard, and `client.test.ts`. The current spec exposes one generated operation so the surface is `agent list` + the `auth` group; `npm test` / `npm run generate:check` / `INTERNAL_AGENT_TOKEN=test-token npm run dev -- agent list --dry-run` pass; `--help` screenshot captured. (Builder round 37.)
- [x] MCP surface smoke test with `tiny-mcp-client`: confirm generated tools register, confirm auth commands are absent. Added `packages/internal-agent-cli/src/client.test.ts` coverage that lists the exposed MCP tools for the real consumer client (`internal_agent__agent__list` only, no auth commands) and round-trips the generated tool through `tiny-mcp-client` with a mocked JSON response. (Builder round 38.)
- [x] Cover every test case from the Testing section above; ensure snapshots are stable and tests run under the project's speed budget. Added the missing generator coverage for first-tag wins, GET-by-id → `view`, XML-only request bodies, missing `paths`, ambiguous missing-`operationId` verbs, PUT/PATCH JSON bodies, DELETE-with-body params, and deterministic output; tightened the `defineClient` nesting assertion so merged children remain visible after re-wrapping. Full `packages/cmdkit-openapi/src/**` + `packages/internal-agent-cli/src/client.test.ts` suite passes (124 tests, ~0.6s on Vitest).
- [x] Famous-spec smoke: ran `generate()` against Petstore, GitHub REST, Stripe, Slack, DigitalOcean via a one-op-at-a-time smoke pass; committed reduced generated output under `packages/cmdkit-openapi/fixtures/famous/<name>/` with `openapi.lock` + `NOTES.md` (counts, grouped skip reasons, spot checks, and obvious mismatches like Petstore GET naming drift and GitHub slashy `operationId` export/name breakage). Auth-gated execution was not required.
- [x] Manual verification pass on the famous-spec output: recorded `--help` / `--dry-run` findings in each fixture `NOTES.md`. Runnable samples were verified for Petstore (`store delete`) and GitHub (`billing view`) via ad hoc cmdkit roots, confirming the rendered flags and dry-run URLs. Stripe, Slack, and DigitalOcean still emit no runnable commands, so their notes now mark the manual pass as blocked on empty fixture output rather than a new CLI regression.
- [ ] Plan Target-UX examples (§1/§2/§3/§5) are stale post-task-697(d) from round 31 spec-fidelity inspector (plan-doc fix, non-blocking): the OpenAPI paths use `{botHandle}` but the CLI examples still show `--handle my-bot` and MCP `inputSchema` properties still show `handle`. Task 697(d) kills the `toSingular` / prefix-stripping heuristic, so `botHandle` is preserved — rendered flag is `--bot-handle` and MCP property is `botHandle`. Pass over the Target UX section and sync CLI flags + MCP `properties`/`required` arrays to the decided behavior (either change the examples to `--bot-handle` / `botHandle`, or change the OpenAPI paths to `/bots/{handle}` so `--handle` is consistent — pick one).
- [ ] Cmdkit MCP surface changelog / docs notes from round 31 code-quality inspector (non-blocking, fold into next README edit): task 710 changed two public-ish shapes on `packages/cmdkit` — (a) MCP tool names are now snake_case + `__`-joined, and the `casing` option on `RunMCPOptions` no longer influences tool naming (only parameter-key casing); tighten the `RunMCPOptions.casing` docstring / type comment to reflect that; (b) the allowlist key format changed from `.`-join to `__`-join, so any external `tools: ["group.child"]` consumer silently matches nothing after this change. No known external consumers, but worth a changelog entry when cmdkit ships next.
- [x] `defineClient` merge-then-reclone invariant from round 33 code-quality + testing inspectors (non-blocking, folded into the next edit on this file): took option (a). `mergeChildren` now carries an inline comment explaining that the trailing `cloneNode` pass re-snapshots groups after `mergeInto` mutates `existing.children`, because `defineGroup` captures an immutable child snapshot at construction time. `define-client.test.ts` now nests a client whose `bots` group is merged from generated + handwritten commands and asserts the wrapped group still exposes both `list` and `view`, so deleting the re-clone regresses behavior visibly.
- [x] `generate()` declarative-drift regressions from round 34 code-quality inspector: (a) `confirm: entry.method === "delete"` replaced — `METHOD_DEFAULTS` in `naming.ts` now carries per-method `confirm` alongside verbs, and the generator spreads `methodDefaults?.confirm` at the declaration site so adding a future confirm-requiring method is a one-line table entry. (b) `UserError` import is tracked via an explicit `requiresUserError` flag on `CollectedCommandParams` threaded into `createCommandFile` — no more `line.includes("UserError")` string-sniffing.
- [x] `generate()` spec-fidelity asymmetries from round 34 spec-fidelity inspector: nullable array body fields now emit the CLI `--<name>-null` helper; path params with `required !== true` fail at generate time with a clear `UserError`; query-array params now mirror array-body CLI UX with repeatable + `-json` shims while keeping MCP/SDK fidelity. Coverage lives in `packages/cmdkit-openapi/src/generate.test.ts`.
- [x] `generate()` round-35 code-quality follow-ups (builder round 52): (a) `preflightLines: string[]` + parallel `requiresUserError: boolean` replaced with `preflightBlocks: GeneratedPreflightBlock[]` where each block self-declares `imports`; `createCommandFile` aggregates `GeneratedCommandImport` set-membership once and drops the `.length > 0` / hardcoded-`true` drift. (b) `confirm` collapsed to `confirm: methodDefaults?.confirm === true` with `confirm: boolean` — the conditional spread + `confirm?: true` literal is gone. (c) Non-DELETE confirmability test removed; positive DELETE test remains and all other non-DELETE tests exercise the `false` path. Bundled cleanups: `expectParameter` returns a bare cast (task 733), `renderRequiredParamSchema` proxy inlined into `renderParamSchema` (task 741a), `bodyOptional` reused for `optionalSections` in `collectRequestBodyParams` (task 754b), and `emitsNullHelper` hoisted once in `createArrayParam` (task 750a). Also added a negative test proving `UserError` is **not** imported when no preflight guards are emitted. 48 generator tests green.
- [ ] `generate()` round-35 spec-fidelity follow-ups (decide scope alongside task 711; none block milestone 5): (a) `normalizeParamName` at `generate.ts:472-473,1179-1184` camelCases every OpenAPI parameter name before it surfaces on MCP — OpenAPI names like `x-trace-id` or `user_name` silently become `xTraceId` / `userName` on `inputSchema` while the wire still sends the original. Either preserve the OpenAPI name verbatim on the MCP surface (keeping the camelCase transform CLI-side only) or document the rename contract explicitly. (b) `SCHEMA_TYPE_TO_KIND.integer → { kind: "number", jsonType: "integer" }` at `generate.ts:19-27` — MCP `inputSchema.type` correctly advertises `integer`, but cmdkit-schema's runtime validator reads `kind: "number"` and accepts fractional values client-side. Thread `jsonType` into the validator so `integer` rejects fractions, or document that integer validation is server-side only. (c) `deriveArrayCliParamName` at `generate.ts:737-749` applies English-only singularization — `status` → `statu`, `kudos` → `kudo`, `bus` → `bu`, `lens` → `len`. Affects only the `--<name>` CLI repeatable helper (wire + MCP field names stay correct) but produces nonsensical flag names. Allowlist known-problematic suffixes or skip singularization entirely and emit `--<pluralName>` for each repeatable entry.
- [ ] `generate()` + `cmdkit-schema` hygiene nits from round 34 code-quality inspector (non-blocking, pick up alongside the next edit on these files — do not spin dedicated rounds): (a) `generate.ts:274-294` inlines `dryRun`/`verbose` transport params; hoist to a module-level `TRANSPORT_PARAMS` constant alongside `REQUEST_PARAM_SECTIONS`; (b) `generate.ts:350` has a redundant `as GeneratedRequestField[]` cast — the map already produces that shape; (c) `generate.ts:951-966` — `collectOptionalRequestSections` re-resolves the requestBody (`expectRequestBody`) after `collectRequestBodyParams` already walked it; fold the optional-sections info into `CollectedCommandParams` so the traversal happens once, and drop the misleading `operation.operationId ?? "requestBody"` fallback; (d) `generate.ts:1048-1054` builds a fake `GeneratedParam` via cast just to feed `renderSchemaOptions` — narrow the helper to take `{description, shortFlag, scope, definition}` directly; (e) `generate.ts:1065` — `options.slice(2)` strips a literal leading `", "` from a rendered string; return `{hasOptions: boolean, body: string}` or split into two builders (`renderOptionsSuffix` / `renderOptionsArgs`) so the comma-handling is structural; (f) `cmdkit-schema/src/index.ts:266` — `SchemaOptions<TDefault>` now carries `nullable?`, so the explicit `nullable?: boolean` on the `S.Enum` options intersection (and the redundant `readonly nullable?: boolean` on `EnumSchema` itself) can be removed; (g) file-size SRP: `generate.ts` is 1245 lines covering parse + ref-resolve + collect + render + index assembly — splitting into `ref.ts` / `collect.ts` / `render.ts` is worth considering, not blocking.
- [x] `generate()` spec-fidelity gaps from round 36 spec-fidelity inspector (generate-time sanity checks; decide scope alongside tasks 709/711 — none block milestones 5–6): (a) **Nullable enum drops `null` from the advertised enum list** — nullable enums now advertise `null` in JSON Schema output so MCP sees the accepted value explicitly. (b) **Enum values not cross-checked against `schema.type`** — `normalizeEnumValues` now rejects enums whose values disagree with the declared scalar type (including non-integer values for `type: "integer"`). (c) **No circular `$ref` detection** — ref resolution now threads a visited chain and throws a `UserError` naming the circular `$ref` path instead of overflowing the stack.
- [x] `--json` CLI flag missing on generated commands from round 37 testing inspector (shipped-code gap, not a test gap — plan §280-286 + §508 require it): generated commands with a non-empty success response schema now emit `json: S.Optional(S.Boolean({ scope: ["cli", "sdk"] }))`, snapshots pin the flag, the real `internal-agent-cli` generated output was regenerated, and `packages/cmdkit/src/cli.test.ts` now verifies a command-scoped `--json` flag forces JSON output over any rich renderer path.
- [x] `cli.ts` output-mode resolution split from round 39 code-quality inspector (declarativeness regression introduced by task 730; non-blocking but pick up before any further raw-output flag lands): promoted `json` into `GlobalFlags` so `resolveOutput()` is authoritative again, and strengthened `packages/cmdkit/src/cli.test.ts` to pin `--json` over an explicit `--output md` override. This removes the `executeCommand` sidecar branch and keeps future raw-output flags table-driven.
- [ ] `generate()` spec-fidelity gaps from round 37 spec-fidelity inspector (generate-time sanity checks; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Array query params do not serialize as repeated keys on the wire.** `collectOperationParameters` at `generate.ts:355-360` emits a scalar `valueExpression` for every query param regardless of `schema.type`; an OpenAPI `{ in: "query", schema: { type: "array", items: {...} } }` generates a command but `requestJson` never gets an array to serialize. Strictly wider than the CLI UX asymmetry tracked in task 725(c) — the SDK/MCP surface is also broken because the handler passes a scalar through. Fix the collector to detect array query schemas and thread an array `valueExpression` so `http.ts`'s existing repeated-key serialization kicks in. (b) **No generate-time reject for `requestBody` on GET/DELETE.** Generator silently accepts body on any method; `http.ts` drops the body at runtime (no `Content-Type`, no stringify) with no error. Add a generate-time `UserError` when `requestBody` appears on GET/DELETE, naming the operationId. Same class of sanity check as task 703 (path-template vs parameters[] consistency) and task 712 (non-JSON response). (c) **Nested object body properties not exercised.** The collector path for `schema.type === "object"` property values beyond scalar/enum/array is uncovered by tests and likely mis-emits (flattening vs nested). Pin expected shape with a snapshot; decide at that point whether nested objects flatten to dotted flags, emit a `-json` helper, or throw as unsupported in v1.
- [x] `generate()` code-quality nit from round 37 inspector (builder round 52, bundled with task 726): `expectParameter` now returns `parameter as SupportedOpenApiParameterObject` — the `...parameter, in: parameter.in` spread is gone. The negative `UserError`-import test was added alongside task 726(a)'s declarative preflight refactor, closing the positive-only coverage gap.
- [ ] `generate()` spec-fidelity gaps from round 38 spec-fidelity inspector (generate-time sanity checks; bundle under task 711 when constraint work lands — none block milestones 6–7): (a) **Top-level array / scalar request bodies rejected** at `generate.ts:390` (`schema.type !== "object"` throws), despite commit `2f014796` mentioning "array bodies" — only *fields inside* an object body can be arrays; a whole-body array (e.g. bulk create) has no path through the generator. Either emit a single `--body-json` positional for non-object top-level bodies or document the limitation explicitly in the README. (b) **`oneOf` / `anyOf` / `allOf` silently ignored** — `expectSchema` returns the schema as-is without inspecting these composition keywords, so they fall through to the generic `type: "unsupported"` throw with no dedicated message. Either reject with a composition-aware error naming the keyword, or handle the common `allOf: [$ref]` inheritance case (simple merge) before the scalar-dispatch. (c) **Media-type lookup inconsistency** at `generate.ts:380` — `content["application/json"]` is a byte-exact string match, so an OpenAPI spec declaring `application/json; charset=utf-8` or `application/vnd.api+json` is treated as missing JSON content and rejected, while the success-response side (`isJsonMediaType`) does loose matching. Align both sides on the same `isJsonMediaType`-style predicate so request/response fidelity is symmetric. (d) **Path parameter with non-scalar schema not validated** — `createParamDefinition` would accept `schema: { type: "array" }` for a path param and stringify it at runtime as `"[object Object]"` via `String(value)`. Add a generate-time `UserError` when a path param's schema is not a scalar primitive (`string` / `number` / `integer` / `boolean`). Same class of sanity check as task 703 (path-template vs parameters[] consistency). (e) **Header/cookie parameters hard-rejected** at `generate.ts:858` — no pass-through even for commonly-useful auth-adjacent headers like `X-Request-Id` or per-request `Authorization` overrides; the current throw says "unsupported parameter location" with no guidance. Keep the reject behavior, but clarify the error message so spec authors know the generator is intentional v1 scope. (f) **Required query array param has no auto `minItems: 1`** — spec-faithful (if the spec doesn't declare it, neither do we) but easy to overlook: an `in: "query", required: true, schema: { type: "array" }` surfaces in MCP `inputSchema` with no minimum element count even when the server will 400 on empty. No action required — flagging here so the "don't invent constraints" policy is explicit.
- [ ] `generate()` spec-fidelity gaps from round 40 spec-fidelity inspector (generate-time sanity checks; bundle under task 711 when constraint work lands — none block milestones 6–7): (a) **Per-operation `security` ignored.** `http.ts:143-148` always attaches `Authorization: Bearer <token>`; operations declaring `security: []` (explicitly public) or alternative schemes aren't reflected — every call gets the default auth header. Either read `operation.security` at generate time and gate the auth-header injection per command, or document that `security` is intentionally v1-uniform. (b) **Optional body + required children = silent partial body.** When `requestBody.required === false`, every property is forced `S.Optional`, including those in `schema.required`; a caller supplying *some* body fields but not the required ones sends a partial body and relies on server-side rejection. Consistent with "no client-side validation," but the MCP `inputSchema` claims the field is optional when OpenAPI says it's required-if-body-present — add an `anyOf` (all-required or none) at generate time, or document the asymmetry. (c) **`additionalProperties` / empty `properties` bodies emit no fields.** A `requestBody` with `properties: {}` + `additionalProperties: true` generates a command with no body params; nothing will ever send body content. Emit a `--body-json` fallback or reject at generate time. (d) **Query `null` serializes as empty string.** `appendQueryValue` in `http.ts` turns `null` into `""`, which is indistinguishable from an empty-string intent on the wire. Minor; OpenAPI has no canonical null-in-query encoding. No action unless a consumer hits it.
- [ ] Runtime argv coverage gap from round 40 testing inspector (documentation note; non-blocking): the "Argv parsing (generated CLI commands)" subsection of the Testing section (plan:589-605) is currently verified only via source snapshots of emitted code — numeric coercion errors, enum-bad-value errors, DELETE confirm-prompt flow (TTY vs non-TTY + `--yes`), `--json` output formatting, and non-TTY auto-JSON are exercised through generated-code text, not by invoking the generated commands at runtime. These behaviors are cmdkit's responsibility and are covered by `@poe-code/cmdkit`'s own tests; cmdkit-openapi only emits the declarations the snapshots verify. Decide whether to add a consumer-level invocation test in `internal-agent-cli` for literal runtime coverage, or leave as-is (declaratively sufficient).
- [x] `generate()` — array-param assembly duplication from round 41 code-quality inspector: `createArrayQueryParameter` and `createArrayBodyField` are now a single `createArrayParam({ location, supportsNullFlag, … })` dispatched through from both `createGeneratedParameter` (query) and `createBodyField` (body); the four-field return shape is captured once as `GeneratedParameterAssembly`. Collision bookkeeping on `GeneratedParam` moved from the misleading `originalName: <derivedCliName>` to `sourceName: <openApiName>`, so `Operation "listBots" maps both "tags" and "tag" to flag "tag"` now names the real OpenAPI source rather than the CLI alias (regression test at `generate.test.ts:1505` pins it). `requiresUserError` is now derived from the assembly return rather than a `preflightLines.length > 0` sniff on the body path.
- [x] `generate()` — query-array nullable asymmetry from round 41 code-quality + spec-fidelity inspectors: resolved as intentional omission (option b). Query `null` already serializes to an empty string on the wire (see 735(d)) so a CLI-only `--<name>-null` helper would add no signal. `createArrayParam` now takes a `supportsNullFlag` option (`query → false`, `body → true`); the rationale lives in an inline comment at the query dispatch site (`generate.ts:562-564`) and a focused regression test at `generate.test.ts:531` asserts that nullable query arrays emit no `<name>Null` flag.
- [ ] `generate()` naming asymmetry from round 42 code-quality inspector (non-blocking, internal-only nit; fold into the next edit on `generate.ts`): task 737 renamed `GeneratedParam.originalName → sourceName` because the field carried the OpenAPI source name, but `GeneratedRequestField.originalName` at `generate.ts:170` was kept. The two records now use divergent names for conceptually-adjacent fields (CLI-source vs wire-key). Consider renaming the request-field side to `wireName` for clarity. Both are module-internal, so purely a readability pass — no behavior change, no snapshot churn expected.
- [ ] `generate()` nullable-helper distribution from round 42 code-quality inspector (non-blocking; revisit if/when a query-side null gap surfaces): scalar nullable *body* fields synthesize a `--<name>-null` helper at `createBodyField` (`generate.ts:637-653`); scalar nullable *query* params do not. Same wire-protocol asymmetry as the array case just resolved in 738, but the decision logic is now spread across `createGeneratedParameter` / `createBodyField` / `createArrayParam`. Centralize the "does this location/shape support a null helper?" rule in one place so the answer is declarative across scalar+array × path/query/body. Bundle with task 735(d) if a query-null semantic ever shows up.
- [ ] `generate()` round-43 code-quality nits (non-blocking; fold into the next edit on this file — do not spin dedicated rounds): ~~(a) `renderRequiredParamSchema` proxy inlined~~ **done in builder round 52 alongside task 726** — inlined directly into `renderParamSchema`. (b) `createIndexFile` at `generate.ts:1365-1368` and `:1382-1385` sorts each noun's commands twice (once per render loop); compute the sorted commands once into a `Map<noun, sortedCommands[]>` before the import/export loops; (c) `hasJsonSuccessResponseSchema` at `generate.ts:361-385` and `assertSupportedSuccessResponses` at `:501-532` walk the same `operation.responses` shape with the same success-status/json-media predicates. Extract one walker that yields the success-response entries; let both consumers iterate it. Mirrors the DRY work already done on `REQUEST_PARAM_SECTIONS` / `SCHEMA_TYPE_TO_KIND` / `METHOD_DEFAULTS`.
- [ ] `generate()` spec-fidelity gaps from round 43 spec-fidelity inspector (generate-time / fidelity improvements; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Stripe + DigitalOcean emit zero commands** — strict `tags[0]`-required noun derivation (`deriveNoun` at `naming.ts`) skips 587/587 (Stripe) and 599/599 (DigitalOcean) operations on tag absence alone per `fixtures/famous/{stripe,digitalocean}/NOTES.md`. Either derive a fallback noun (e.g. first path segment after `/v1/`) or document the tag-required policy as a hard constraint. (b) **Command `description` drops spec `description`, uses only `summary`** — GitHub `activity/list-public-events` loses the 30s-6h latency caveat; `billing/get-budget-org` loses the "must be org admin/billing manager" note. Prefer `description` over `summary` (or concat both) so MCP/CLI help stays faithful to the spec's authoritative operation prose. (c) **`additionalProperties: false` silently dropped** on emitted MCP body schemas (e.g. `campaigns/update-campaign`) — not a wire issue but an MCP fidelity loss; thread through to cmdkit-schema's object-schema options.
- [ ] `generate.test.ts` snapshot-rule drift from round 43 testing inspector (documentation reconciliation, non-blocking): plan §463-465 states "Every generator test is a snapshot," but ~16 tests in `generate.test.ts` now use targeted `.toContain()` / `.not.toContain()` assertions (null-helper flags, confirm flag, transport params, PUT/PATCH body serialization, query-array CLI shim, ref resolution constraints). These are intentional single-line "rule" assertions, not snapshots. Either soften the plan wording (e.g. "snapshot by default; rule-level assertions where a single emitted line is the invariant under test") or convert the 16 tests to snapshot comparisons. Decide alongside task 736.
- [x] `generate()` GET verb collapses operation intent from round 44 spec-fidelity inspector (builder round 45): GETs on singleton or qualified paths now derive their verb from `operationId` intent. `deriveVerb` in `naming.ts` passes the noun to `deriveVerbFromOperationId`, which strips the tag prefix, trailing method/noun, and version tokens, then falls through to `METHOD_DEFAULTS.get.collection` only when the path tail is a plain collection noun. `internal-agent-cli`'s `GET /v1/whoami` now surfaces as `agent whoami` / MCP `internal_agent__agent__whoami` (regen committed: `packages/internal-agent-cli/src/generated/agent/whoami.ts`, `internal-agent-cli` index + `client.test.ts` updated). Naming+generate tests pin GET singleton / qualified / plain-collection paths.
- [x] `generate()` slash-in-operationId emits invalid TypeScript from round 44 spec-fidelity inspector (builder round 45): `splitWords` at `naming.ts:102-113` now normalizes `/` alongside `-`/`_`/`.`, and `deriveVerbFromOperationId` strips duplicate tag prefixes so slashy `operationId`s like GitHub's `actions/create-environment-variable` tokenize + dedupe correctly. Famous-spec fixture regen (follow-up task 749) is needed before the GitHub/Petstore counts in `fixtures/famous/*/NOTES.md` reflect the new surface.
- [x] `deriveVerb` declarative drift from round 45 code-quality inspector (builder round 52): `METHOD_DEFAULTS.get` now carries `genericVerbs` + `preferOperationIdWhenPathTailIsGeneric`, and `deriveVerb` keys off that table data instead of hard-branching on `method === "get"`. GET naming behavior is unchanged, but future method-specific intent rules are now a table edit instead of another branch.
- [x] `deriveVerbFromOperationId` pipeline-state leak + KISS nits from round 45 code-quality inspector (builder round 52): `deriveVerbFromOperationId` now returns just the derived verb, `deriveVerb` asks a dedicated `operationIdStartsWithCollectionVerb()` predicate when it needs the fallback decision, and the word-normalization path is split into named helpers (`normalizeOperationIdWords`, `stripLeadingGenericVerb`, `trimTrailingNounUnlessItConsumesAll`) with a single final `dedupeAdjacentWords()` pass. Left the `isVersionWord` scope unchanged for now — still good enough for current fixtures, exactly as the inspector allowed.
- [x] GET-collision test coverage regression from round 45 code-quality inspector (builder round 46): re-added GET collision coverage alongside the POST slashy-operationId collision test. `generate.test.ts` now pins the round-45 risk shape directly: two GET operations with the same noun + path tail (`/bots/search` and `/bots/{botHandle}/search`) but different operationIds (`getSearch` / `viewSearch`) both collide on `bots search`. This keeps GET-specific naming regressions covered after task 744 changed GET verb derivation.
- [ ] Famous-spec fixture regen + NOTES update from round 45 (non-blocking, behind tasks 744/745): `fixtures/famous/petstore/NOTES.md` flagged the `user logout → user list` / `store inventory → store list` collapses and `fixtures/famous/github/NOTES.md` attributed 676 command-path collisions + the invalid-TS `actions/` identifier to the GET-intent + slash-tokenization gaps. Both classes of fix are now in `naming.ts`, but the committed fixture output under `packages/cmdkit-openapi/fixtures/famous/{petstore,github}/generated/` has not been regenerated, so the fixture files still reflect the pre-round-45 surface. Rerun the famous-spec smoke (`packages/cmdkit-openapi` has the rig from task 719), commit the regenerated output, and update the NOTES counts so the task 744/745 claims match what is on disk.
- [ ] `generate()` round-44 code-quality nits from code-quality inspector (non-blocking, fold into next edit on `generate.ts` / `naming.ts` — do not spin dedicated rounds): ~~(a) **Duplicated nullability guard in `createArrayParam`**~~ **done in builder round 52 alongside task 726** — `emitsNullHelper` now hoisted once at the top of `createArrayParam`. (b) **`renderDefinition` if/else on `kind`** at `generate.ts:1227-1236` — replace with a `Record<ParamKind, Renderer>` table to match the rest of the file's table-driven style (`SCHEMA_TYPE_TO_KIND`, `REQUEST_PARAM_SECTIONS`, `METHOD_DEFAULTS`). (c) **`toCliFlag` (generate.ts:896) vs `toKebabCase` (naming.ts:75)** — two different kebab-ish converters in two files, easy to drift; consolidate on one exported helper in `naming.ts`. (d) **Two `schema.type === "array"` dispatch sites** at `generate.ts:552` (`createGeneratedParameter`) and `:603` (`createBodyField`) — works today, but the "is this an array?" decision lives in two places; a single `createField` router keyed on schema kind would stay declarative. Bundle (d) with (b) when the renderer table lands. (e) **`supportsNullFlag` / `hasJsonSuccessResponseSchema` as location-cap tables** — flag-threading on `createArrayParam` (query: false / body: true) and the inline ternary gating `--json` injection at `generate.ts:321-334,361-385` are both "capability → flag" decisions that read cleaner as `LOCATION_CAPS[location].nullHelper` and `{predicate, param}` table entries. Overlaps with task 740 — keep the resolution unified when that work lands.
- [ ] `generate-cli` spec-fetch failure-mode coverage from round 46 testing inspector (non-blocking, small gap): `bin/generate.ts` reads the OpenAPI spec (path or URL), but `generate-cli.test.ts` only exercises lock create/idempotent/regen/`--check`/malformed cases. Add tests that exercise the fetch layer's error surface — network error (fetch rejects), non-2xx response, invalid JSON body, request timeout — so the CLI's failure taxonomy is pinned. Leaves the happy path alone; mirrors the generate-time-sanity-check class (tasks 703 / 712 / 732) but on the fetch side.
- [ ] `cli.ts` round-47 code-quality nits from code-quality + spec-fidelity inspectors (non-blocking, fold into the next edit on this file — do not spin dedicated rounds): (a) `toDesignSystemOutput` at `cli.ts:1031-1041` is a 3-way `OutputMode → designSystem` if-chain; a `Record<OutputMode, ...>` lookup is one line and strictly typed — mirrors the table-driven style already used in `generate.ts` (`SCHEMA_TYPE_TO_KIND`, `REQUEST_PARAM_SECTIONS`, `METHOD_DEFAULTS`). (b) `GlobalFlags` at `cli.ts:43` is now a misnomer — task 731 added `json?: boolean` which is command-scoped (merged in via `optsWithGlobals()`), not a program-wide option; spec-fidelity inspector flagged the same. Rename to `ResolvedFlags`, or split into `GlobalFlags & CommandFlags`, so the type name reflects the shape Commander actually hands back. (c) Hold (a) from the raw cli.ts concerns (precedence list for `resolveOutput`) until a second raw-output flag (e.g. `--yaml`) actually lands — inspector explicitly said "two branches is fine" today.
- [ ] Round-47 testing inspector gaps — plan-wording staleness and literal-coverage edges (non-blocking, decide scope alongside tasks 713 / 736 / 743): (a) **MCP round-trip coverage** — `define-client.test.ts:109` asserts only the tool name (`internal_agent__bots__list`); no test drives a `callTool` through the MCP client pair end-to-end to verify schema/response handling for a generated command. `client.test.ts` (round 38, task 717) already round-trips one tool; consider whether a `cmdkit-openapi`-level MCP round-trip test belongs here or stays in the consumer package. (b) **4xx + non-JSON text body** — `http.test.ts` covers 4xx+JSON (`:298`) and 5xx+text (`:313`) but not 4xx+text directly; same code path as 5xx, low risk, literal gap vs. the "4xx → … raw string otherwise" plan bullet. (c) **Plan wording stale for DELETE `--yes` and body `format: date-time` ISO-8601 comment** — generator emits `confirm: true` (cmdkit's confirm mechanism replaces a literal `--yes` flag in the generator's concern) and preserves `format: "date-time"` on the schema rather than emitting an ISO-8601 comment (schema-based fidelity supersedes comment-based). Reconcile Testing-section wording (plan §589-605) instead of chasing the literal coverage — same class of plan-wording drift as task 743.
- [ ] `generate()` round-49 code-quality follow-ups (non-blocking, fold into the next edit on this file — do not spin a dedicated round): (a) **`location === "query"` branch inside `createArrayParam`** at `generate.ts:803-806` — `createArrayParam` was location-agnostic before task 709; the new inline ternary (`location === "query" ? renderQueryArrayValueExpression(...) : resolvedName`) reintroduces the per-location shape branching that rounds 24 (`REQUEST_PARAM_SECTIONS.omittable`), 27 (`jsonType` spread), 29 (`transport` scope), and 34 (`delete` confirm) each killed. Resolve the serialization at the caller (query dispatch site in `createGeneratedParameter`) and have every `GeneratedRequestField` carry its own already-resolved `valueExpression`; then `querySerialization?:` on `CreateArrayParamOptions` — currently an asymmetric option only one caller uses — also goes away and `createArrayParam` stays uniform. Overlaps with task 750(e) (`LOCATION_CAPS` table); bundle if both land at once. ~~(b) `bodyOptional` invariant duplicated~~ **done in builder round 52 alongside task 726** — `collectRequestBodyParams` now builds `optionalSections` from the existing `bodyOptional` local. (c) **`mergeCommandDescriptions` dedupe branch** — the `operationDescription === requestBodyDescription` guard defends against a malformed spec; not harmful, but the four branches for two optional strings collapse to two guards. YAGNI/KISS, non-blocking.
- [ ] `generate()` round-49 spec-fidelity test-coverage gap (non-blocking, fold into next test edit on this file): spec-fidelity inspector flagged that `$ref` resolution into `components/parameters`, `components/requestBodies`, and `components/responses` is implemented and exercised by existing tests but no snapshot asserts that the emitted output for a `$ref`'d parameter/requestBody/response is byte-identical to the inline form. The comma/pipe serialization and nullable-enum `null`-in-enum cases flagged in the same report already have coverage in `generate.test.ts` (added in builder round 49). Adding three positive snapshot equivalences (inline vs `$ref`) would close the last piece — keep narrow.
- [ ] `defineClient` test YAGNI nit from round 50 code-quality inspector (non-blocking, one-line cleanup — fold into the next edit on `define-client.test.ts`): the nesting test at `define-client.test.ts:193-233` now makes two equivalent assertions — the `toMatchObject` at `:207-217` already recurses `wrapper.children[0] → bots → [{name:"list"}, {name:"view"}]`, so dropping the `mergeChildren` re-clone (the invariant round 50 pinned) fails that assertion. Lines `:219-232` re-extract `wrapper.children[0]`, narrow to `kind === "group"`, find the `bots` child, and re-assert the same `{kind, name, children:[list, view]}` shape — a duplicate through the same path with the same expectations. CLAUDE.md bans tests that add code complexity without added coverage. Drop `:219-232` and keep the single `toMatchObject` (or swap to the narrowed-extraction form if the typed path is preferred — but only one of the two). Verified: the first assertion is sufficient to regress if the re-clone is removed.
- [ ] `stripLeadingGenericVerb` dead loop from round 52 code-quality inspector (YAGNI cleanup, non-blocking — fold into the next edit on `naming.ts`): the `while (start < words.length - 1 && words[start] === words[0])` loop at `naming.ts:191-194` is unreachable. `normalizeOperationIdWords` terminates with `dedupeAdjacentWords`, so by the time the loop runs, `words[0] !== words[1]` is guaranteed and the loop body never executes. Collapse the body to `return words.slice(1)`. No behavior change expected; tests stay green. (Inspector also flagged two nits marked as no-action: `genericVerbs` + `preferOperationIdWhenPathTailIsGeneric` travel together but are defensibly kept separate per the explicit-over-implicit rule; `normalizeOperationIdWords` called twice in the GET path is a minor repeated-work nit, refactor only if it becomes hot.)
- [ ] `generate()` spec-fidelity gaps flagged by round 53 spec-fidelity inspector (generate-time sanity + fidelity fixes; bundle under task 711 when constraint work lands — none block milestone 7): (a) **OPTIONS / HEAD / TRACE silently dropped.** `HTTP_METHOD_ORDER` at `generate.ts:12` covers only GET/POST/PUT/PATCH/DELETE; a path item declaring `head` / `options` / `trace` yields zero commands and zero warnings. Either emit a clear generate-time `UserError` naming the operationId + method, or explicitly document the v1 subset so spec authors don't silently lose operations. Same class of sanity check as task 703 / 712 / 732 / 734a. (b) **Required + nullable scalar body field unreachable from CLI.** `createBodyField` (`generate.ts:658-677`) marks the primary `paramName` with no `scope` restriction; when that field is required (body required + listed in `schema.required`) and `nullable: true`, cmdkit's required-validation forces `--<name>` and the preflight marks `--<name>` + `--<name>-null` mutually exclusive, so no CLI invocation can send `null`. Either gate the primary to `scope: ["mcp","sdk"]` when a null helper exists, or relax the preflight so `--<name>-null` satisfies required. Not covered by existing tests (the scalar-nullable snapshot uses `requestBody.required: false`, which forces the field optional). Adjacent to tasks 725 / 740 but a different concrete bug. (c) **Nullable query array advertises `null` to MCP/SDK but wire sends empty string.** `createArrayParam` (`generate.ts:713-723`) still copies `nullable: true` into the MCP/SDK schema for query arrays even though `supportsNullFlag: false` and `http.ts:139` coerces `null` → `""` (see task 738 + task 735d). Either strip `nullable: true` from the query-array definition (symmetry with the decision not to emit `--<name>-null` CLI-side) or document the wire mapping explicitly. (d) **`mergeCommandDescriptions` concat is an invention.** Already tracked as task 754(c) follow-up — the `operationDescription + "\n\nRequest body: …"` format at `generate.ts:1266-1283` is not an OpenAPI concept; MCP descriptions drift from spec-verbatim. Fold into 754(c) when that lands.
- [ ] `generate()` spec-fidelity bugs flagged by round 52 spec-fidelity inspector (generate-time sanity + fidelity fixes; bundle under task 711 when constraint work lands — none block milestone 7): ~~(a) **Array path params silently accepted, runtime-incorrect.**~~ **done in builder round 54** — `createGeneratedParameter` at `generate.ts:572` now throws a `UserError` when `parameter.in === "path"` and `schema.type` is `array` or `object`, listing the scalar types (string/number/integer/boolean) allowed. Symmetric with the adjacent `parameter.in === "path" && schema.type === "array"` query branch. Coverage: two focused generator tests at `generate.test.ts` pin both rejections (array + object path schemas). Same class of sanity check as task 703 / 712 / 732a. (b) **`readOnly` / `writeOnly` ignored on body fields.** `collectRequestBodyParams` at `generate.ts:490` iterates every `schema.properties` entry; spec says `readOnly: true` must be stripped from *request* bodies (they are response-only). Generator emits them as CLI/MCP params that, if set, either get rejected server-side or silently ignored. Strip `readOnly: true` from request bodies; symmetrically, `writeOnly: true` on response shapes (only relevant once response schemas are inspected for something other than the `--json` gate, so minor today). (c) **Per-command `json` param is dead after task 731.** `hasJsonSuccessResponseSchema(...)` at `generate.ts:337-349` still injects a per-command `json: S.Optional(S.Boolean({ scope: ["cli", "sdk"] }))` transport param, but task 731 promoted `json` to cmdkit's `GlobalFlags` and the generated handler never consumes `params.json` (only `dryRun`/`verbose` flow into `requestJson`). The global flag reaches `resolveOutput` authoritatively; the per-command declaration is dead code. Drop the injection (and the `hasJsonSuccessResponseSchema` gate) or document why both are needed. Low-risk cleanup.
