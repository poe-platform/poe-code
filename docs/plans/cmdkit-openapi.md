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

      Fix or refactor issues.

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

    Consolidate similar or simple tasks together so we are able to resolve them all and converge.

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

max_rounds: 110

status:
  state: in_progress
  round: 94
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

- **Codegen is the default.** Commands are emitted as committed `.ts` files so
  diffs are reviewable and types are real. No runtime OpenAPI parsing in the hot path.
- **Runtime generation is an opt-in alternative.** Consumers can skip the build step
  and build the command tree from the spec on startup instead. Same parser, same
  naming, same auth plumbing — just no files and no types for the emitted surface.
  Trades zero-build ergonomics for startup cost and loss of reviewable diffs. See
  the "Runtime generation mode" section for the API and trade-offs.
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

Canonical case (POST with path param + scalar body) — `POST /bots/{botHandle}/actions/set-official` body `{ official: boolean }`:

```
internal-agent bots set-official --bot-handle my-bot --official true
internal-agent bots set-official --bot-handle my-bot --no-official   # boolean sugar
```

```json
{
  "name": "internal_agent__bots__set_official",
  "inputSchema": {
    "type": "object",
    "required": ["botHandle", "official"],
    "properties": {
      "botHandle": { "type": "string" },
      "official":  { "type": "boolean" }
    }
  }
}
```

Shape variants the generator must handle in v1:

- **Enum body** (`{ mode: "off"|"auto"|"forced" }`) — `--mode auto`; MCP carries `enum`.
- **Array body** (`{ starters: string[] }`) — CLI repeatable `--starter` + script-friendly `--starters-json`, mutually exclusive. MCP gets native array.
- **Query params** (`GET /bots?owner=&cursor=&limit=`) — scalar flags; pretty table for TTY, JSON when piped or `--json`.
- **GET by id / DELETE** (`/bots/{botHandle}`) — verbs `view` / `delete`; DELETE auto-injects confirm prompt + `--yes` (CLI only, MCP is one-shot).

### Cross-cutting conventions baked into every generated command

| Concern   | CLI                                               | MCP                                                   |
|-----------|---------------------------------------------------|-------------------------------------------------------|
| Auth      | resolved via `AuthProvider` (env → keychain)      | same `TokenSource`, set at server start               |
| Errors    | non-2xx → red error line + exit 2                 | non-2xx → `isError: true`, body `{status, body}`      |
| Output    | pretty by default; global `--json` for raw JSON   | always raw JSON                                       |
| Verbosity | `-v` logs request line                            | N/A                                                   |
| Dry run   | `--dry-run` prints the HTTP request and exits     | N/A                                                   |
| Naming    | `<noun> <verb>` (`bots set-official`)             | `internal_agent__<noun>__<verb>` (snake_case required)|

The CLI↔MCP name mapping is the one real asymmetry and is hardcoded in `naming.ts` —
one place to change it, not per-command branching.

## Runtime generation mode

Opt-in alternative to codegen: build the command tree from the spec at process startup, return it as `Command[]`, hand it to `defineClient` like any other command list. No files, no lock, no committed output.

```ts
import { defineClient, commandsFromSpec, bearerTokenAuth } from "@poe-code/cmdkit-openapi";

export default defineClient({
  name: "internal-agent",
  baseUrl: "https://www.i.quora.com/api/internal_agent",
  auth: bearerTokenAuth({ ... }),
  commands: await commandsFromSpec("./openapi.json"),
});
```

`commandsFromSpec(source, opts?)` accepts a path, URL, or pre-parsed OpenAPI doc and returns `Promise<Command[]>`. Reuses the in-memory stage of `generate()` — same naming, param flattening, MCP schema, auth injection. Handwritten commands still merge via `defineClient`'s collision check.

