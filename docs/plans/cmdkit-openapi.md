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
  round: 26
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
- [ ] `defineClient` nits from round 19 code-quality inspector (non-blocking, pick up alongside the next edit in this file — do not spin a dedicated round): (a) `define-client.ts:47-57` builds the root `Group` as an object literal with explicit `undefined` for `description`/`scope`/`requires`/`default`; swap to `defineGroup({ name, children: mergedChildren })` from `@poe-code/cmdkit` to match construction idiom used elsewhere and drop the undefineds; (b) `mergeChildren`'s `WeakMap<object, CommandSource>` at `define-client.ts:71` never escapes the call — a plain `Map` behaves identically and is the simpler default. Skip the `any`-in-`cloneCommand`/`cloneGroup` note (borderline generic-variance smell; no action until the AST generics are tightened upstream).
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
- [ ] `generate()` — integer-enum downgrade from round 26 spec-fidelity inspector (spec-fidelity bug, must-fix before milestone 4): `createParamDefinition` at `generate.ts:372-380` takes the enum branch before consulting `schema.type`, so `{ type: "integer", enum: [1, 2] }` emits a plain `S.Enum([1, 2] as const)`. `EnumSchema` carries no `jsonType` field (`cmdkit-schema/src/index.ts:61-66`) and `getEnumJsonType` infers `type: "number"` from `typeof`, so the MCP `inputSchema` advertises `{"type":"number","enum":[1,2]}` instead of `{"type":"integer","enum":[1,2]}`. Integer-typed string enums are unaffected; numeric integer enums round-trip as `number`. Fix by either (a) threading `jsonType: "integer"` onto `EnumSchema` (mirroring the scalar fix from task 696a) and propagating it from the generator when `schema.type === "integer"`, or (b) refusing to emit integer-valued enums until cmdkit-schema supports the marker. Add a snapshot/behavior test pinning the emitted schema for an integer enum.
- [ ] `naming.ts` cleanup from round 26 code-quality inspector (KISS nit, non-blocking — fold into the next edit on this file): the `as keyof typeof DEFAULT_VERBS_BY_METHOD` cast at `naming.ts:42` is redundant. The `satisfies Partial<Record<HttpMethod, …>>` form on `DEFAULT_VERBS_BY_METHOD` preserves per-key literal narrowing, so switching the table declaration to an explicit `Partial<Record<HttpMethod, { collection: string; resource: string }>>` annotation (and dropping `as const satisfies …`) lets the lookup be a bare `DEFAULT_VERBS_BY_METHOD[method]` returning `… | undefined`. Same runtime behavior, no cast. (Inspector also considered whether `collectPathPlaceholders`'s 20-line loop should collapse to `path.matchAll(/\{([^}]+)\}/g)` — CLAUDE.md's regex ban is scoped to config-file parsing, not path templating, so the one-liner is acceptable if the author agrees. Bundle with this cleanup if convenient; otherwise skip.)
- [ ] `generate()` — non-JSON response latent runtime trap from round 23 spec-fidelity inspector (behavior gap, milestone-4 work): `http.ts:73-83` hard-requires an `application/json` (or `+json`) response content-type and throws otherwise. The generator never consults `operation.responses`, so an operation declaring only `text/plain` or `application/octet-stream` success still emits `requestJson`, guaranteeing runtime failure. Either inspect `responses.*.content` at generate time and throw a clear "only application/json responses supported in v1" error (matching the requestBody guard at `generate.ts:285-287`), or emit a marker comment and let the runtime surface the existing `HttpError`. Track here; decide scope alongside task 699.
- [ ] `generate()` test coverage gaps on shipped code from round 20 testing inspector (roll into the "Cover every test case" task; does not block milestone 4): add tests for behaviors already implemented but unexercised — `GET /bots/{h}` → verb `view` (generate.ts:212-213); `DELETE /bots/{h}` → verb `delete` (test lands after 697(e) adds the `delete → "delete"` table entry — current fallthrough produces `delete-bot`, not `delete`); `tags: ["a","b"]` → first wins; spec missing `paths` → throws (generate.ts:117); `requestBody.content["application/xml"]`-only → throws (generate.ts:285-287); `PUT` and `PATCH` with body emit JSON body same as `POST`; deterministic output (same input → identical bytes, including stable key/file ordering).
- [ ] Extend `generate()`: array bodies (repeatable flag + `-json` variant), booleans, `DELETE` auto-confirm, `$ref` resolution, enum+nullable edge cases. Also carry over schema-constraint fidelity from round 20 spec-fidelity inspector — read and preserve `minimum` / `maximum` / `minLength` / `maxLength` / `minItems` / `maxItems` / `pattern` / `format` on the `OpenApiSchemaObject` so plan §4 `list` (`limit: {type:"integer", minimum:1, maximum:100}`) and plan §3 (`starters: {maxItems:4}`) round-trip into the MCP `inputSchema` 1:1. Also test the cookie/header `unsupported parameter location` throw at `generate.ts:404-408` (plan:508-510 currently only covers XML / ambiguous / missing-paths).
- [ ] Implement `bin/generate.ts` + `openapi.lock` drift guard (`--check` exits non-zero on drift).
- [ ] Create first consumer package `internal-agent-cli`: real OpenAPI spec, committed `generated/` output, `bearerTokenAuth` wired, smoke test via `npm run dev`.
- [ ] MCP surface smoke test with `tiny-mcp-client`: confirm generated tools register, confirm auth commands are absent.
- [ ] Cover every test case from the Testing section above; ensure snapshots are stable and tests run under the project's speed budget.
- [ ] Famous-spec smoke: run `generate()` against Petstore, GitHub REST, Stripe, Slack, DigitalOcean. Commit output under `fixtures/famous/<name>/` with a short `NOTES.md` (op count, emitted count, skipped-with-reason, 3 spot checks). Auth-gated execution is not required; 401s are acceptable.
- [ ] Manual verification pass on the famous-spec output: pick one generated command per spec, run `--help` and `--dry-run`, confirm flags and URL look right. Record findings in the same `NOTES.md`.
