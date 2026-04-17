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

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 100

status:
  state: in_progress
  round: 0
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
  getToken(): Promise<string | null>;
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
3. `null` — commands print `run 'internal-agent auth login' first` and exit 2.

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
- `TokenSource.getToken()` returns `null` → request rejected before fetch with exit-2 message.

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
- Env var unset + store empty → returns `null`.
- `invalidate()` → store entry deleted; next `getToken()` returns env if set, else `null`.

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

- [ ] Scaffold `@poe-code/cmdkit-openapi` package with `AuthProvider` / `TokenSource` / `CommandContributor` interfaces and a README listing env vars and options.
- [ ] Implement `http.ts` — shared fetch wrapper: auth header injection, URL joining, query/body serialization, non-2xx throw shape, 401 → `invalidate()`, `--dry-run`, `-v`.
- [ ] Implement `bearerTokenAuth` using `@poe-code/auth-store`: env → store → null resolution, `login` / `logout` / `status` commands, whoami verification, `is_employee` gate.
- [ ] Implement `defineClient` with handwritten + generated merge, hard-fail collision detection, CLI-scope enforcement for auth commands, and `name` → MCP prefix derivation.
- [ ] Implement pure `generate()` happy path: path params, scalar body, enum body, scalar query. Snapshot tests per case.
- [ ] Extend `generate()`: array bodies (repeatable flag + `-json` variant), booleans, `DELETE` auto-confirm, `$ref` resolution, enum+nullable edge cases.
- [ ] Implement `bin/generate.ts` + `openapi.lock` drift guard (`--check` exits non-zero on drift).
- [ ] Create first consumer package `internal-agent-cli`: real OpenAPI spec, committed `generated/` output, `bearerTokenAuth` wired, smoke test via `npm run dev`.
- [ ] MCP surface smoke test with `tiny-mcp-client`: confirm generated tools register, confirm auth commands are absent.
- [ ] Cover every test case from the Testing section above; ensure snapshots are stable and tests run under the project's speed budget.
- [ ] Famous-spec smoke: run `generate()` against Petstore, GitHub REST, Stripe, Slack, DigitalOcean. Commit output under `fixtures/famous/<name>/` with a short `NOTES.md` (op count, emitted count, skipped-with-reason, 3 spot checks). Auth-gated execution is not required; 401s are acceptable.
- [ ] Manual verification pass on the famous-spec output: pick one generated command per spec, run `--help` and `--dry-run`, confirm flags and URL look right. Record findings in the same `NOTES.md`.