**Trade-offs.** Lose reviewable diffs on spec changes, typed `generated` imports, and the `openapi.lock` drift guard; pay startup cost on every launch. Use codegen for shipping CLIs and CI-guarded consumers; use runtime for experiments, one-off probes, or consumers that can't own a generated directory.

## Package layout

```
packages/cmdkit-openapi/
  src/
    generate.ts              # pure: (spec, opts) → { files[], commands[] }
    runtime.ts               # commandsFromSpec: spec → Command[] in memory
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

Strategy + Provider/Contributor pattern (modelled on Azure `TokenCredential` / Go `oauth2.TokenSource`, not Passport).

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

- `auth login` — reads token (flag / `--token-stdin` / TTY prompt) → calls `whoamiPath` if set → rejects if `!is_employee` → stores via `auth-store`.
- `auth logout` — removes stored credential; idempotent.
- `auth status` — prints resolved token source (env / keychain / none) and identity if `whoamiPath` is set. Explicit source precedence makes 401s diagnosable in one command.

### 401 handling

`http.ts` calls `tokenSource.invalidate?.()` on a 401 before surfacing the error. For
`bearerTokenAuth`, `invalidate()` deletes the stored entry — next run will prompt
re-login rather than silently re-sending a dead token.

### Forward compatibility

Future providers (`oauthAuth`, `mTlsAuth`, …) implement the same `AuthProvider` shape and drop in with zero changes to consumer code or generated commands. YAGNI-gated until a real API needs them.

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

Each test is a single assertion. Grouped by unit under test. Generator tests snapshot
emitted command/module shapes by default against handwritten OpenAPI 3 fixtures, with
focused rule assertions (`toContain`, `not.toContain`, etc.) when one emitted line is
the invariant under test. Runtime tests use mocked `fetch` and an in-memory
`auth-store` (no network, no FS).

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
- Body field `format: date-time` → string flag; emitted schema preserves `format: "date-time"` metadata (no parsing).

HTTP method coverage:

- `POST` with body → JSON body emitted.
- `PUT` with body → same as POST (no special handling).
- `PATCH` with body → same as POST.
- `GET` with no body → no body serialization call.
- `DELETE` with no body → generated command sets `confirm: true` (cmdkit confirm prompt hook).
- `DELETE` with body → `confirm: true` plus body flags both present.

Output surfaces:

- Emitted file contains banner with `spec-sha` + `operation-id`.
- Emitted file exports a single `Command` matching cmdkit's `Command` shape.
- MCP `inputSchema.properties` matches OpenAPI schema 1:1 for scalar, enum, array, integer.
- MCP `inputSchema.required` matches OpenAPI `required` + path params.
- Raw JSON output stays available via cmdkit's global `--json` flag; generated commands do not emit a per-command `json` param.
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

Generated commands are pure `defineCommand(...)` declarations. Argv parsing and coercion
are owned by `@poe-code/cmdkit` / `@poe-code/cmdkit-schema`, with consumer smoke
coverage in `packages/internal-agent-cli`; this package snapshots the emitted command
shape rather than re-testing parser behavior locally.

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

Run `generate()` against well-known public specs; commit output + `NOTES.md` under `packages/cmdkit-openapi/fixtures/famous/<name>/` with counts (emitted / skipped+reason), 3-command spot checks, and any uncovered throws filed as follow-up tests. Specs: Petstore (tiny), GitHub REST (huge, deeply tagged), Stripe (nested schemas), Slack (form-encoded — JSON-only guard fires), DigitalOcean (YAML input). Auth-gated calls 401, execution not required.

### Not covered by tests in this plan

Live-API e2e (owned by first consumer package), OAuth, pagination, retries, streaming.

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

### Shipped (milestones 1–7)

- **Package + infra.** `@poe-code/cmdkit-openapi` scaffold, `AuthProvider` / `TokenSource` / `CommandContributor` interfaces, `http.ts` fetch wrapper (auth-header injection, URL joining, query/body serialization, JSON-only response guard, 401 → `invalidate()`, `--dry-run` with bearer redaction, `-v`, `UserError` taxonomy).
- **Auth.** `bearerTokenAuth` via `@poe-code/auth-store` (env → store → null resolution, `login` / `logout` / `status` commands, optional whoami + `is_employee` gate).
- **Client wiring.** `defineClient` merges handwritten + generated trees with hard-fail collision detection, tags auth commands CLI-scope only, derives MCP prefix from `name`.
- **`generate()`.** Pure happy path (path / query / body / enum scalars) through declarative emission (`SCHEMA_TYPE_TO_KIND`, `METHOD_DEFAULTS`, `REQUEST_PARAM_SECTIONS`, `FIELD_ASSEMBLERS`, `NULL_HELPER_SUPPORT`). Extensions: array bodies (repeatable flag + `--*-json`), booleans, `DELETE` auto-confirm, `$ref` resolution (local + component), enum + nullable edge cases, schema constraints (`minimum`/`maximum`/`minLength`/`maxLength`/`minItems`/`maxItems`/`pattern`/`format`), integer enums, query-array `style` / `explode`, top-level scalar + array request bodies, cross-cutting `--dry-run` / `-v` / `--json` threaded to handlers.
- **Generate-time spec-sanity guards.** XML-only bodies, missing `paths`, ambiguous missing `operationId`, path-template ↔ `parameters[]` consistency (both directions), cookie/header params (rejected with migration hint), `oneOf`/`anyOf`/`allOf`, nested object request bodies, `additionalProperties`, array/object path params, `security: []` → `auth: "none"`, document-level `security` inheritance, circular `$ref`, integer-enum type preservation, mixed-primitive enum rejection, operation-level `$ref` (external refs fail fast, local resolve), noun → valid TS identifier, HEAD/OPTIONS/TRACE rejected. Every guard throws `UserError` naming the operationId.
- **Naming (`naming.ts`).** Verbatim OpenAPI parameter names (`bot_handle` / `x-trace-id` preserved through params, `inputSchema` keys, and `pathParams`), camelCase preserved (`botHandle` stays `botHandle`), acronym-aware word splitting, GET-on-singleton derives verb from `operationId` intent, tag-missing falls back to first static non-`api`/non-version path segment, declarative `METHOD_DEFAULTS` table drives verb + `confirm`, MCP prefix derived from `defineClient({ name })`.
- **Transport + MCP.** Transport flags (`dryRun` / `verbose`) carry `scope: ["cli","sdk"]` so MCP `inputSchema` never advertises them; MCP tool names are snake_case + `__`-joined with the root group name included for single-root servers; `cmdkit`'s global `--json` flag forces JSON over any renderer; generated commands emit `--json` when the response carries a schema; integer validation (`jsonType: "integer"`) enforced uniformly across CLI / MCP / SDK via `number-schema.ts`.
- **`bin/generate.ts` + lock.** Reads path/URL/pre-parsed spec, writes files, updates `openapi.lock`; `--check` exits non-zero on drift.
- **Runtime mode.** `commandsFromSpec(source, opts?)` reuses the in-memory stage of `generate()` to build cmdkit groups from a path/URL/pre-parsed spec without file emission; `defineClient` accepts the result unchanged.
- **Structural IR.** Runtime executes IR instead of eval'd source: `GeneratedRequestField` carries data references/serializers, `GeneratedPreflightBlock` is a typed union, `runtime.ts` executes directly with no `new Function(...)`.
- **First consumer: `internal-agent-cli`.** Real spec, committed `src/generated/`, `client.ts` wiring `bearerTokenAuth({ serviceName: "poe-internal-agent", envVar: "INTERNAL_AGENT_TOKEN", whoamiPath: "/v1/whoami" })`, `bin.ts`, README, `openapi.lock`, MCP round-trip test (`internal_agent__agent__*` only, no auth), runtime invocation coverage in `bin.test.ts` (JSON output, `--dry-run`, `-v`).
- **Famous-spec smokes.** Petstore / GitHub / Stripe / Slack / DigitalOcean under `packages/cmdkit-openapi/fixtures/famous/<name>/` with `openapi.lock` + `NOTES.md` (counts, grouped skip reasons, spot checks).
- **Zero-command index emits valid empty module.** `generated/index.ts` now emits `export {};` when the spec yields no commands (no dangling `defineGroup` import); Slack + Stripe fixtures refreshed; covered in `generate.test.ts` + `generate-cli.test.ts`.
- **Structural-IR dispatch-table sweep + SRP file-split.** Writer and runtime now share tables keyed on IR kind: `FIELD_ASSEMBLERS[location][schemaKind]`, `DEFINITION_RENDERERS` / `RUNTIME_DEFINITION_BUILDERS`, `VALUE_EXPRESSION_OPERATIONS` / `VALUE_REFERENCE_OPERATIONS`, `PREFLIGHT_BLOCK_OPERATIONS` (symmetric render + execute), `REQUEST_SECTION_OPERATIONS`. Shared `groupByNoun(...)` helper; runtime-only execution moved out of `generate.ts` into `runtime.ts` / `interpreter.ts` / `request-shape.ts`. Parity test drives one fixture through codegen + runtime and asserts identical behavior (`runtime.test.ts`). `isIdentifierName` consolidated into `naming.ts`; redundant path-shape pre-check and dead `renderParamAccess` removed. Build-green fixes: `bearer-token-auth.ts` whoami passes `auth`; `spec-source.ts` URL/path narrowing type-checks.

### Open

**Generate-time spec-sanity checks (remaining).**

- Accept `2XX` / `1XX`–`5XX` / `default` success status codes in the JSON-media walker, or reject at generate time.
- Cross-check `security` scheme names against `components.securitySchemes`.
- Walk success-response schemas for unsupported composition (`oneOf`/`anyOf`/`allOf`, `additionalProperties`); prerequisite for MCP `outputSchema` emission.
- Reject path params with non-default `style` / `explode: true`.
- Reject `nullable: true` on path params.
- Fail required-but-empty request body at generate time (not silently drop).
- Fail required body whose fields are all filtered by `readOnly`.
- Detect OpenAPI parameter `content:` form and fail with a targeted error.
- Reject or document per-operation `servers:` arrays.
- Fall back to `operation.summary` when `description` is absent.

**MCP schema fidelity.**

- Surface remaining JSON-Schema keywords (`multipleOf`, `exclusiveMinimum`/`exclusiveMaximum`, `uniqueItems`) on body field schemas.
- Decide `nullable: true` policy: keep OAS-3.0 emission + document, or switch to JSON-Schema-2020-12 `type: [..., "null"]`. Same decision governs whether nullable enums re-add `null` to the emitted `enum` list.
- Mirror the `readOnly` filter with a `writeOnly` filter on request-body fields.
- Emit MCP `outputSchema` from the declared 2xx JSON response schema.
- Thread `deprecated: true` into command + param descriptions.
- Runtime integer guard: `S.Number({ jsonType: "integer" })` doesn't reject `1.5` via cmdkit's CLI coercion. Decide: add `validate: Number.isInteger` in `cmdkit-schema`, or document the gap.
- MCP coverage: wire-verbatim ↔ `casing` rewrite roundtrip for non-identifier names (`x-trace-id` → `x_trace_id`); nullable body scalar produces an `inputSchema` accepting `null` directly.

**Request body + media-type.**

- Resolve first-match ambiguity when a spec declares multiple JSON-compatible media types — declarative precedence (`application/json` exact → `+json` → parameterized).
- Tighten `isJsonMediaType` to `startsWith` + `;`/end boundary (currently uses `.includes("application/json")`).
- Document or model the "schema-required field demoted to optional when `requestBody.required !== true`" asymmetry (discriminated `anyOf: all-required-or-none`).
- Query section always emitted even when all values are `undefined` — cosmetic; make consistent with body's omit-when-empty or leave as intentional.

**Consumer-level tests.**

- Spec-declared defaults round-trip: invoke a generated command with no value for a defaulted flag, assert the wire request carries the spec-declared default (mirrors `internal-agent-cli/bin.test.ts` pattern).
- Rewrite `generated-array-cli.test.ts` to run `generate()` + memfs + dynamic import (not hand-built `defineCommand`); add negative case for missing-both-flags preflight.
- `$ref` vs inline snapshot equivalence for `components/parameters`, `components/requestBodies`, `components/responses` (3 narrow positive snapshots).

**Famous fixtures — untrack.**

- Add `packages/cmdkit-openapi/fixtures/famous/` to `.gitignore` (the tree is exploratory-testing output, not source). Run `git rm -r --cached packages/cmdkit-openapi/fixtures/famous/` to drop tracked copies without deleting the working tree. Confirm `npm test --workspace=@poe-code/cmdkit-openapi` still passes without the tracked fixtures.
- Regen `packages/internal-agent-cli/src/generated/agent/whoami.ts` so it carries the `auth: "required"` literal the generator now always emits. Run `npm run generate --workspace=@poe-code/internal-agent-cli` and refresh `openapi.lock` if the SHA moved. (This is a committed consumer fixture, not a famous-spec fixture — stays tracked.)

**Spec-fidelity bugs surfaced by famous-spec smokes.**

- **External `$ref` in operation `parameters` / `requestBody` silently dropped.** `resolveLocalReference` (`generate.ts`) throws `UserError` on any ref not starting with `#/`, but callers for parameter- and body-scoped refs swallow the error path, so DigitalOcean operations whose params are `$ref: "./resources/droplets/parameters.yml#/..."` emit with only transport flags (sampled: `fixtures/famous/digitalocean/generated/droplets/list.ts` has zero spec-declared query params vs. 5 in the spec; `droplets/delete.ts` is missing the required `tag_name` query param and will 400). The current committed DO output under `fixtures/famous/digitalocean/generated/` is the reduced-spec version that demonstrates this regression. Fix: either resolve `$ref` to sibling files during parsing (load + merge, bounded to the spec's directory) or propagate the hard failure to the generator top-level so the op is reported with a targeted `UserError` instead of silently producing a broken command.
- **Required body field demoted to `S.Optional` + runtime guard.** `fixtures/famous/github/generated/actions/add-custom-labels-to-self-hosted-runner-for-org.ts:15` emits `labels: S.Optional(S.Array(...))` with a runtime `UserError` fallback, even though the spec marks `labels` required at the schema level. Root cause is the interaction between the `labelsJson` dual-entry CLI convenience flag and the required-check. Fix: when a body field is `required: true` and there is no sibling `*Json` escape hatch, keep it non-optional; when there is, mark the group required (the preflight already handles "exactly-one") and drop the per-field runtime guard.

