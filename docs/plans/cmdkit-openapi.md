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
  round: 73
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
- [x] Plain-TS param-shape detour (rounds 11–16) was reverted — cmdkit-schema (`S.Object(...)`) is the canonical params format for both generated and handwritten commands (see Design constraints).
- [x] `http.ts` test cleanup (round 16, code-quality inspector): `packages/cmdkit-openapi/src/http.test.ts:172-183` and `:185-196` are duplicate "invalid path template" tests — same call, one asserts `instanceof UserError`, the other asserts the message. Merge into a single test asserting both.
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
- [x] Plan Target-UX examples (§1/§2/§3/§5) are stale post-task-697(d) from round 31 spec-fidelity inspector (plan-doc fix, non-blocking): synced the Target UX examples to the post-task-697(d) naming contract — path params now stay `botHandle`, CLI examples use `--bot-handle`, and MCP `inputSchema` `properties` / `required` arrays use `botHandle` consistently across the affected examples.
- [x] Cmdkit MCP surface changelog / docs notes from round 31 code-quality inspector (non-blocking, fold into next README edit): task 710 changed two public-ish shapes on `packages/cmdkit` — (a) MCP tool names are now snake_case + `__`-joined, and the `casing` option on `RunMCPOptions` no longer influences tool naming (only parameter-key casing); tightened the `RunMCPOptions.casing` docstring / type comment to reflect that; (b) the allowlist key format changed from `.`-join to `__`-join, so any external `tools: ["group.child"]` consumer silently matches nothing after this change. No known external consumers, but the `packages/cmdkit` README now documents the `__`-joined allowlist format and tool-name behavior for the next ship.
- [x] `defineClient` merge-then-reclone invariant from round 33 code-quality + testing inspectors (non-blocking, folded into the next edit on this file): took option (a). `mergeChildren` now carries an inline comment explaining that the trailing `cloneNode` pass re-snapshots groups after `mergeInto` mutates `existing.children`, because `defineGroup` captures an immutable child snapshot at construction time. `define-client.test.ts` now nests a client whose `bots` group is merged from generated + handwritten commands and asserts the wrapped group still exposes both `list` and `view`, so deleting the re-clone regresses behavior visibly.
- [x] `generate()` declarative-drift regressions from round 34 code-quality inspector: (a) `confirm: entry.method === "delete"` replaced — `METHOD_DEFAULTS` in `naming.ts` now carries per-method `confirm` alongside verbs, and the generator spreads `methodDefaults?.confirm` at the declaration site so adding a future confirm-requiring method is a one-line table entry. (b) `UserError` import is tracked via an explicit `requiresUserError` flag on `CollectedCommandParams` threaded into `createCommandFile` — no more `line.includes("UserError")` string-sniffing.
- [x] `generate()` spec-fidelity asymmetries from round 34 spec-fidelity inspector: nullable array body fields now emit the CLI `--<name>-null` helper; path params with `required !== true` fail at generate time with a clear `UserError`; query-array params now mirror array-body CLI UX with repeatable + `-json` shims while keeping MCP/SDK fidelity. Coverage lives in `packages/cmdkit-openapi/src/generate.test.ts`.
- [x] `generate()` round-35 code-quality follow-ups (builder round 52): (a) `preflightLines: string[]` + parallel `requiresUserError: boolean` replaced with `preflightBlocks: GeneratedPreflightBlock[]` where each block self-declares `imports`; `createCommandFile` aggregates `GeneratedCommandImport` set-membership once and drops the `.length > 0` / hardcoded-`true` drift. (b) `confirm` collapsed to `confirm: methodDefaults?.confirm === true` with `confirm: boolean` — the conditional spread + `confirm?: true` literal is gone. (c) Non-DELETE confirmability test removed; positive DELETE test remains and all other non-DELETE tests exercise the `false` path. Bundled cleanups: `expectParameter` returns a bare cast (task 733), `renderRequiredParamSchema` proxy inlined into `renderParamSchema` (task 741a), `bodyOptional` reused for `optionalSections` in `collectRequestBodyParams` (task 754b), and `emitsNullHelper` hoisted once in `createArrayParam` (task 750a). Also added a negative test proving `UserError` is **not** imported when no preflight guards are emitted. 48 generator tests green.
- [x] `generate()` round-35 spec-fidelity follow-ups (builder round 55): (a) OpenAPI parameter names now pass through verbatim to MCP/SDK/CLI surfaces — `bot_handle` / `x-trace-id` stay as-is in `params`, quoted `inputSchema` keys, and wire `pathParams`. `renderObjectKey` / `renderParamAccess` / `isIdentifierName` added to quote-and-bracket non-identifier names safely. (b) Integer validation threaded through `number-schema.ts` (`isValidNumberSchemaValue` + `getExpectedNumberDescription`) and applied uniformly in `cli.ts:380`, `mcp.ts:363`, `sdk.ts:277` so `jsonType: "integer"` rejects fractions across CLI/MCP/SDK. (c) `deriveArrayCliParamName` deleted; generated CLI now uses the plural flag verbatim (`--tags`, `--starters`) plus the `--*-json` escape hatch. 238 tests green.
- [x] `generate()` + `cmdkit-schema` hygiene nits from round 34 code-quality inspector (builder round 62): (a) `TRANSPORT_PARAMS` hoisted to module-level `const ... as const satisfies ReadonlyArray<GeneratedParam>` at `generate.ts:39`; (b) the `as GeneratedRequestField[]` cast is gone — the map infers the shape directly; (c) `collectOptionalRequestSections` is gone — `collectRequestBodyParams` now returns `optionalSections` inline using the existing `bodyOptional` local (`generate.ts:490`), so the requestBody is walked once; (d) `renderSchemaOptions` now takes a narrow `RenderSchemaOptionsInput` (`generate.ts:215-220`) instead of a fake `GeneratedParam` cast; (e) `renderSchemaOptions` now returns `string | undefined` (options body only) and `renderDefinition` composes the argument list structurally — the `options.slice(2)` hack at the former `generate.ts:1065` is gone; (f) redundant `nullable?: boolean` on `EnumSchema` and the `S.Enum` options intersection removed in `cmdkit-schema/src/index.ts`, relying on `SchemaOptions` / `SchemaBase`. (g) file-split intentionally deferred as non-blocking. Suite: `@poe-code/cmdkit-openapi` 144/144, `@poe-code/cmdkit-schema` + `@poe-code/cmdkit` green.
- [x] Round-62 code-quality nits (builder round 62): `renderDefinition` now routes enum / array / scalar builder calls through a tiny `renderSchemaCall()` helper that filters out an absent options object, collapsing the repeated `options === undefined ? ... : ...` ternaries to one-line calls. The enum arm binds `enumValues` once, removing the duplicate `definition.enumValues ?? []` lookup, and the scalar builder-name capitalization stays inline as allowed. Coverage: `packages/cmdkit-openapi/src/generate.test.ts` now pins option-less scalar / enum / array output; full `@poe-code/cmdkit-openapi` suite green (145/145).
- [x] `loadOptions` signature-split verification from round 62 code-quality inspector (builder round 63): verified the only production call sites (`packages/github-workflows/src/commands.ts:213, 275`) both pass `async () => …`, so the split `(() => A) | (() => Promise<A>)` signature is sound for current usage. `packages/cmdkit/src/cli.test.ts` still covers both sync + async `loadOptions`, and root `npm run lint:types` stays green. No follow-up needed unless a future caller wants one function that conditionally returns sync vs async.
- [x] Plan-wording reconciliation from round 62 testing inspector (builder round 66): updated plan §280-286 + §508 to reflect that raw JSON output now comes from cmdkit's global `--json` flag rather than a generated per-command `json` param, and added a forwarding note above the "Argv parsing (generated CLI commands)" section clarifying that parsing/coercion coverage lives in `@poe-code/cmdkit`, `@poe-code/cmdkit-schema`, and consumer smoke tests while `cmdkit-openapi` snapshots generated declarations.
- [x] `generate()` spec-fidelity gaps from round 36 spec-fidelity inspector (generate-time sanity checks; decide scope alongside tasks 709/711 — none block milestones 5–6): (a) **Nullable enum drops `null` from the advertised enum list** — nullable enums now advertise `null` in JSON Schema output so MCP sees the accepted value explicitly. (b) **Enum values not cross-checked against `schema.type`** — `normalizeEnumValues` now rejects enums whose values disagree with the declared scalar type (including non-integer values for `type: "integer"`). (c) **No circular `$ref` detection** — ref resolution now threads a visited chain and throws a `UserError` naming the circular `$ref` path instead of overflowing the stack.
- [x] `--json` CLI flag missing on generated commands from round 37 testing inspector (shipped-code gap, not a test gap — plan §280-286 + §508 require it): generated commands with a non-empty success response schema now emit `json: S.Optional(S.Boolean({ scope: ["cli", "sdk"] }))`, snapshots pin the flag, the real `internal-agent-cli` generated output was regenerated, and `packages/cmdkit/src/cli.test.ts` now verifies a command-scoped `--json` flag forces JSON output over any rich renderer path.
- [x] `cli.ts` output-mode resolution split from round 39 code-quality inspector (declarativeness regression introduced by task 730; non-blocking but pick up before any further raw-output flag lands): promoted `json` into `GlobalFlags` so `resolveOutput()` is authoritative again, and strengthened `packages/cmdkit/src/cli.test.ts` to pin `--json` over an explicit `--output md` override. This removes the `executeCommand` sidecar branch and keeps future raw-output flags table-driven.
- [x] `generate()` spec-fidelity gaps from round 37 spec-fidelity inspector (builder round 63): (a) query-array params now stay array-shaped through the generated request object, with focused coverage pinning repeat/comma/pipe serialization in `generate.test.ts`; (b) GET operations now fail fast with `UserError` when they declare a `requestBody` (DELETE bodies remain supported — the existing delete-body generation test still passes, matching the broader plan/testing contract); (c) nested object request-body fields now throw an explicit unsupported-in-v1 `UserError`, and focused generator tests pin the behavior. Suite: `@poe-code/cmdkit-openapi` 147/147, root `npm run lint:types` green.
- [x] `generate()` code-quality nit from round 37 inspector (builder round 52, bundled with task 726): `expectParameter` now returns `parameter as SupportedOpenApiParameterObject` — the `...parameter, in: parameter.in` spread is gone. The negative `UserError`-import test was added alongside task 726(a)'s declarative preflight refactor, closing the positive-only coverage gap.
- [x] `generate()` spec-fidelity gaps from round 38 spec-fidelity inspector: (a) top-level scalar + array JSON request bodies now generate a single top-level `body` request payload instead of forcing object-shaped bodies, reusing the existing scalar/array CLI helpers (`--body`, `--body-json`, `--body-null`) where applicable; (b) `expectSchema` now rejects `oneOf` / `anyOf` / `allOf` with composition-aware `UserError`s that name the unsupported keyword; ~~(c) media-type lookup inconsistency~~ **done in builder round 64** — request-body media selection now uses `isJsonMediaType`; (d) path params with array/object schemas now fail fast with a scalar-only error; (e) header/cookie params still reject in v1, but the error now explains that only path/query params are supported and headers/cookies belong in auth or handwritten commands; (f) required query arrays still do **not** auto-invent `minItems: 1` — intentional per the “don’t invent constraints” policy. Coverage added in `generate.test.ts` for top-level scalar bodies, top-level array bodies, keyword-specific composition errors, and clarified header/cookie errors.
- [x] `generate()` spec-fidelity gaps from round 40 spec-fidelity inspector (builder round 72): public operations that declare `security: []` now emit `auth: "none"` and skip bearer-token resolution/header injection at runtime, object request bodies that rely on `additionalProperties` now fail fast with a `UserError` instead of generating a no-op body surface, the optional-body/required-child asymmetry remains an explicit documented v1 limitation and stays tracked under task 779(a), and scalar query `null` continues to map to the existing empty-string wire encoding until a real consumer needs a different convention. Coverage: new generator assertions for `security: []` and `additionalProperties`, plus an `http.ts` runtime test proving `auth: "none"` omits `Authorization`.
- [x] Runtime argv coverage gap from round 40 testing inspector (documentation note; non-blocking): added consumer-level invocation coverage in `packages/internal-agent-cli/src/bin.test.ts` so a real generated command is exercised at runtime through the actual CLI entrypoint. The new tests pin JSON output, `--dry-run` passthrough, and `-v` request logging; broader enum/number/DELETE-confirm semantics remain owned by `@poe-code/cmdkit` and stay covered in that package's test suite.
- [x] `generate()` — array-param assembly duplication from round 41 code-quality inspector: `createArrayQueryParameter` and `createArrayBodyField` are now a single `createArrayParam({ location, supportsNullFlag, … })` dispatched through from both `createGeneratedParameter` (query) and `createBodyField` (body); the four-field return shape is captured once as `GeneratedParameterAssembly`. Collision bookkeeping on `GeneratedParam` moved from the misleading `originalName: <derivedCliName>` to `sourceName: <openApiName>`, so `Operation "listBots" maps both "tags" and "tag" to flag "tag"` now names the real OpenAPI source rather than the CLI alias (regression test at `generate.test.ts:1505` pins it). `requiresUserError` is now derived from the assembly return rather than a `preflightLines.length > 0` sniff on the body path.
- [x] `generate()` — query-array nullable asymmetry from round 41 code-quality + spec-fidelity inspectors: resolved as intentional omission (option b). Query `null` already serializes to an empty string on the wire (see 735(d)) so a CLI-only `--<name>-null` helper would add no signal. `createArrayParam` now takes a `supportsNullFlag` option (`query → false`, `body → true`); the rationale lives in an inline comment at the query dispatch site (`generate.ts:562-564`) and a focused regression test at `generate.test.ts:531` asserts that nullable query arrays emit no `<name>Null` flag.
- [x] `generate()` naming asymmetry from round 42 code-quality inspector (builder round 60): renamed `GeneratedRequestField.originalName → wireName` at `generate.ts:175` + 4 call sites (construction in `createGeneratedParameter` / `createBodyField` / `createArrayParam` and the two `renderRequestShape` read sites). Readability-only rename — no behavior change, no snapshot churn. Full `@poe-code/cmdkit-openapi` suite 144/144 green.
- [ ] `generate()` nullable-helper distribution from round 42 code-quality inspector (non-blocking; revisit if/when a query-side null gap surfaces): scalar nullable *body* fields synthesize a `--<name>-null` helper at `createBodyField` (`generate.ts:637-653`); scalar nullable *query* params do not. Same wire-protocol asymmetry as the array case just resolved in 738, but the decision logic is now spread across `createGeneratedParameter` / `createBodyField` / `createArrayParam`. Centralize the "does this location/shape support a null helper?" rule in one place so the answer is declarative across scalar+array × path/query/body. Bundle with task 735(d) if a query-null semantic ever shows up.
- [ ] `generate()` round-43 code-quality nits (non-blocking; fold into the next edit on this file — do not spin dedicated rounds): ~~(a) `renderRequiredParamSchema` proxy inlined~~ **done in builder round 52 alongside task 726** — inlined directly into `renderParamSchema`. (b) `createIndexFile` at `generate.ts:1365-1368` and `:1382-1385` sorts each noun's commands twice (once per render loop); compute the sorted commands once into a `Map<noun, sortedCommands[]>` before the import/export loops; (c) `hasJsonSuccessResponseSchema` at `generate.ts:361-385` and `assertSupportedSuccessResponses` at `:501-532` walk the same `operation.responses` shape with the same success-status/json-media predicates. Extract one walker that yields the success-response entries; let both consumers iterate it. Mirrors the DRY work already done on `REQUEST_PARAM_SECTIONS` / `SCHEMA_TYPE_TO_KIND` / `METHOD_DEFAULTS`.
- [ ] `generate()` spec-fidelity gaps from round 43 spec-fidelity inspector (generate-time / fidelity improvements; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Stripe + DigitalOcean emit zero commands** — strict `tags[0]`-required noun derivation (`deriveNoun` at `naming.ts`) skips 587/587 (Stripe) and 599/599 (DigitalOcean) operations on tag absence alone per `fixtures/famous/{stripe,digitalocean}/NOTES.md`. Either derive a fallback noun (e.g. first path segment after `/v1/`) or document the tag-required policy as a hard constraint. (b) **Command `description` drops spec `description`, uses only `summary`** — GitHub `activity/list-public-events` loses the 30s-6h latency caveat; `billing/get-budget-org` loses the "must be org admin/billing manager" note. Prefer `description` over `summary` (or concat both) so MCP/CLI help stays faithful to the spec's authoritative operation prose. (c) **`additionalProperties: false` silently dropped** on emitted MCP body schemas (e.g. `campaigns/update-campaign`) — not a wire issue but an MCP fidelity loss; thread through to cmdkit-schema's object-schema options.
- [ ] `generate.test.ts` snapshot-rule drift from round 43 testing inspector (documentation reconciliation, non-blocking): plan §463-465 states "Every generator test is a snapshot," but ~16 tests in `generate.test.ts` now use targeted `.toContain()` / `.not.toContain()` assertions (null-helper flags, confirm flag, transport params, PUT/PATCH body serialization, query-array CLI shim, ref resolution constraints). These are intentional single-line "rule" assertions, not snapshots. Either soften the plan wording (e.g. "snapshot by default; rule-level assertions where a single emitted line is the invariant under test") or convert the 16 tests to snapshot comparisons. Decide alongside task 736.
- [x] `generate()` GET verb collapses operation intent from round 44 spec-fidelity inspector (builder round 45): GETs on singleton or qualified paths now derive their verb from `operationId` intent. `deriveVerb` in `naming.ts` passes the noun to `deriveVerbFromOperationId`, which strips the tag prefix, trailing method/noun, and version tokens, then falls through to `METHOD_DEFAULTS.get.collection` only when the path tail is a plain collection noun. `internal-agent-cli`'s `GET /v1/whoami` now surfaces as `agent whoami` / MCP `internal_agent__agent__whoami` (regen committed: `packages/internal-agent-cli/src/generated/agent/whoami.ts`, `internal-agent-cli` index + `client.test.ts` updated). Naming+generate tests pin GET singleton / qualified / plain-collection paths.
- [x] `generate()` slash-in-operationId emits invalid TypeScript from round 44 spec-fidelity inspector (builder round 45): `splitWords` at `naming.ts:102-113` now normalizes `/` alongside `-`/`_`/`.`, and `deriveVerbFromOperationId` strips duplicate tag prefixes so slashy `operationId`s like GitHub's `actions/create-environment-variable` tokenize + dedupe correctly. Famous-spec fixture regen (follow-up task 749) is needed before the GitHub/Petstore counts in `fixtures/famous/*/NOTES.md` reflect the new surface.
- [x] `deriveVerb` declarative drift from round 45 code-quality inspector (builder round 52): `METHOD_DEFAULTS.get` now carries `genericVerbs` + `preferOperationIdWhenPathTailIsGeneric`, and `deriveVerb` keys off that table data instead of hard-branching on `method === "get"`. GET naming behavior is unchanged, but future method-specific intent rules are now a table edit instead of another branch.
- [x] `deriveVerbFromOperationId` pipeline-state leak + KISS nits from round 45 code-quality inspector (builder round 52): `deriveVerbFromOperationId` now returns just the derived verb, `deriveVerb` asks a dedicated `operationIdStartsWithCollectionVerb()` predicate when it needs the fallback decision, and the word-normalization path is split into named helpers (`normalizeOperationIdWords`, `stripLeadingGenericVerb`, `trimTrailingNounUnlessItConsumesAll`) with a single final `dedupeAdjacentWords()` pass. Left the `isVersionWord` scope unchanged for now — still good enough for current fixtures, exactly as the inspector allowed.
- [x] GET-collision test coverage regression from round 45 code-quality inspector (builder round 46): re-added GET collision coverage alongside the POST slashy-operationId collision test. `generate.test.ts` now pins the round-45 risk shape directly: two GET operations with the same noun + path tail (`/bots/search` and `/bots/{botHandle}/search`) but different operationIds (`getSearch` / `viewSearch`) both collide on `bots search`. This keeps GET-specific naming regressions covered after task 744 changed GET verb derivation.
- [ ] Famous-spec fixture regen + NOTES update from round 45 (non-blocking, behind tasks 744/745): `fixtures/famous/petstore/NOTES.md` flagged the `user logout → user list` / `store inventory → store list` collapses and `fixtures/famous/github/NOTES.md` attributed 676 command-path collisions + the invalid-TS `actions/` identifier to the GET-intent + slash-tokenization gaps. Both classes of fix are now in `naming.ts`, but the committed fixture output under `packages/cmdkit-openapi/fixtures/famous/{petstore,github}/generated/` has not been regenerated, so the fixture files still reflect the pre-round-45 surface. Rerun the famous-spec smoke (`packages/cmdkit-openapi` has the rig from task 719), commit the regenerated output, and update the NOTES counts so the task 744/745 claims match what is on disk. **Additional drift evidence from round 59 spec-fidelity inspector:** (i) `fixtures/famous/petstore/generated/store/{place-order,list}.ts` still carry the per-command `json: S.Optional(S.Boolean(...))` flag removed by task 759(c); (ii) `fixtures/famous/github/generated/actions/artifacts.ts` exposes `perPage` camelCased while the wire key is `"per_page"`, reflecting the pre-task-727(b) normalization. Regen closes both alongside the round-45 collapses. **Additional drift evidence from round 72 spec-fidelity inspector:** (iii) every `fixtures/famous/*/generated/**/*.ts` file lacks the new `auth: "required"` / `auth: "none"` line that `createGeneratedCommand` now always emits post-task-646 (builder round 73), so fixtures also pre-date the explicit-auth contract — regen picks this up in the same pass.
- [ ] `generate()` round-44 code-quality nits from code-quality inspector (non-blocking, fold into next edit on `generate.ts` / `naming.ts` — do not spin dedicated rounds): ~~(a) **Duplicated nullability guard in `createArrayParam`**~~ **done in builder round 52 alongside task 726** — `emitsNullHelper` now hoisted once at the top of `createArrayParam`. (b) **`renderDefinition` if/else on `kind`** at `generate.ts:1227-1236` — replace with a `Record<ParamKind, Renderer>` table to match the rest of the file's table-driven style (`SCHEMA_TYPE_TO_KIND`, `REQUEST_PARAM_SECTIONS`, `METHOD_DEFAULTS`). (c) **`toCliFlag` (generate.ts:896) vs `toKebabCase` (naming.ts:75)** — two different kebab-ish converters in two files, easy to drift; consolidate on one exported helper in `naming.ts`. (d) **Two `schema.type === "array"` dispatch sites** at `generate.ts:552` (`createGeneratedParameter`) and `:603` (`createBodyField`) — works today, but the "is this an array?" decision lives in two places; a single `createField` router keyed on schema kind would stay declarative. Bundle (d) with (b) when the renderer table lands. (e) **`supportsNullFlag` / `hasJsonSuccessResponseSchema` as location-cap tables** — flag-threading on `createArrayParam` (query: false / body: true) and the inline ternary gating `--json` injection at `generate.ts:321-334,361-385` are both "capability → flag" decisions that read cleaner as `LOCATION_CAPS[location].nullHelper` and `{predicate, param}` table entries. Overlaps with task 740 — keep the resolution unified when that work lands.
- [ ] `generate-cli` spec-fetch failure-mode coverage from round 46 testing inspector (non-blocking, small gap): `bin/generate.ts` reads the OpenAPI spec (path or URL), but `generate-cli.test.ts` only exercises lock create/idempotent/regen/`--check`/malformed cases. Add tests that exercise the fetch layer's error surface — network error (fetch rejects), non-2xx response, invalid JSON body, request timeout — so the CLI's failure taxonomy is pinned. Leaves the happy path alone; mirrors the generate-time-sanity-check class (tasks 703 / 712 / 732) but on the fetch side.
- [ ] `cli.ts` round-47 code-quality nits from code-quality + spec-fidelity inspectors (non-blocking, fold into the next edit on this file — do not spin dedicated rounds): (a) `toDesignSystemOutput` at `cli.ts:1031-1041` is a 3-way `OutputMode → designSystem` if-chain; a `Record<OutputMode, ...>` lookup is one line and strictly typed — mirrors the table-driven style already used in `generate.ts` (`SCHEMA_TYPE_TO_KIND`, `REQUEST_PARAM_SECTIONS`, `METHOD_DEFAULTS`). (b) `GlobalFlags` at `cli.ts:43` is now a misnomer — task 731 added `json?: boolean` which is command-scoped (merged in via `optsWithGlobals()`), not a program-wide option; spec-fidelity inspector flagged the same. Rename to `ResolvedFlags`, or split into `GlobalFlags & CommandFlags`, so the type name reflects the shape Commander actually hands back. (c) Hold (a) from the raw cli.ts concerns (precedence list for `resolveOutput`) until a second raw-output flag (e.g. `--yaml`) actually lands — inspector explicitly said "two branches is fine" today.
- [ ] Round-47 testing inspector gaps — plan-wording staleness and literal-coverage edges (non-blocking, decide scope alongside tasks 713 / 736 / 743): (a) **MCP round-trip coverage** — `define-client.test.ts:109` asserts only the tool name (`internal_agent__bots__list`); no test drives a `callTool` through the MCP client pair end-to-end to verify schema/response handling for a generated command. `client.test.ts` (round 38, task 717) already round-trips one tool; consider whether a `cmdkit-openapi`-level MCP round-trip test belongs here or stays in the consumer package. (b) **4xx + non-JSON text body** — `http.test.ts` covers 4xx+JSON (`:298`) and 5xx+text (`:313`) but not 4xx+text directly; same code path as 5xx, low risk, literal gap vs. the "4xx → … raw string otherwise" plan bullet. (c) **Plan wording stale for DELETE `--yes` and body `format: date-time` ISO-8601 comment** — generator emits `confirm: true` (cmdkit's confirm mechanism replaces a literal `--yes` flag in the generator's concern) and preserves `format: "date-time"` on the schema rather than emitting an ISO-8601 comment (schema-based fidelity supersedes comment-based). Reconcile Testing-section wording (plan §589-605) instead of chasing the literal coverage — same class of plan-wording drift as task 743.
- [ ] `generate()` round-49 code-quality follow-ups (non-blocking, fold into the next edit on this file — do not spin a dedicated round): (a) **`location === "query"` branch inside `createArrayParam`** at `generate.ts:803-806` — `createArrayParam` was location-agnostic before task 709; the new inline ternary (`location === "query" ? renderQueryArrayValueExpression(...) : resolvedName`) reintroduces the per-location shape branching that rounds 24 (`REQUEST_PARAM_SECTIONS.omittable`), 27 (`jsonType` spread), 29 (`transport` scope), and 34 (`delete` confirm) each killed. Resolve the serialization at the caller (query dispatch site in `createGeneratedParameter`) and have every `GeneratedRequestField` carry its own already-resolved `valueExpression`; then `querySerialization?:` on `CreateArrayParamOptions` — currently an asymmetric option only one caller uses — also goes away and `createArrayParam` stays uniform. Overlaps with task 750(e) (`LOCATION_CAPS` table); bundle if both land at once. ~~(b) `bodyOptional` invariant duplicated~~ **done in builder round 52 alongside task 726** — `collectRequestBodyParams` now builds `optionalSections` from the existing `bodyOptional` local. (c) **`mergeCommandDescriptions` dedupe branch** — the `operationDescription === requestBodyDescription` guard defends against a malformed spec; not harmful, but the four branches for two optional strings collapse to two guards. YAGNI/KISS, non-blocking.
- [ ] `generate()` round-49 spec-fidelity test-coverage gap (non-blocking, fold into next test edit on this file): spec-fidelity inspector flagged that `$ref` resolution into `components/parameters`, `components/requestBodies`, and `components/responses` is implemented and exercised by existing tests but no snapshot asserts that the emitted output for a `$ref`'d parameter/requestBody/response is byte-identical to the inline form. The comma/pipe serialization and nullable-enum `null`-in-enum cases flagged in the same report already have coverage in `generate.test.ts` (added in builder round 49). Adding three positive snapshot equivalences (inline vs `$ref`) would close the last piece — keep narrow.
- [ ] `defineClient` test YAGNI nit from round 50 code-quality inspector (non-blocking, one-line cleanup — fold into the next edit on `define-client.test.ts`): the nesting test at `define-client.test.ts:193-233` now makes two equivalent assertions — the `toMatchObject` at `:207-217` already recurses `wrapper.children[0] → bots → [{name:"list"}, {name:"view"}]`, so dropping the `mergeChildren` re-clone (the invariant round 50 pinned) fails that assertion. Lines `:219-232` re-extract `wrapper.children[0]`, narrow to `kind === "group"`, find the `bots` child, and re-assert the same `{kind, name, children:[list, view]}` shape — a duplicate through the same path with the same expectations. CLAUDE.md bans tests that add code complexity without added coverage. Drop `:219-232` and keep the single `toMatchObject` (or swap to the narrowed-extraction form if the typed path is preferred — but only one of the two). Verified: the first assertion is sufficient to regress if the re-clone is removed.
- [ ] `stripLeadingGenericVerb` dead loop from round 52 code-quality inspector (YAGNI cleanup, non-blocking — fold into the next edit on `naming.ts`): the `while (start < words.length - 1 && words[start] === words[0])` loop at `naming.ts:191-194` is unreachable. `normalizeOperationIdWords` terminates with `dedupeAdjacentWords`, so by the time the loop runs, `words[0] !== words[1]` is guaranteed and the loop body never executes. Collapse the body to `return words.slice(1)`. No behavior change expected; tests stay green. (Inspector also flagged two nits marked as no-action: `genericVerbs` + `preferOperationIdWhenPathTailIsGeneric` travel together but are defensibly kept separate per the explicit-over-implicit rule; `normalizeOperationIdWords` called twice in the GET path is a minor repeated-work nit, refactor only if it becomes hot.)
- [ ] `generate()` spec-fidelity gaps flagged by round 53 spec-fidelity inspector (generate-time sanity + fidelity fixes; bundle under task 711 when constraint work lands — none block milestone 7): (a) **OPTIONS / HEAD / TRACE silently dropped.** `HTTP_METHOD_ORDER` at `generate.ts:12` covers only GET/POST/PUT/PATCH/DELETE; a path item declaring `head` / `options` / `trace` yields zero commands and zero warnings. Either emit a clear generate-time `UserError` naming the operationId + method, or explicitly document the v1 subset so spec authors don't silently lose operations. Same class of sanity check as task 703 / 712 / 732 / 734a. (b) **Required + nullable scalar body field unreachable from CLI.** `createBodyField` (`generate.ts:658-677`) marks the primary `paramName` with no `scope` restriction; when that field is required (body required + listed in `schema.required`) and `nullable: true`, cmdkit's required-validation forces `--<name>` and the preflight marks `--<name>` + `--<name>-null` mutually exclusive, so no CLI invocation can send `null`. Either gate the primary to `scope: ["mcp","sdk"]` when a null helper exists, or relax the preflight so `--<name>-null` satisfies required. Not covered by existing tests (the scalar-nullable snapshot uses `requestBody.required: false`, which forces the field optional). Adjacent to tasks 725 / 740 but a different concrete bug. (c) **Nullable query array advertises `null` to MCP/SDK but wire sends empty string.** `createArrayParam` (`generate.ts:713-723`) still copies `nullable: true` into the MCP/SDK schema for query arrays even though `supportsNullFlag: false` and `http.ts:139` coerces `null` → `""` (see task 738 + task 735d). Either strip `nullable: true` from the query-array definition (symmetry with the decision not to emit `--<name>-null` CLI-side) or document the wire mapping explicitly. (d) **`mergeCommandDescriptions` concat is an invention.** Already tracked as task 754(c) follow-up — the `operationDescription + "\n\nRequest body: …"` format at `generate.ts:1266-1283` is not an OpenAPI concept; MCP descriptions drift from spec-verbatim. Fold into 754(c) when that lands.
- [x] `generate()` spec-fidelity bugs flagged by round 52 spec-fidelity inspector (builder round 58): ~~(a) **Array path params silently accepted, runtime-incorrect.**~~ **done in builder round 54** — `createGeneratedParameter` now throws a `UserError` when a path param schema is `array` or `object`, listing the scalar types allowed. Coverage stays pinned by focused generator tests. (b) **`readOnly` / `writeOnly` ignored on body fields.** `collectRequestBodyParams` now skips `readOnly: true` request-body properties, so generated CLI/MCP params only include writable request fields; snapshot coverage pins the emitted command shape. (c) **Per-command `json` param is dead after task 731.** The generator no longer injects a per-command `json` transport param, removed the now-dead `hasJsonSuccessResponseSchema` gate, and regenerated committed output (`internal-agent-cli`'s `whoami` command) so CLI help only shows the real command-local flags while cmdkit's global `--json` remains authoritative.
- [ ] `generate()` enum schema-type validation declarative-drift from round 55 code-quality inspector (non-blocking table extraction; fold into the next edit on `generate.ts`): `normalizeEnumValues` at `generate.ts:993-1007` validates enum values against `schema.type` with a string-branched ladder (`if (schemaType === "integer") … if (schemaType === "number") … if (schemaType === "string" || schemaType === "boolean")`), duplicating knowledge that already lives in `SCHEMA_TYPE_TO_KIND` at `generate.ts:17-25`. Same class of rule-duplication killed in rounds 24–27. Fix: extend each `SCHEMA_TYPE_TO_KIND` entry with a `matches(value: unknown): boolean` predicate and replace the if-chain with `SCHEMA_TYPE_TO_KIND[schemaType]?.matches(value) ?? true`. One source of truth; adding a future `format: "float"` marker becomes a table entry, not a second `if`.
- [ ] `generate()` query-array serialization duplicated branching from round 55 code-quality inspector (non-blocking table extraction; fold into the next edit on `generate.ts`): `resolveQueryArraySerialization` at `generate.ts:1392-1410` and `renderQueryArrayValueExpression` at `generate.ts:1412-1422` both branch on the `(style, explode)` tuple in two mirrored places — the first maps the tuple to a mode, the second maps the mode to a render strategy. Extract a single `QUERY_ARRAY_SERIALIZATION` table keyed by `(style, explode)` carrying both the mode label and the render strategy (`renderValueExpression(resolvedName)`); lookup replaces both functions. Same declarative style as `METHOD_DEFAULTS` / `REQUEST_PARAM_SECTIONS` / `SCHEMA_TYPE_TO_KIND`.
- [ ] `mcp.ts` JSDoc verbosity from round 60 code-quality inspector (non-blocking, fold into next edit on this file): the multi-line JSDoc blocks on `RunMCPOptions.tools` / `casing` at `mcp.ts:41-56` (added in commit `e8087468` for task 722) violate CLAUDE.md's "one short line max" comment rule. Collapse to single-line comments or delete outright — task 722's docs commit already documents the same surface externally in the `packages/cmdkit` README.
- [ ] `generate()` round-56 code-quality follow-ups from task 727's verbatim-name work (non-blocking, fold into the next edit on `generate.ts` — do not spin a dedicated round): (a) **Unify identifier-quoting rule.** `renderObjectKey` quotes a key when `name !== normalizeParamName(name) && isIdentifierName(name)` while `renderParamAccess` uses dot-access whenever `isIdentifierName(name)` — so `bot_handle` gets quoted as a key (`"bot_handle": params.bot_handle`) but dot-accessed as a value. Both helpers answer the same question, pick one predicate (either both on `isIdentifierName`, or both on normalized-identity). (b) **Bundle raw/helper/access names.** `createBodyField` / `createArrayParam` thread a raw `paramName` and a normalized `helperBaseName` side-by-side (the helper name must be a valid identifier for `--*-null` / `--*-json` suffixes). Compute once into `{ raw, helper, access }` so the two stay in lockstep instead of being re-derived at call sites. (c) **Collision guard for `*Null` helpers.** The `tags`-vs-`tag` collision test removed in round 55 was surfacing a genuine class of collisions at generate time; an operation declaring both `starters` (array) and `startersNull` (scalar) now silently collides on the generated `*Null` helper. Extend the existing collision registry to cover synthesized helper flags (`<name>Null`, `<name>Json`) against declared parameter names. (d) **KISS nit** at `createGeneratedParameter:616-617` — `renderParamAccess(paramName)` is computed twice; bind to a local as other sites do.
- [x] `generate()` reverse path-param consistency guard from round 62 spec-fidelity inspector (generate-time sanity check; bundle under task 711 when constraint work lands — none block milestone 7): `assertPathTemplateParameters` now validates both directions — path placeholders must have matching `in: "path"` parameters, and declared path parameters must appear in the URL template. Violations throw a `UserError` naming the operationId, path, and missing placeholder/parameter. Covered by the forward and reverse generate-time tests in `packages/cmdkit-openapi/src/generate.test.ts`.
- [ ] Plan-doc reconciliation: MCP inputSchema key casing from round 62 spec-fidelity inspector (non-blocking, plan-doc only — bundle with tasks 713 / 731 / 743 / 751 when plan-text reconciliation lands): task 727(a) claims OpenAPI parameter names "pass through verbatim to MCP/SDK/CLI surfaces," but `packages/cmdkit/src/mcp.ts:183-207, 120-132` still re-cases property names via `toRenderedName` (snake / camel per `RunMCPOptions.casing`). Wire fidelity holds (`wireName` is preserved on the HTTP request), and non-identifier names no longer crash the `inputSchema` (round-55 quoting work), but `x-trace-id` surfaces as `x_trace_id` / `xTraceId` in MCP — not verbatim. Tighten the task 727(a) wording to reflect: MCP `inputSchema` keys are normalized per `casing`; wire-level keys are verbatim.
- [x] Round-62 code-quality follow-up nits from code-quality inspector (builder round 63): dropped the redundant inner `as const` annotations from `TRANSPORT_PARAMS` now that the outer `as const satisfies ReadonlyArray<GeneratedParam>` already freezes the shape, and simplified `definition.kind[0]?.toUpperCase()` to `definition.kind[0].toUpperCase()` because `kind` is a non-empty string union. Covered by the same `@poe-code/cmdkit-openapi` 147/147 + root typecheck pass as task 735.
- [x] `generate()` request-body JSON media-type matching (builder round 64, closes task 737(c)): `collectRequestBodyParams` now walks `requestBody.content` with the shared `isJsonMediaType` predicate so `application/json; charset=utf-8` and `application/vnd.api+json` are accepted symmetrically with the response side. Error message reshaped to `must define a JSON request body media type in v1.`. Tests: two new positive cases (charset + vendor `+json`) and the updated negative assertion. Suite 149/149 green; `lint:types` + eslint clean.
- [ ] `generate()` round-63 code-quality nits from code-quality inspector (non-blocking, fold into the next edit on `generate.ts` — do not spin a dedicated round): (a) **Error-message wording drift** — the two new throws from task 735(b)/(c) use `"uses unsupported requestBody on GET"` and `"uses unsupported request body field"`; pick one spelling (`requestBody` or `request body`) so future throws stay consistent. (b) **`METHODS_WITHOUT_REQUEST_BODY = new Set(["get"])`** at `generate.ts:13` is a 1-element Set; either collapse to `method === "get"` (KISS) or lift the DELETE-intentionally-keeps-body rationale into a declarative shape. Low priority until a second method (HEAD / OPTIONS) needs exclusion. (c) **`createBodyField` third `schema.type` arm** — `createBodyField` now has object-reject + array-dispatch + scalar-fallthrough in one function, plus `SCHEMA_TYPE_TO_KIND` elsewhere. Once a fourth arm lands (composition keywords, non-object top-level bodies per task 737a/738b), fold into a single `BODY_FIELD_DISPATCH` table keyed by `schema.type` — same shape as `METHOD_DEFAULTS`. Not blocking this round. (d) **`renderSchemaCall(builder, ...args)` variadic + internal filter** at `generate.ts:1303` is mildly clever across 3 call sites (two shapes). If a third shape lands, prefer `renderSchemaCall(builder, args: Array<string | undefined>)` with explicit array literals at call sites. Readable as-is.
- [ ] `generate()` round-63 spec-fidelity deviations from spec-fidelity inspector (MCP-schema strictness; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Unsupported JSON-Schema keywords silently dropped** — `multipleOf`, `exclusiveMinimum` / `exclusiveMaximum`, `uniqueItems`, and top-level `nullable` on body object-schemas are not read in `createParamDefinition` (`generate.ts:805`); MCP clients won't see them. Same class of fidelity gap as the `minimum` / `maximum` / `pattern` work already shipped in task 714. (b) **`nullable: true` emitted as OAS-3.0-style** — `withMetadata` sets `jsonSchema.nullable = true` at `cmdkit-schema/src/index.ts:143`, but strict JSON Schema 2020-12 MCP clients expect `type: ["string", "null"]`. Decide v1 policy: keep OAS-3.0 emission and document it, or switch to the JSON-Schema-2020-12 form. (c) **`writeOnly` on request-body fields not filtered** — in OpenAPI, `writeOnly: true` on a request field is a no-op, but a response schema re-used as a request body carries the marker and noise leaks into MCP. Mirror the `readOnly` filter already applied by task 762(b).
- [ ] `generate()` round-64 code-quality nits from code-quality inspector (non-blocking, fold into the next edit on `generate.ts` — do not spin a dedicated round): (a) **First-match ambiguity in request-body JSON media-type selection** at `generate.ts:452` — `Object.entries(requestBody.content ?? {}).find(...)` picks the first JSON-compatible media type by object-key iteration order, so a spec declaring both `application/json` and `application/vnd.api+json` with different schemas silently depends on authoring order. Resolve to a declarative precedence pass (exact `application/json` first, then `+json`, then parameterized) — keeps it declarative, removes the silent ambiguity. (b) **`isJsonMediaType` uses `.includes("application/json")`** at `generate.ts:922` — also matches pathological types like `text/application/json-ish`; pre-existing on the response side, so no regression from round 64, but worth tightening later (`startsWith` + `;`/end boundary) now that the helper is shared across request + response paths.
- [ ] `generate()` round-64 spec-fidelity deviations from spec-fidelity inspector (MCP-schema fidelity; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Schema-level `required` on body fields lost when `requestBody.required !== true`** — `collectRequestBodyParams` at `generate.ts:472,:492-494` forces every field to `S.Optional` regardless of `schema.required`, so a caller can omit a schema-required field whenever the body itself is optional; MCP `inputSchema` advertises the field as optional while the server rejects partial bodies. Either document the "send the whole body or nothing" asymmetry or model it via a discriminated guard (`anyOf: all-required-or-none`). Same class as task 738(b). (b) **Query section always emitted** even when all values are `undefined` (see `generates a scalar query command` snapshot) — wire-safe (`http.ts:131-141` skips undefined), but inconsistent with the body's omit-when-all-undefined treatment from task 700. Cosmetic. (c) **MCP nullable-body scalar test coverage gap** — `--foo-null` CLI helpers for scalar nullable body fields are snapshotted, but there is no focused test that a nullable body scalar produces an MCP `inputSchema` that accepts `null` directly (MCP transmits JSON natively and has no CLI helper).
- [x] `generate()` required array body + `--*-json` unreachable CLI UX from round 66 spec-fidelity inspector (builder round 67): required body arrays now emit the direct array param as `S.Optional(...)` so cmdkit's CLI parser no longer rejects `--<name>-json` before the generated preflight runs; the preflight still enforces that one of `--<name>` / `--<name>-json` is present. Coverage: updated positive snapshot for `setConversationStarters`, focused generator assertions for the optional wrapper, and a CLI round-trip test proving `--starters-json '["a"]'` alone reaches the handler successfully.
- [ ] `generate()` round-66 spec-fidelity nits from spec-fidelity inspector (bundle under task 711 when constraint work lands — none block milestone 7): (a) **Nullable enum still drops `null` from the advertised `enum` list** — `normalizeEnumValues` at `generate.ts:938` filters `null` out and relies on the schema-level `nullable: true` marker to communicate it, so MCP `inputSchema` shows `{ type: "string", enum: [...non-null...], nullable: true }`. Acceptable under the current OAS-3.0 emission policy (cross-refs 777(b)), but strict JSON Schema validators still expect `null` in the `enum` list. Decide alongside 777(b) whether to re-add `null` to the emitted `enum` array or commit to the `nullable: true` signal. (b) **Scalar query `style` / `explode` ignored** — only array query params validate serialization (`generate.ts:570, 1392`); a spec declaring e.g. `style: "label"` on a scalar query emits a default-`form` flag silently. Low priority; same class of "don't invent serialization" gap already documented on the array side.
- [x] `generate()` required body array MCP-schema fidelity regression from round 67 spec-fidelity inspector (builder round 68): required direct array params now emit as CLI-optional with `requiredScopes: ["mcp", "sdk"]`, and shared cmdkit scope-filtering unwraps that optionality for MCP + SDK so `inputSchema.required` stays faithful while `--<name>-json` remains reachable from the CLI. Coverage: updated generator snapshots/assertions plus new MCP + SDK tests pinning the scoped-required behavior.
- [x] `generate()` endpoint-shape branching + latent query-array regression from round 67 code-quality inspector (builder round 68): `createArrayParam` now treats the direct array flag uniformly as CLI-optional (no `location === "body"` branch), and the same scoped-required metadata fixes the latent required-query-array `--<name>-json` path without endpoint-shape branching. Coverage: focused generator assertion for required query arrays plus the package suite.
- [ ] `cmdkit` + `cmdkit-schema` scope-type + error-string dedup from round 68 code-quality inspector (non-blocking readability nits; fold into the next edit on these files — do not spin a dedicated round): (a) **Duplicate `SchemaScope` type.** `packages/cmdkit-schema/src/index.ts:15` defines `type SchemaScope = "cli" | "mcp" | "sdk"` but does not export it, so `packages/cmdkit/src/schema-scope.ts:3` redeclares the same union. Export it from cmdkit-schema and import in `schema-scope.ts` — single source of truth for the scope enum. (b) **Duplicate `Bug: command ... must define an object params schema` error.** `packages/cmdkit/src/mcp.ts:289` and `packages/cmdkit/src/sdk.ts:415` throw nearly identical messages after the `filterSchemaForScope` guard; extract a shared `assertObjectParamsSchema(node, surface)` helper or leave (two copies is borderline acceptable). (c) **Hardcoded `["mcp", "sdk"] as const` at `packages/cmdkit-openapi/src/generate.ts:732`.** Add a one-line comment explaining the invariant — `cli` is intentionally omitted because the CLI relies on the `--<name>-json` helper to satisfy the required check before schema validation runs. Non-obvious otherwise.
- [ ] `generate()` spec-fidelity gaps from round 68 spec-fidelity inspector (generate-time / fidelity improvements; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Required-but-empty request body silently dropped.** If `requestBody.required === true` with `properties: {}`, `renderRequestShape` skips the whole `body:` section because `sectionFields.length === 0` (`generate.ts:1441-1443`); the wire request ends up with no body, violating the spec. Either reject at generate time with a `UserError` naming the operationId, or emit `body: {}` so an empty object is sent. Edge case, but same class as task 703 / 712 (generate-time spec-sanity check). (b) **Wire-name vs MCP casing roundtrip not covered by a focused test.** Behavior is correct today — params like `x-trace-id` surface as quoted `"x-trace-id": S.Optional(...)` in the emitted params schema and `http.ts` preserves the wire key verbatim — but no test pins the MCP `casing: "snake"` rewrite (`x_trace_id` in `inputSchema`, `x-trace-id` on the wire) end-to-end. Add a focused MCP roundtrip for a non-identifier name so a future renormalization regression fails loudly.
- [ ] `packages/cmdkit-openapi/src/generated-array-cli.test.ts` hygiene from round 67 code-quality inspector (non-blocking, pick up alongside the round-67 body-array fix above): the new CLI round-trip test added in builder round 67 constructs the command by hand with `defineCommand` rather than running `generate()` into memfs and dynamically importing the emitted module, so it proves cmdkit accepts the shape but does not guard the generator from drifting away from that shape — same "shape-not-generator" gap already called out elsewhere in the plan. Rewrite as a `generate()` + memfs + dynamic-import round-trip (CLAUDE.md "tests must not create files — use memfs"). While in the file, add a negative case that a missing-both-flags invocation still errors via the generated preflight (positive-only today).
- [x] `generate()` top-level body declarative-drift regression from round 69 code-quality inspector (builder round 69): flattened top-level body handling back into the main request-field path. `collectRequestBodyParams` now inlines the description-merge + `createBodyField(...)` call, `GeneratedTopLevelBodyRequest` / `GeneratedTopLevelBodyAssembly` are gone, `CollectedCommandParams` carries a `bodyShape: "passthrough" | "nested"` discriminator, and `renderRequestShape` reads that declared shape while relying on `optionalSections` as the only optional-body source of truth. Coverage: added focused generator assertions for optional top-level scalar + array bodies, package suite now 160/160 green, and root `npm run lint:types` passes.
- [ ] `generate()` spec-fidelity gaps from round 69 spec-fidelity inspector (generate-time sanity checks; bundle under task 711 when constraint work lands — none block milestone 7): (a) **Nullable path / scalar-query params have no runtime null handling.** `createParamDefinition` propagates `nullable: true` but only body fields synthesize a `--<name>-null` helper; a consumer passing `null` to a path param via MCP/SDK produces `/{null}` in the URL. Reject `nullable: true` on path params at generate time with a `UserError`, matching the scalar-only policy already enforced by task 767(a). (b) **Optional body with all `readOnly` fields silently emits no `body` key.** `collectRequestBodyParams` filters `readOnly: true` properties (task 767(b)) — if the filter empties `sectionFields`, `renderRequestShape` at `generate.ts:1580` `continue`s and nothing goes on the wire, even when `bodyOptional === false`. Probably intended for the optional case, but an all-readOnly required body should fail at generate time — same class as task 785(a). Other inspector flags (`writeOnly` unhandled, `additionalProperties` dropped, scalar query `style`/`explode` ignored, response schemas untyped) are already tracked in 743(c)/(d), 777(c), 781(b).
- [ ] `generate.test.ts` composition-keyword dedup from round 69 testing inspector (non-blocking, fold into the next edit on this file): the three `oneOf` / `anyOf` / `allOf` rejection tests at `generate.test.ts:~2225-2370` differ only in the keyword and the error-message substring — classic `it.each` candidate. Flags duplication, not correctness; coverage is otherwise appropriate (top-level scalar + array positives, cookie + header negatives, per-keyword composition rejections). Suite status: 158/158 green via `npm test --workspace=@poe-code/cmdkit-openapi` (580ms). Known running-from-wrong-cwd nit: `npx vitest run` from inside the package fails because `tests/setup.ts` resolves from the repo root; no action — matches the documented workspace invocation.
- [x] `generate()` residual top-level-body declarative-drift from round 70 code-quality inspector (builder round 71): `GeneratedRequestField` now carries a `render: "wrapped" | "inline"` discriminator, and `renderRequestShape` dispatches through a `REQUEST_FIELD_RENDERERS` table so the loop body no longer branches on top-level-body shape. The transient `bodyShape` plumbing was removed from `CollectedCommandParams` / `createGeneratedCommand` / `createCommandFile`, and `collectRequestBodyParams` now funnels both top-level and object-shaped bodies through one `createCollectedRequestBodyParams(...)` helper instead of returning two near-identical records. Coverage: added a focused regression test that keeps query params + an optional top-level scalar body inline, `npm test --workspace=@poe-code/cmdkit-openapi` is 161/161 green, and root `npm run lint:types` passes.
- [ ] `getCompositionKeyword` declarative-drift nit from round 70 code-quality inspector (non-blocking, fold into the next edit on this file): `generate.ts:1175-1187` is three sequential `if … return` blocks keyed off a known-order list of composition keywords. Replace with `for (const keyword of ["allOf", "anyOf", "oneOf"] as const) { if (schema[keyword] !== undefined) return keyword; } return undefined;` — the keyword order is a declarative list, not imperative branching.
- [ ] `requestBody.description` duplication from round 70 spec-fidelity inspector (cosmetic, new in task 787's diff): when a top-level scalar/array request body schema has no `description` but `requestBody.description` is set, the schema-merge at `generate.ts:479-483` lifts that description into the `body` param's description, and `mergeCommandDescriptions` also appends `Request body: …` into the command description, so the same string surfaces twice. Either skip the merge-into-param when `requestBody.description` is already carried by the command description, or suppress the `Request body:` append when the body is a passthrough scalar/array (the param-level description already carries it).
- [ ] `render` discriminator at wrong level from round 71 code-quality inspector (must-fix before the renderer grows a third mode or a second inline field ever lands): the round-70/71 refactor landed `render: "wrapped" | "inline"` on `GeneratedRequestField`, but `renderRequestShape` at `generate.ts:1506` reads only `sectionFields[0]?.render` and applies it to the whole section — mixed render values in one section would silently drop every field after the first on the inline path. Same class of "wrong level" trap killed in rounds 24 (`location === "body"` body-omit branch → `REQUEST_PARAM_SECTIONS.omittable`), 27 (`jsonType` spread), 29 (`transport` scope), and 34 (`delete` confirm). The type also allows `render: "inline"` on path / query sections even though emitting `query: <expr>` with no wire-name wrapping would break URL construction — same root cause. Fix: move the discriminator onto `CollectedCommandParams` as a per-section map (mirroring `optionalSections`), so each section has exactly one `render` value and non-body sections can't accept `"inline"` at the type level. Alternative if the move is disruptive: keep the per-field tag but throw at `renderRequestShape` entry when a section mixes render modes.
- [ ] Round-71 code-quality nits from code-quality inspector (non-blocking, fold into the next edit on `generate.ts` — do not spin a dedicated round): (a) **Drop the `render = "wrapped"` default on `createBodyField`** at `generate.ts:634` — per "explicit over implicit / state the actual value directly," pass `"wrapped"` at the properties-loop call site (`generate.ts:512-518`) so both call sites declare their render mode the same way. The top-level path already passes `"inline"` explicitly; the default hides the convention. (b) **`REQUEST_FIELD_RENDERERS` declared after its caller** at `generate.ts:1517` vs. the `renderRequestShape` call site at `:1506`. Works (hoisted `const`, used at call time), but reads backwards — hoist the table above `renderRequestShape`. Overlaps with the round-71 must-fix above on the same lines; bundle if both land together.
- [ ] Runtime generation mode — `commandsFromSpec(source, opts?)`: reuse the in-memory stage of `generate()` to build `Command[]` from a path / URL / pre-parsed spec, no file emission, no lock. Wire into `defineClient` as a plain `commands: [...]` input so merge + conflict detection keep working unchanged. Testing: happy path against the same fixtures the codegen snapshots use, a mix with handwritten commands (collision detection still fires), and one spec-fetch error case. Out of scope: type-generation for consumer code (no `generated` import) and streaming / incremental rebuilds.
- [x] `auth` mode implicit default from round 72 code-quality inspector (builder round 73): generated commands now always emit the resolved auth literal (`auth: "required"` or `auth: "none"`), `HttpRequestOptions.auth` is required, and generator/http/index tests pin the explicit contract so readers never have to infer the default.
- [x] Document-level `security` inheritance ignored from round 72 code-quality + spec-fidelity inspectors (builder round 73): `getOperationAuthMode` now falls back from `operation.security` to `document.security`, so root-level `security: []` correctly renders inheriting operations as `auth: "none"`. Coverage: focused generator tests for default-required and document-level-none inheritance, plus the updated package suite and root `lint:types`.
- [ ] Query-array comma / pipe percent-encoding from round 72 spec-fidelity inspector (wire-level fidelity; non-blocking, no confirmed consumer breakage): `renderQueryArrayValueExpression` joins `form` + `explode: false` arrays as `"a,b,c"` and `pipeDelimited` arrays as `"a|b|c"`, but `appendQueryValue` at `http.ts:132` pipes the joined string through `URLSearchParams.append`, which percent-encodes `,` → `%2C` and `|` → `%7C`. Most OpenAPI servers tolerate `%2C` but strict `pipeDelimited` receivers may not. Fix only if a real consumer trips on it; when it does, build the query string manually for these two shapes so the raw separator reaches the wire. Cross-ref tasks 709 / 749 (query-array serialization work) — same code paths.
- [ ] `deprecated` flag not surfaced from round 72 spec-fidelity inspector (cosmetic; non-blocking): neither `operation.deprecated` nor `parameter.deprecated` are read anywhere in `generate.ts`. Generated command / parameter descriptions carry no deprecation indicator in CLI `--help` or MCP tool descriptions. Fix: thread a `deprecated: true` marker into the command + param descriptions (prefix with `[DEPRECATED]` or append a note) so agents and CLI users see the signal.