**Spec-fidelity test gap.**

- Body-field `format: date-time` preservation is only covered inside array items (`generate.test.ts`), not as a top-level scalar body field. Add a single positive snapshot to pin that `format: "date-time"` survives on a scalar body field (`body: { scheduled_at: { type: "string", format: "date-time" } }`).

**Code-quality nits (bundle into next edit on listed files; no dedicated rounds).**

- **Dead / unreachable code to delete:** `?? "repeat"` in `createArrayParam`; `?? []` in `createIndexFile` noun-map lookup; `expectQueryArraySerialization` defensive throw (tighten caller types or upgrade to `UserError`); `block.nullParamName!` bang (narrow on `!== undefined`); defensive `Array.isArray(value) ? [...value] : value` spread in `runtime.ts`; `stripLeadingGenericVerb` dead `while` loop (collapse to `return words.slice(1)`); vestigial `.split("/").map(...)` in `deriveNounFromPath`; duplicate `toMatchObject` assertion in `define-client.test.ts` nesting test; `stripNullable` sets `nullable: undefined` instead of deleting the key.
- **Proxy-only helpers (inline or give real intent):** `toCliFlag` (pure proxy to `toKebabCase` — or add leading-digit guard / reserved-flag collision); `supportsNullHelper`; `renderOmitWhenUndefinedExpression`; `stripNullable` single-caller helper.
- **Ternary / if-chain → lookup tables (declarative style):** `getFieldSchemaKind` ternary → `{ array, object }` lookup + scalar default; `normalizeEnumValues` schema-type ladder → extend `SCHEMA_TYPE_TO_KIND` with `matches(value)` predicate; `resolveQueryArraySerialization` + `renderQueryArrayValueExpression` → single `QUERY_ARRAY_SERIALIZATION` table keyed by `(style, explode)`; `bin/generate.ts` `assignOptionValue` if-chain + repeated `--X <val>` / `--X=val` flag parsing → `Record<FlagName, ...>` + single loop.
- **Silent fall-through → explicit throw:** `FIELD_ASSEMBLERS.query.object` mirrors `body.object`'s explicit throw naming `query` + the operationId.
- **Single-purpose escape hatches (watch or inline):** `paramsSchemaOptions` one-field bag; `METHODS_WITHOUT_REQUEST_BODY = new Set(["get"])` (collapse to `method === "get"` or declarative when a second method joins); `renderSchemaCall(builder, ...args)` variadic (swap to `args: Array<string | undefined>` when a third shape lands); `BODY_FIELD_DISPATCH` keyed by `schema.type` once composition / top-level non-object work lands.
- **Naming + error consistency:** use `GeneratedRequestLocation` alias across sibling declarations; pick one spelling for `"unsupported requestBody on GET"` vs `"unsupported request body field"`.
- **Verbatim-name follow-ups:** bundle `{ raw, helper, access }` names through `createBodyField` / `createArrayParam`; extend collision registry to cover synthesized `*Null` / `*Json` helpers vs declared params; memoize `renderParamAccess(paramName)` in `createGeneratedParameter` (helper now lives only in `interpreter.ts`).
- **`cmdkit` + `cmdkit-schema` dedup:** export `SchemaScope` from `cmdkit-schema` (remove redeclaration in `cmdkit/schema-scope.ts`); extract `assertObjectParamsSchema(node, surface)` to replace the duplicate `Bug: command ... must define an object params schema` throw in `mcp.ts` + `sdk.ts` (or leave); add one-line comment on the hardcoded `["mcp", "sdk"] as const` in `generate.ts` explaining why CLI is intentionally omitted; collapse `mcp.ts` multi-line JSDoc on `RunMCPOptions.tools` / `casing` to single line per CLAUDE.md.

**Docs / plan-wording reconcile.**

- Tighten task 727(a) wording: MCP `inputSchema` keys are normalized per `casing`; wire keys stay verbatim.
- Update Testing-section naming bullets so missing/empty `tags` reads "falls back to first static non-`api`/non-version path segment; throws only when no fallback available."
- Testing literal-coverage: boolean body `--no-official` `toContain`, DELETE-with-body `confirm: true` re-assert.

**Wire-level fidelity (low-priority).**

- Query-array `form` + `explode: false` and `pipeDelimited` arrays are percent-encoded by `URLSearchParams.append` (`,` → `%2C`, `|` → `%7C`). Most servers tolerate; fix only when a strict receiver trips. Build the query string manually for those two shapes when it happens.

### Out of scope (standing)

Pagination, retries, OAuth / device-code, API-key-in-header / HTTP-basic / non-bearer schemes, file uploads, streaming / SSE, multi-host auth, non-`application/json` content types, overriding / patching generated commands, response headers, OpenAPI 3.1 `encoding:`. Consumers needing non-bearer auth wire a handwritten `AuthProvider`.
