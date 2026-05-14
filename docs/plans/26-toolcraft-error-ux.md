---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: toolcraft-openapi-http-error-context
    title: HttpError carries request and response context
    prompt: |
      Today `HttpError` in
      packages/toolcraft-openapi/src/http.ts only stores `status` and a
      parsed `body`. The class message is just `HTTP ${status}`. When an
      OpenAPI-driven command fails server-side, the user sees no method,
      no URL, no response headers, and no status text — only a stack
      trace once `--debug` is on. The request is the part that
      identifies the failure; right now it is lost.

      Rewrite the class to:

        export interface HttpErrorRequest {
          method: string;
          url: string;
          headers: Record<string, string>;  // already redacted (Bearer ****)
          body?: unknown;                    // already-parsed input body
        }

        export interface HttpErrorResponse {
          status: number;
          statusText: string;
          headers: Record<string, string>;
          body: unknown;                     // parsed when JSON, raw text otherwise
        }

        export class HttpError extends Error {
          readonly status: number;
          readonly statusText: string;
          readonly request: HttpErrorRequest;
          readonly response: HttpErrorResponse;
          readonly body: unknown; // backwards-compatible alias of response.body
          constructor(args: { request: HttpErrorRequest; response: HttpErrorResponse; message?: string });
        }

      Default `message` (when not overridden):
        `${request.method} ${request.url} → ${response.status} ${response.statusText}`

      In `requestJson` (packages/toolcraft-openapi/src/http.ts):
        - Capture `response.statusText` and serialise `response.headers`
          to a `Record<string, string>` (iterate `response.headers.entries()`).
        - Build the `request` payload with the same `headers` map already
          produced by `createHeaders`, then re-apply the same Authorization
          redaction used in `formatDryRunOutput` (Bearer **** when present).
        - Pass both into the new `HttpError`.
        - The current "Expected a JSON response body" path on line 76
          must use the same constructor, not the legacy three-arg form.

      Backwards compatibility: keep the `body` getter so existing
      tests (`http.test.ts:213`, `index.test.ts:174`) and consumers
      reading `err.body` keep working. The legacy `new HttpError(status, body)`
      shape is removed — only the new constructor remains.

      Tests in packages/toolcraft-openapi/src/http.test.ts:
        - 500 with JSON body: error has `request.method`, `request.url`,
          `response.status`, `response.statusText`, `response.body`
          populated; `message` matches the default form
        - 401: invalidate is still called; request/response captured
        - non-JSON 200: error carries response.headers content-type
        - Authorization header in `request.headers` is `Bearer ****`,
          never the raw token

      No changes to consumers in this task. The render layer comes next.
    status:
      implement: done
      test: done
      commit: done

  - id: toolcraft-openapi-http-error-render
    title: CLI renders HttpError with request and response, not a stack
    prompt: |
      Today `packages/toolcraft/src/cli.ts` `handleRunError` (line 3319)
      treats anything that is not `UserError` or `CommanderError` as
      "unexpected": print `${err.message} Use --debug for a stack trace.`
      and dump the stack on `--debug`. When the failure is an
      `HttpError` from a generated OpenAPI command, the stack tells the
      user nothing — they want the response.

      `toolcraft` cannot import `toolcraft-openapi`. Two options:

      Option A (chosen): `toolcraft` recognises any thrown error whose
      `name === "HttpError"` and exposes `request` + `response` shaped
      like the `HttpError` defined in the previous task. Use structural
      typing — no cross-package import.

      Add a helper in packages/toolcraft/src/cli.ts:

        function isHttpErrorLike(error: unknown): error is {
          name: "HttpError";
          message: string;
          request: { method: string; url: string; headers: Record<string,string>; body?: unknown };
          response: { status: number; statusText: string; headers: Record<string,string>; body: unknown };
        }

      Branch `handleRunError` on it. Render to stderr in this order
      (use text helpers from `@poe-code/design-system` so styling is
      consistent — `text.muted` for the dim lines, `text.error` for the
      status, plain text otherwise; gate styling on the same isTTY path
      already used by help):

        Request:  GET https://api.example.com/v1/widgets/42
        Status:   500 Internal Server Error

        Response headers:
          content-type: application/json
          x-request-id: 8f3c…

        Response body:
          { "error": "internal_panic", "trace_id": "8f3c-…" }

      Truncation rules:
        - Without `--verbose`: print only `Request`, `Status`, and a
          one-line snippet of the response body (first 200 chars,
          collapsed whitespace). The headers block and the full body
          are suppressed; add the literal line
          `Re-run with --verbose to see headers and full body.`
        - With `--verbose`: print everything above with no truncation.
        - With `--debug`: print everything above PLUS the stack trace.

      `--verbose` is the existing OpenAPI-side flag (see http.ts:51 and
      its propagation via `HttpRequestOptions.verbose`). It is not a
      toolcraft-level flag today. Add a CLI-level boolean `--verbose`
      to `runCLI`'s argv parser alongside `--debug` and `--yes`, and
      pass it into the renderer state. It does NOT replace `--debug`
      — `--debug` continues to gate stack traces, `--verbose` gates
      detailed runtime info (the HTTP transcript here, plus
      whatever lands in the next task).

      Both `--verbose` and `--debug` are diagnostic-only — they must
      not appear in the help table. Today `--debug` is listed at
      packages/toolcraft/src/cli.ts:1421 (added by plan 22). Remove
      it from `formatGlobalOptionRows`, and do not add `--verbose`
      to that function. They stay registered on Commander
      (`.option("--debug", "...")`, `.option("--verbose", "...")`)
      so the parser still accepts them, but the help renderer skips
      them. The fact that they exist is surfaced only by the error
      footer itself ("Re-run with --verbose to see headers and full
      body." / the existing "Use --debug for a stack trace." hint).
      Update `ALWAYS_GLOBAL_LONG_OPTION_FLAGS` at
      packages/toolcraft/src/cli.ts:875 to include `--verbose` so the
      Commander hidden-flag set is consistent.

      Body rendering:
        - If `response.body` is a string, print as-is, indented two
          spaces.
        - Otherwise `JSON.stringify(response.body, null, 2)`, indented.

      Header redaction: pass response headers through unchanged
      (response headers don't carry the client's bearer); request
      headers were already redacted in the previous task.

      Exit code stays 1. No stack trace unless `--debug` is set.

      Tests in packages/toolcraft/src/cli.test.ts (new file
      cli.http-error.test.ts is fine):
        1. Default mode: HttpError-like thrown by a fake handler →
           stderr matches the truncated snapshot; no stack
        2. `--verbose`: full headers + full body in stderr; no stack
        3. `--debug`: stack present; full transcript present
        4. UserError is unchanged — no transcript rendered
        5. Generic Error is unchanged — old message + debug hint
        6. Authorization in request.headers is rendered as `Bearer ****`
    status:
      implement: done
      test: done
      commit: open

  - id: toolcraft-openapi-verbose-transcript
    title: --verbose prints the request body and the response transcript
    prompt: |
      Today `requestJson` (packages/toolcraft-openapi/src/http.ts:51)
      writes `${method} ${url}` to stderr in verbose mode BEFORE the
      fetch, and nothing after. The response is invisible even on
      success, and on failure the transcript is lost.

      Replace the verbose path with a full request/response transcript:

        Before fetch:
          → ${method} ${url}
              Authorization: Bearer ****           (when present)
              Content-Type: application/json       (when body)
              (no body line for GET/HEAD)
              ${pretty JSON of options.body, indented 2}   (when body)

        After fetch:
          ← ${response.status} ${response.statusText}
              content-type: …
              x-request-id: …
              …
              ${pretty body, indented 2}            (when not empty)

      All transcript lines render through `text.muted` so they don't
      compete with the command's stdout. Use the same redaction helper
      as `formatDryRunOutput` (Bearer ****). Add `text.muted` only when
      `process.stderr.isTTY` — fall back to plain text otherwise.

      The transcript is emitted regardless of outcome (success too) so
      the user can see what came back. Today success is silent, which
      makes debugging "I got nothing" cases impossible.

      JSON pretty-print: `JSON.stringify(value, null, 2)`. For binary
      / non-text responses (already handled by the parsed-body path:
      string fallback) print the raw text body as-is.

      Body size cap: 4 KB per body, with a trailing
      `… (${truncatedBytes} bytes truncated; rerun without --verbose
      is not the answer here — set --debug to also see the stack)` —
      no, drop that suggestion. Just append
      `… (${truncatedBytes} bytes truncated)`.

      The dry-run path (line 55) keeps its existing formatter; do not
      route it through the new transcript code.

      Tests in packages/toolcraft-openapi/src/http.test.ts:
        - verbose success with JSON body: stderr contains the request
          line, the request body, the response status line, response
          headers, and a pretty-printed body
        - verbose success with empty 204: response status and headers
          render; body section is omitted
        - verbose failure (500 with JSON body): the thrown HttpError
          still carries everything from the prior task AND the verbose
          transcript has already been written to stderr by the time
          the throw happens
        - Authorization is rendered as `Bearer ****` in the request
          block, never the raw token
        - non-verbose: nothing written to stderr by requestJson
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-openapi-spec-source-context
    title: spec-source errors include status and response body
    prompt: |
      `packages/toolcraft-openapi/src/spec-source.ts:43-46` throws

        `Failed to fetch "https://…/openapi.json": 404 Not Found`

      The user has no idea whether the server returned HTML, an
      `application/problem+json` payload, or an HTML 404 page. Add the
      response body (capped, like the http.ts transcript).

      In `readOpenApiSourceText`, after `!response.ok`:

        const contentType = response.headers.get("content-type") ?? "";
        const text = await response.text().catch(() => "");
        const snippet = text.length === 0
          ? ""
          : `\n  body: ${truncate(text, 500)}`;
        throw new UserError(
          `Failed to fetch ${JSON.stringify(inputUrl.toString())}: ` +
          `${response.status} ${response.statusText}` +
          (contentType ? ` (content-type: ${contentType})` : "") +
          snippet
        );

      `truncate` collapses to a single line of N chars + `…` suffix.

      Update the existing test at runtime.test.ts:1076 (and the
      equivalent in spec-source.test.ts if present) to assert the new
      shape. Pin the snippet text in a tight regex so unrelated
      formatting changes don't break the test.

      Parse-path: `parseOpenApiDocument` (line 67) already wraps the
      YAML/JSON parser message via `getErrorMessage`. Verify by reading
      the `yaml` lib's `parseError`: if the underlying error carries
      `linePos` / `pos`, surface `at line N column M` in the message.
      If it doesn't, leave the existing message and add a one-line
      comment pointing at the limitation.

      Tests in packages/toolcraft-openapi/src/spec-source.test.ts:
        - 404 with HTML body: error mentions status, statusText,
          content-type, and an HTML snippet
        - 500 with JSON problem body: error mentions content-type and
          the JSON snippet
        - YAML parse error with linePos: message contains
          "at line N column M"
        - Filesystem ENOENT: error mentions the absolute resolved path,
          not just the input string
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-openapi-bug-errors-to-user-errors
    title: Reclassify "Bug:" Errors so they don't reach end users raw
    prompt: |
      Three sites in toolcraft-openapi throw a plain `Error` (not
      `UserError`), so they slip past the bin's UserError catch
      (bin/generate.ts:105) and crash with a stack trace:

        - define-client.ts:128: "Bug: merged command node is missing
          source metadata."
        - generate.ts:1149 (verify exact line — the audit flagged it
          but the file is large; grep for `throw new Error(` first)
        - mock/fetch.ts: `MockFetchError` extends Error (not UserError);
          when uncaught it crashes the same way

      And in toolcraft itself:
        - mcp.ts:312: `Bug: command "${name}" must define an object
          params schema for MCP.`
        - sdk.ts:480: same shape
        - index.ts:788 / index.ts:793: default-child guards

      For each: the condition is genuinely a library / config-author
      bug — it cannot be fixed by an end user typing different argv.
      But the way they surface today (raw stack) is the worst possible
      mode: the user sees toolcraft internals and a stack with no
      filename hint.

      Two changes:

      1. Introduce one shared class in
         packages/toolcraft/src/user-error.ts:

           export class ToolcraftBugError extends Error {
             constructor(message: string) {
               super(message);
               this.name = "ToolcraftBugError";
             }
           }

         Replace every `throw new Error("Bug: …")` and every plain
         `Error` in user-facing paths (the three openapi sites above,
         the four toolcraft sites above) with `throw new ToolcraftBugError(...)`.
         Drop the literal "Bug:" prefix from the message — the class
         name carries that.

         For `MockFetchError` in toolcraft-openapi/src/mock/fetch.ts:
         keep the class (some callers branch on it), but make it extend
         `UserError`, not `Error`. Mock fixtures are authored by users
         of the test API; mismatches are user errors.

      2. In `packages/toolcraft/src/cli.ts` `handleRunError`, add a
         branch BEFORE the generic Error path:

           if (error instanceof Error && error.name === "ToolcraftBugError") {
             logger.error(
               `toolcraft hit an internal invariant: ${error.message}\n` +
               `This is a bug in toolcraft or in the command definition; ` +
               `it cannot be worked around by changing argv. ` +
               `Re-run with --debug for a stack trace and file an issue.`
             );
             if (debug && error.stack) {
               process.stderr.write(`${error.stack}\n`);
             }
             process.exitCode = 1;
             return;
           }

         Structural check on `name`, same pattern as the HttpError
         branch from the render task — toolcraft and toolcraft-openapi
         don't share an import boundary for these types.

      Tests:
        - packages/toolcraft/src/cli.test.ts: ToolcraftBugError thrown
          by a handler → stderr starts with "toolcraft hit an internal
          invariant"; no stack without --debug; stack with --debug
        - packages/toolcraft-openapi/src/mock/fetch.test.ts (or
          wherever MockFetchError is currently asserted): update to
          check `instanceof UserError`

      Do not silently wrap arbitrary Errors as ToolcraftBugError —
      keep the existing generic-Error path for genuinely unexpected
      throws (network failures inside a handler, OOM, etc.).
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-validation-shows-received
    title: Validation errors include the received value
    prompt: |
      Across packages/toolcraft/src/cli.ts, mcp.ts, sdk.ts, and
      packages/toolcraft-schema/src/validate.ts, dozens of validation
      errors say `Expected X` and stop there. The user has to guess
      what they passed. Some examples:

        - cli.ts:676 `Invalid value for "${label}". Expected true or false.`
        - cli.ts:721 `Invalid value for "${label}". Expected valid JSON.`
        - mcp.ts:420/426/434/443/461 `Expected a string` / `a boolean`
          / `an array` / `an object`
        - sdk.ts:326/332/340/349/364 same as MCP
        - validate.ts type-mismatch issues set `received` on the
          ValidationIssue but the formatted `message` field never uses
          it

      Add a single helper in packages/toolcraft/src/cli.ts (and
      mirror in sdk.ts / mcp.ts — these don't share infrastructure
      today):

        function describeReceived(value: unknown): string {
          if (value === null) return "null";
          if (value === undefined) return "missing";
          if (Array.isArray(value)) return `array(${value.length})`;
          if (typeof value === "object") return "object";
          if (typeof value === "string") {
            const s = value.length > 40 ? `${value.slice(0, 40)}…` : value;
            return `${JSON.stringify(s)}`;
          }
          return JSON.stringify(value);
        }

      Append `, got ${describeReceived(value)}` to every validation
      message that has the offending value in scope. Concretely:

        cli.ts boolean: `Invalid value for "--enabled". Expected true or false, got "yes".`
        cli.ts enum: `Expected one of: rich, md, markdown, json, got "rtf".`
        cli.ts JSON: `Expected valid JSON, got "{foo:1}" (parser: Unexpected token f at position 1).`
        mcp.ts string: `Expected a string, got number.`
        mcp.ts array: `Expected an array, got string.`
        validate.ts type error: include the received-kind in the
          message text, not only the structured `received` field.

      For toolcraft-schema specifically (packages/toolcraft-schema/
      src/validate.ts), keep the structured `ValidationIssue` shape
      (`expected`, `received` already exist) but rewrite the `message`
      builder so it concatenates: `Expected ${expected} at ${path},
      got ${received}`. This loses zero information for callers that
      read structured issues and adds value for callers that read the
      string.

      Update the renderer at packages/agent-harness/src/loader/validate.ts:28
      so it no longer prepends the path a second time. New form:
        `${mdPath} (${formatPath(path)}): ${message}`.
      The message itself already mentions the path; the renderer
      adding `${mdPath}: ${formatPath}: ${message}` produced
      `…: user.name: Expected string at user.name`.

      Tests:
        - packages/toolcraft-schema/src/validate.test.ts: every
          type-mismatch test now asserts on the `, got X` suffix
        - packages/toolcraft/src/cli.test.ts: existing boolean parse
          assertion (cli.test.ts:529) is extended to the `got` form
        - packages/toolcraft/src/mcp.test.ts and sdk.test.ts: parallel
          assertions

      Edge cases:
        - Receiving an enormous string: truncate to 40 chars + ellipsis
        - Receiving a secret-looking value: do NOT redact here; this
          is the user's input back to them, they already typed it
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-validation-lists-options
    title: '"Unknown X" errors list available X'
    prompt: |
      Several "X not found" errors leave the user grepping the
      handler for the answer:

        cli.ts:759 / 2714 / 2883: `Unsupported CLI schema kind.`
        cli.ts:2570 / mcp.ts:197 / sdk.ts:301: `Service name "${name}" is reserved.`
        cli.ts:2428: `Fixture scenario "${selector}" was not found.`
        cli.ts:2737 / 2776: `Unknown parameter "${name}".`
        mcp.ts:474 / sdk.ts:377: `Unexpected parameter "${name}".`
        human-in-loop/runner.ts:134..154: `Unknown approval command path "${commandPath}".`

      Append `Available: ${list.sort().join(", ")}.` to each. Where
      the available set is empty (no fixtures defined yet), say
      `No fixtures are declared in ${fixturePath}.`

      Reserved-name lists: the reserved set is known statically. Hard-
      code `Available reserved names: params, secrets, fetch, fs, env,
      progress, runtimeOptions, root` (verify the exact set against
      the matching guard) — the user sees what they collided with.

      Unknown parameter on a discriminated union: include the
      currently-selected branch and its valid parameters:
        `Unknown parameter "destination.priority" for destination.kind="email".
         Available: destination.address, destination.subject.`

      Approval command paths: enumerate the root tree at the moment
      the error is raised. Use the same traversal that the CLI uses
      to render `--help`; cap at 20 entries with `…` and a count if
      the tree is large.

      Tests in the three affected test files; each existing
      "Unknown X" assertion gets a matching "Available: …" assertion.
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-internal-jargon-pass
    title: Drop internal jargon and redundant Error prefixes from user messages
    prompt: |
      Sweep across the three packages:

      1. packages/toolcraft/src/index.ts lines 561, 584, 592, 598,
         605, 611: drop the leading `Error:` prefix. The CLI logger
         (`createLogger().error`) already paints these. Same in
         packages/toolcraft/src/human-in-loop/approvals-commands.ts:100.

      2. packages/toolcraft/src/cli.ts:2714 and :2883:
         `Unsupported dynamic CLI schema kind "${unwrappedSchema.kind}".`
         "unwrappedSchema" is an internal local. Rewrite as:
         `Unsupported parameter type "${kind}" for "${displayPath}". `
         + `Supported types: string, number, integer, boolean, array,
            object, enum, oneof.`

      3. packages/toolcraft/src/human-in-loop/approval-tasks.ts:41:
         `approvals task-list configured with a different state machine; pass approvalStateMachine when opening the list`
         Replace with:
         `Approvals task list was created with a different version of
          toolcraft. Delete the task list directory (${dir}) or pass a
          matching approvalStateMachine.`

      4. packages/toolcraft/src/human-in-loop/default-provider.ts:10:
         `no human-in-loop provider configured for this platform — pass humanInLoop.provider to the runtime`
         Replace with:
         `No human-in-loop provider is configured. Pass {humanInLoop:
          {provider: ...}} to runCLI / createMCPServer / createSDK,
          or run on macOS to use the default osascript provider.`

      5. packages/toolcraft/src/json-schema-converter.ts: every error
         mentions JSON Schema keywords with no context. Rewrite as:
         line 53: `JSON Schema "${path}" has an unsupported type
                   "${type}". Supported: string, number, integer,
                   boolean, array, object.`
         line 123: `JSON Schema "${path}" is an array but is missing
                   the "items" field. Add "items": { … } to declare
                   the element type.`
         line 153: `JSON Schema "${path}" must declare one of: "type",
                   "enum", "const", "oneOf", "anyOf", or "allOf".`
         line 263: `Expected "${path}" to be an object schema (got
                   "${kind}").`
         line 380: `JSON Schema "${path}" uses oneOf/anyOf/allOf but
                   has no branches.`
         line 451: `JSON Schema "${path}" uses "$ref": ${ref}.
                   toolcraft only supports internal refs like
                   "#/components/schemas/Foo".`

      6. packages/toolcraft/src/mcp.ts:645: replace the bug message
         with `MCP server version is required. Pass version: "x.y.z"
         to createMCPServer / runMCP, or run toolcraft from a project
         whose package.json defines "version".`

      Tests: each rewritten message gets a matching test case
      (extend cli.test.ts, mcp.test.ts, sdk.test.ts, and
      json-schema-converter.test.ts). The point is to pin the new
      text so future renames don't regress to the old jargon.
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-cause-chain-on-parse-and-io
    title: JSON / YAML / fs errors carry the underlying cause
    prompt: |
      Several parse failures swallow the parser's actual message:

        cli.ts:2103 — `Preset file "..." is not valid JSON.`
        cli.ts:2464 — `Fixture file ... is not valid JSON.`
        lock.ts:22 — JSON.parse failure silently treated as no-lock
        spec-source.ts:67 — already includes `getErrorMessage(error)`,
          good template

      Rewrite the cli.ts and lock.ts paths to match the spec-source
      pattern:

        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new UserError(
            `Preset file "${presetPath}" is not valid JSON: ` +
            `${(error as Error).message}.`,
            { cause: error }
          );
        }

      Same for fixture files. The `cause: error` argument lands on
      `Error.cause` and is picked up by `--debug`'s stack printer
      when chained — Node prints `[cause]:` after the primary stack.

      For lock.ts:22: today a corrupt lock file is silently treated
      as "no lock" and the generator proceeds. That's surprising —
      a corrupt lock means the user has manual edits or a half-
      written file. Throw a `UserError` with the parse error and
      the path; let the user delete the file deliberately.

      Wrap fs operations that the user can reasonably hit:
        - lock.ts:56: writeFile failures should mention the lock path
          and `error.code` (EACCES, ENOSPC, …)
        - cli.ts:2095 already includes `error.message` for preset
          read errors — leave it

      Tests:
        - preset JSON syntax error: message contains
          `Unexpected token` (from V8) and the path
        - corrupt lock: error mentions the path and the parser line
        - lock write failure (mocked fs.writeFile that rejects with
          EACCES): error mentions the lock path
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-schema-union-context
    title: Union and oneof errors list the branches that were tried
    prompt: |
      Today `packages/toolcraft-schema/src/validate.ts:368-374` says
      `Expected exactly one union branch at ${path}` and stores
      `received: "0 matching branches"`. For a CLI user this is
      useless — they don't know which keys distinguish the branches.

      In validate.ts, when a union has zero matches:

        message: `No union branch matched at ${path}. ` +
                 `Tried ${branchCount} branches. ` +
                 `Expected one of: ${branchDescriptions.join(" | ")}.`

      Branch descriptions: derive a short fingerprint from each
      branch (the keys it requires, joined). Reuse the
      `required-key fingerprint` machinery already used by the
      uniqueness guard in union.ts:33.

      When a union has multiple matches (ambiguity), keep "matched
      more than one branch" but list which ones (by fingerprint).

      OneOf (discriminator) at validate.ts:323-330: the message
      already says `Expected one of <discriminator values>`. Add the
      received discriminator value in the message body
      (`got "audio"`) per the validation-shows-received task. When
      the discriminator field is entirely missing, say so explicitly:
        `Missing discriminator "${discriminatorKey}" at ${path}.
         Expected one of: ${values.join(", ")}.`

      Schema-builder fingerprint collision at union.ts:33: rewrite
      to list the offending branches:
        `Union branches [${badIndices.join(", ")}] share required-key
         fingerprint "${keys.sort().join("+")}". Each branch must
         require a distinct set of keys.`

      Tests in packages/toolcraft-schema/src/union.test.ts and
      validate.test.ts:
        - zero-match union: message lists each branch's required-key
          fingerprint
        - ambiguous union: message names the matching branches
        - missing discriminator: dedicated message form
        - duplicate fingerprint at build: message names the offending
          indices
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-cli-did-you-mean
    title: Did-you-mean for commands, flags, enum values, env vars
    prompt: |
      When the user types `mytool widgts list`, today they see
      `error: unknown command 'widgts'` (from commander) and have to
      open `--help` to spot the typo. Same for `--namee` (close miss
      on `--name`), `--output rtf` (close miss on `rich`), and
      missing-secret errors when the env var is set under a near-but-
      not-exact name (`POE_KEY` set, `POE_API_KEY` required).

      Add a single Damerau-Levenshtein helper in
      packages/toolcraft/src/cli.ts (or a new
      packages/toolcraft/src/suggest.ts if cli.ts is too dense):

        export function suggest(
          input: string,
          candidates: readonly string[],
          opts?: { max?: number; threshold?: number }
        ): string[];

      Threshold default: distance ≤ max(1, floor(input.length / 4)).
      Max suggestions: 3. Sort by distance ascending, then
      alphabetical. Empty input returns [].

      Wire it into four spots:

      1. Unknown command:
         Commander already emits `error: unknown command 'X'`. Replace
         that path by catching the `CommanderError` with code
         `commander.unknownCommand` in `handleRunError` (cli.ts:3328)
         and re-rendering with suggestions drawn from the current
         group's children. New form:
           Unknown command "widgts".
           Did you mean: widgets?

      2. Unknown flag:
         Same pattern, code `commander.unknownOption`. Candidates =
         the registered long flags on the current command.
           Unknown option "--namee".
           Did you mean: --name, --namespace?

      3. Invalid enum value (cli.ts:687, mcp.ts:397, sdk.ts:308):
         Today these list expected values. When the received value is
         a close miss, prepend a "Did you mean: X?" line above the
         existing "Expected one of: …" list.

      4. Missing required secret (index.ts:561):
         When throwing for a missing env var, scan `Object.keys(process.env)`
         for close matches to `secret.env`. Append a "Did you mean:
         POE_KEY?" line when a hit is found. Do NOT print the value of
         the candidate env var — only the name.

      Tests in packages/toolcraft/src/suggest.test.ts and per-site
      tests for each of the four wirings:
        - exact distance-1 typos suggested
        - distance-3 typos NOT suggested for short inputs
        - empty input returns no suggestions
        - "Did you mean: …" prepends, never replaces, the existing
          "Available: …" / "Expected: …" lines (so the user still
          sees the full list)
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-validation-batch
    title: Collect all validation errors before reporting
    prompt: |
      Today CLI/MCP/SDK input validation fails fast: the first invalid
      parameter throws, the user fixes it, runs again, hits the second
      one, repeats. A handler that takes 8 params can require 8 round
      trips to get right.

      Convert the validation passes in cli.ts (the `applyDynamic*`
      paths around lines 2737-3187), mcp.ts:397-493, and sdk.ts:308-396
      from throw-on-first-error to collect-into-array:

        type ValidationError = {
          path: string;       // user-facing display path
          message: string;    // the existing per-site message
        };

      Walk the schema and accumulate every issue. At the end of the
      pass, if `errors.length > 0`, throw a single `UserError` whose
      message is:

        ${errors.length} parameter ${errors.length === 1 ? "error" : "errors"}:
          - ${errors[0].path}: ${errors[0].message}
          - ${errors[1].path}: ${errors[1].message}
          ...

      Keep the per-issue text identical to today's single-error path
      (after the validation-shows-received task lands) so existing
      tests that assert on substring messages still pass.

      Cap at 10 issues with a trailing `… and ${remaining} more`
      to keep terminal output readable for pathological cases.

      Path resolution stays fail-fast — a missing parent object means
      child validation is meaningless, so don't recurse into a branch
      whose root failed type check. Inside an object that exists,
      collect every field error.

      For toolcraft-schema's validate.ts: it already returns an
      array of issues. Only the CLI/MCP/SDK consumers fail-fast.
      Update them to render the full issue array, not just the first.

      Tests:
        - cli.test.ts: command with 3 invalid params → single thrown
          error names all 3 with their paths
        - cli.test.ts: command with 1 invalid param → message format
          matches single-error form (no plural "errors", no leading
          line)
        - sdk.test.ts / mcp.test.ts: parallel coverage
        - validate.test.ts: existing array-output tests stay green

      Renderer note: when the new multi-error UserError is rendered
      by cli.ts handleRunError, it should NOT prefix "error: " a
      second time — the body already says "N parameter errors".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-source-snippet-on-parse
    title: Source snippet with caret on config parse failures
    prompt: |
      Today a JSON / YAML parse failure prints the parser message
      and the file path. The user knows the file and the line but
      not the surrounding context. Borrow the rustc / elm / clojure
      pattern: render the offending source with a caret.

      Add a helper at packages/toolcraft/src/source-snippet.ts:

        export function renderSourceSnippet(opts: {
          source: string;
          line: number;       // 1-based
          column?: number;    // 1-based, optional
          context?: number;   // lines above and below; default 2
          filePath?: string;
        }): string;

      Output:

           |
        12 |   "name": "foo"
        13 |   "value": 42,
           |   ^ unexpected token; expected comma
        14 |   "active": true
           |

      ANSI: caret in red, line numbers in dim. Strip styling when
      stderr is not a TTY (use the same `text.muted` / `text.error`
      helpers from design-system; they already gate on isTTY).

      Wire into:

      1. Preset JSON parse (cli.ts:2103). The Node JSON.parse error
         carries `position` (and recent Node versions carry line/col
         via `.cause` on the SyntaxError). When position is available,
         compute line/column by scanning the source up to the offset.

      2. Fixture JSON parse (cli.ts:2464). Same approach.

      3. Lock file JSON parse (lock.ts:22, post the
         cause-chain task that promotes this from silent to error).

      4. OpenAPI YAML/JSON parse (spec-source.ts:67). The `yaml`
         package exposes `linePos` on YAMLParseError. Use directly.

      5. Generated config consumers: any defineCommand or defineGroup
         that reads a JSON config in a handler can adopt the helper —
         it lives in toolcraft, not in user code, but the export is
         public so consumers benefit.

      Tests in packages/toolcraft/src/source-snippet.test.ts:
        - line 1, column 5 → context line at top, caret aligned
        - line 100 in a 1000-line file → context is correct
        - column omitted → no caret line, just the source block
        - ANSI stripped when isTTY is false
        - caret aligned correctly with multi-digit line numbers
          (line 1 vs line 100 produce same caret column)
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-network-error-classify
    title: Classify low-level network errors before re-throwing
    prompt: |
      Today, fetch failures from the OpenAPI runtime bubble up with
      whatever message the platform produces — `fetch failed`,
      `ECONNREFUSED 127.0.0.1:8080`, `getaddrinfo ENOTFOUND api`,
      `The operation was aborted` — and the toolcraft handler shows
      them raw, often with no URL context.

      In packages/toolcraft-openapi/src/http.ts `requestJson`, wrap
      the `fetch(...)` call in a try/catch and translate `TypeError`
      / `AbortError` / Node `Error.code` into a `UserError` with a
      one-line classification:

        ECONNREFUSED  → "Connection refused: ${host}:${port}. Is the server running?"
        ETIMEDOUT     → "Request timed out after ${ms}ms: ${url}."
        ENOTFOUND     → "DNS lookup failed for ${host}. Check the URL or your network."
        ECONNRESET    → "Connection reset by ${host}. Likely transient — try again."
        EAI_AGAIN     → "Temporary DNS failure for ${host}. Network may be down."
        AbortError    → "Request aborted: ${url}." (keep, but include URL)
        TypeError "fetch failed" with no .cause → "Network request failed: ${url}." + (cause: error)
        Other         → re-throw unchanged

      Use Node 20+'s `Error.cause` chain when available (modern fetch
      sets `cause` to the underlying `Error` with `.code`).

      Surface the same classification on the spec fetch in
      spec-source.ts:41-49 — wrap with the same helper.

      Add a helper at packages/toolcraft-openapi/src/network-error.ts:

        export function classifyNetworkError(error: unknown, url: string): UserError | null;

      Returns null when the error doesn't match a known code, so the
      caller falls through to its existing handling.

      Tests in packages/toolcraft-openapi/src/network-error.test.ts:
        - synthetic TypeError("fetch failed") with cause = { code: "ECONNREFUSED", address: "127.0.0.1", port: 8080 }
          → returned message matches expected form
        - aborted fetch → message mentions abort and URL
        - unknown code → returns null
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-help-pointer-on-error
    title: Append a "Run X --help" pointer to errors that name a command
    prompt: |
      Mechanical UX win. Every error message that knows the command
      path can append one line:

        Run `${rootUsageName} ${commandPath} --help` for usage.

      Plumbing: `handleRunError` (cli.ts:3319) already runs at the
      runtime boundary where `state.commandPath` is in scope via the
      closure. Stash the resolved command path on a mutable variable
      in `runCLI` that `handleRunError` reads. When the error is a
      `UserError` AND the command path is known AND the error message
      doesn't already include the substring `--help`, append the
      pointer on a new line.

      Skip the pointer when:
        - error is CommanderError with `commander.helpDisplayed`
          (already inside help)
        - error is ApprovalDeclinedError (the user explicitly declined,
          not a usage problem)
        - command path is "" (root-level invocation; --help is the
          obvious next step anyway, but the existing "Unknown command"
          path from the did-you-mean task already does its own thing)

      Same plumbing for the `Missing required parameter` and
      `Unknown parameter` paths — those are the highest-leverage spots.

      Tests in cli.test.ts:
        - missing-param error includes the pointer line
        - command-not-found error includes the pointer (for the group
          context the user was in)
        - --help error itself does NOT include the pointer
        - approval-declined does NOT include the pointer
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-pretty-api-errors
    title: Pretty-print common API error formats in HTTP responses
    prompt: |
      The HTTP error renderer from `toolcraft-openapi-http-error-render`
      prints `response.body` either as a string or as
      `JSON.stringify(..., 2)`. For two formats this is wasteful — the
      structured form is the whole point.

      Add a recogniser at packages/toolcraft/src/cli.ts (next to the
      HttpError-like detector) for two shapes:

      1. RFC 7807 Problem Details
         (https://www.rfc-editor.org/rfc/rfc7807):

           { type?: string; title?: string; status?: number;
             detail?: string; instance?: string }

         At least `title` or `detail` must be a non-empty string.
         Render as:

           Problem: ${title}
           Detail:  ${detail}
           Type:    ${type}
           Instance: ${instance}
           Status:  ${status}

         Skip any field that's absent.

      2. GraphQL error envelope:

           { errors: Array<{ message: string; path?: (string|number)[];
                             extensions?: { code?: string; … } }> }

         Render as one block per error:

           GraphQL error: ${message}
             at path: ${path.join(".")}
             code:    ${extensions.code}

      Detection is strict — both recognisers require their signature
      fields present and well-typed. Anything else falls through to
      the existing JSON.stringify pretty-print.

      Recognition happens after JSON parsing in
      `parseResponseBody` (http.ts:177) is already producing a value;
      the recogniser runs in the toolcraft render path. No
      cross-package import — `toolcraft` does not import
      `toolcraft-openapi`.

      Tests in packages/toolcraft/src/cli.http-error.test.ts (from the
      earlier task):
        - body { title: "Bad Request", detail: "name too short" }
          → renders the Problem block
        - body { errors: [{ message: "Unauthorized", path: ["viewer"] }] }
          → renders the GraphQL block
        - body { foo: 1 } → falls through to JSON.stringify
        - body { title: "X", errors: [...] } (ambiguous; has both
          shapes) → Problem wins (it's the older, more standardised
          form and likely the deliberate one if both are present)
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-stack-trim
    title: Trim and source-map JS stacks when --debug prints them
    prompt: |
      When `--debug` prints a stack, the frames inside
      `node_modules/toolcraft*`, `node:internal/*`, and the
      `async/await` machinery dominate. The user's own code is at the
      bottom, off the visible terminal.

      In packages/toolcraft/src/cli.ts `handleRunError` (line 3340),
      pass the stack through a trimmer before writing:

        function trimStack(stack: string): string {
          const lines = stack.split("\n");
          const head = [lines[0]];   // error type + message
          const userFrames: string[] = [];
          const skippedFrames: string[] = [];
          for (const line of lines.slice(1)) {
            if (/\bnode_modules\/(toolcraft|toolcraft-openapi|toolcraft-schema|commander)\//.test(line)
                || /\bnode:internal\//.test(line)) {
              skippedFrames.push(line);
              continue;
            }
            userFrames.push(line);
          }
          if (skippedFrames.length === 0) return stack;
          return [
            ...head,
            ...userFrames,
            `    … (${skippedFrames.length} framework / runtime frame${skippedFrames.length === 1 ? "" : "s"} hidden — pass --debug=raw to show)`
          ].join("\n");
        }

      Extend the `--debug` flag to accept an optional value: `--debug`
      (default trim mode) and `--debug=raw` (skip the trimmer). Use
      Commander's optional-arg variant.

      Source maps: toolcraft already ships `.js.map` next to its
      built `.js`. Node 20+ supports `process.setSourceMapsEnabled(true)`
      and `--enable-source-maps`. Call `setSourceMapsEnabled(true)`
      from runCLI / runMCP / createSDK at startup. The trimmer can
      then point at .ts files for toolcraft frames — though, in trim
      mode those are skipped anyway. The benefit is the user's own
      stack frames map back to their .ts sources when the user's
      project also ships maps.

      Cause chains: when `error.cause` is set (Node 16.9+ surfaces it
      in `error.stack` as `[cause]: …`), the trimmer must apply to the
      cause portion too — split on `\n    at ` and the `[cause]:` marker.

      Tests in packages/toolcraft/src/stack-trim.test.ts:
        - synthetic stack with 2 user frames + 5 toolcraft frames →
          output keeps 2 user frames + summary line
        - stack with `[cause]: Error: inner` → cause portion is also
          trimmed; the header line "[cause]: Error: inner" is preserved
        - --debug=raw bypasses the trimmer
        - stack with no toolcraft frames → returned unchanged
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-error-report-capture
    title: Write a self-contained error report on failure
    prompt: |
      When a command fails non-trivially (any error path that isn't
      UserError-from-validation), write a self-contained report to
      `${projectRoot}/.toolcraft/errors/${isoTimestamp}-${commandPath || "root"}.log`
      and print a one-liner:

        Saved error report to .toolcraft/errors/2026-05-14T1812-widgets-create.log

      Report contents (plain text, no styling):
        - toolcraft version, node version, platform
        - argv (with secret values redacted using the same
          declared-secrets list the runtime already has)
        - resolved env vars from the command's `secrets` declaration,
          with values redacted (`POE_API_KEY=<set, 32 chars>` or
          `<unset>`)
        - command path
        - parsed params (sensitive params redacted — see below)
        - the error: name, message, structured fields
          (HttpError request+response, ToolcraftBugError stack)
        - full stack with cause chain
        - (when HttpError) the full HTTP transcript

      Sensitive-param redaction: a param is sensitive if its schema
      has `secret: true` (extend toolcraft-schema String / Number to
      support this — small addition). Otherwise the value is printed
      verbatim. Default-redact known names: `password`, `token`,
      `apiKey`, `secret` (case-insensitive substring match), but allow
      `secret: false` to opt out for false-positive names.

      Gate the feature on a flag — opt-in by default, since writing
      to disk on every failure is unwanted in CI. Add:
        - `errorReports?: boolean | { dir?: string }` on
          `RunCLIOptions` / equivalent for SDK and MCP runtimes.
        - Env override: `TOOLCRAFT_ERROR_REPORTS=1` enables. Useful for
          users without changing the source code of the CLI.

      When neither set, no report is written and no line is printed.

      Skip cases:
        - error is `UserError` AND no `cause` AND no HTTP context
          (these are routine "you typed it wrong" failures; a report
          would be noise)
        - error is `ApprovalDeclinedError`
        - error is CommanderError with help/version codes

      Path resolution: use the same `findProjectRoot` helper as the
      MCP proxy cache uses (mcp-proxy.ts:492). Fall back to `os.tmpdir()`
      if no package.json is found.

      Tests in packages/toolcraft/src/error-report.test.ts (in-memory
      fs):
        - HttpError-like with errorReports=true → file is written
          with all sections
        - UserError-only failure with errorReports=true → no file is
          written
        - errorReports default (undefined) → no file is written
        - TOOLCRAFT_ERROR_REPORTS=1 in env → file is written even
          without the option
        - secret params do not appear in the report file
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-error-ux-contract-snapshots
    title: Snapshot tests pin the error UX contract
    prompt: |
      The audit found 60+ error sites across three packages. Each
      preceding task adds tests for its own changes. This task adds
      a small set of integration snapshot tests so the overall
      contract is visible in one place and accidental regressions
      surface in review.

      Create packages/toolcraft/src/error-ux.contract.test.ts. For
      each error class below, run an end-to-end CLI invocation via
      the existing in-process runner used by cli.test.ts and snapshot
      the exact stderr:

        1. UserError thrown by handler → bare message, no debug hint
        2. Generic Error thrown by handler → message + debug hint
        3. ToolcraftBugError → bug-prefixed message + bug hint
        4. HttpError-like (synthetic) → request/status/snippet only
        5. HttpError-like with --verbose → full transcript
        6. HttpError-like with --debug → transcript + stack
        7. Missing required param → name + (when nested) discriminator
           context + available siblings
        8. Unknown param → name + Available: list
        9. Invalid JSON preset → path + parser message + cause
        10. ApprovalDeclinedError → reason or "Declined." fallback

      Each snapshot is one block of stderr text. Pin the format,
      not the styling — strip ANSI before snapshotting (reuse the
      ANSI helper from help-formatter-plain). This way style tweaks
      to design-system don't break the contract test.

      The point of this file is not coverage — the per-task tests
      cover the specific behaviour. It is a single visible artefact
      that says "this is what users see when toolcraft fails."

      Do not snapshot HttpError construction or transcript output
      from toolcraft-openapi — that package has its own http.test.ts
      coverage from earlier tasks. This file is the toolcraft-side
      consumer view only.
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-error-ux-terminal-pilot-qa
    title: Terminal-pilot QA covering every user-visible feature
    prompt: |
      Unit tests catch programmatic regressions; they do not catch
      "this looks bad on a real terminal" regressions. ANSI rendering,
      column wrapping, isTTY-gated styling, redaction, and the relative
      ordering of stdout / stderr / spinner output only show their
      true behaviour in an actual TTY. Build out terminal-pilot QA
      coverage for every user-visible feature in this plan.

      Deliver two artefacts:

      1. `packages/toolcraft/QA-error-ux-fixture/` — a minimal
         toolcraft consumer with `defineCommand`s that each trigger
         one error class from this plan. Mirrors the pattern in
         `packages/toolcraft/QA-help-output.md`'s example consumer
         (single file, only workspace packages, no ashby-mcp). Build
         step: `npm run build` from `packages/toolcraft`. Run shape:
         `node QA-error-ux-fixture/bin.js <command> [args]`.

         Commands the fixture exposes (one per error class):
           - throw-user-error              → UserError
           - throw-bug                     → ToolcraftBugError
           - throw-http-500                → HttpError-like (500, JSON body)
           - throw-http-401                → HttpError-like (401, JSON body)
           - throw-http-text-html-404      → HttpError-like (404, text/html body)
           - throw-http-problem-details    → HttpError-like with RFC 7807 body
           - throw-http-graphql            → HttpError-like with GraphQL errors body
           - throw-econnrefused            → simulated network error
           - throw-etimedout               → simulated timeout
           - throw-enotfound               → simulated DNS failure
           - throw-approval-declined       → ApprovalDeclinedError
           - bad-preset                    → command consuming an invalid preset
           - bad-fixture-json              → command consuming a corrupt fixture
           - validate-multi                → command with several params that
                                              all fail validation in one run
           - missing-secret                → command with a required env-var
                                              secret that is not set
           - missing-secret-near-miss      → same, but with a close-miss env
                                              var defined (POE_KEY when POE_API_KEY
                                              is required)
           - widgets group (with create, list, deactivate) → enables
             "Unknown command 'widgts'" and "--namee" did-you-mean cases
           - long-running                  → uses `progress(...)` then
                                              throws partway, exercises spinner
                                              ordering (note: spinner-aware
                                              rendering is deferred; QA
                                              still covers current behaviour)

         The fixture also exposes a `success` command that prints
         `"ok"` so verbose-on-success scenarios have something to
         compare against.

      2. `packages/toolcraft/QA-error-ux.md` — a markdown QA document.
         Same shape as QA-help-output.md / QA-human-in-loop.md /
         QA-mcp-proxy.md. Not a test runner — a checklist a human or
         a terminal-pilot-equipped agent executes.

      QA doc structure:

        # Error UX QA

        Top-of-file: how to run (build steps, env var setup, terminal
        width assumptions). Specify three widths to exercise: 60,
        100, 160 columns. Specify NO_COLOR off vs on as two ANSI
        regimes.

        For each user-visible feature in the plan, one section with:
          - **What it tests** — the task id from this plan, one line
          - **Setup** — env vars / cwd / extra files needed
          - **Terminal-pilot script** — concrete MCP calls:
              create_session(cwd, cols=N, rows=R)
              type("node QA-error-ux-fixture/bin.js throw-http-500\n")
              wait_for(pattern, timeout)
              read_screen()
          - **Acceptance** — bullet list of substrings, ordering
            rules, and visual checks
          - **Negative checks** — substrings that must NOT appear
            (e.g. no stack trace by default, no raw Authorization
            header, no `<string>` schema-kind token)

      Sections to write (one per user-visible feature; aligns with
      the implement-tasks above):

        1. HttpError default render (status, request, body snippet,
           verbose footer) — covers tasks
           toolcraft-openapi-http-error-context and
           toolcraft-openapi-http-error-render
        2. HttpError --verbose transcript (full headers + body, both
           request and response, redacted Authorization) — covers
           toolcraft-openapi-verbose-transcript
        3. HttpError --debug (transcript + trimmed stack) — covers
           both toolcraft-openapi-http-error-render and
           toolcraft-stack-trim
        4. Verbose / debug flags absent from --help — covers
           the visibility-gate in toolcraft-openapi-http-error-render
        5. Spec fetch failure (404 with HTML body, 500 with JSON
           problem) — covers toolcraft-openapi-spec-source-context
        6. ToolcraftBugError surfaces with bug banner, no raw stack
           — covers toolcraft-openapi-bug-errors-to-user-errors
        7. Validation error includes received value — covers
           toolcraft-validation-shows-received
        8. Unknown / reserved / missing X errors append "Available:"
           list — covers toolcraft-validation-lists-options
        9. Internal-jargon pass: `<string>`, `unwrappedSchema`,
           `state machine`, redundant "Error:" prefixes are gone —
           covers toolcraft-internal-jargon-pass
        10. Preset / lock / fixture parse errors show parser
            message + source snippet — covers
            toolcraft-cause-chain-on-parse-and-io and
            toolcraft-source-snippet-on-parse
        11. Union zero-match / multi-match enumerate branches —
            covers toolcraft-schema-union-context
        12. Did-you-mean for command / flag / enum / env-var typos
            — covers toolcraft-cli-did-you-mean
        13. Multi-error validation: one invocation, several invalid
            params, one combined error block — covers
            toolcraft-validation-batch
        14. Network classifier renders ECONNREFUSED / ENOTFOUND /
            ETIMEDOUT with URL context — covers
            toolcraft-network-error-classify
        15. "Run X --help" pointer appears on missing-param /
            unknown-param / unknown-command — covers
            toolcraft-help-pointer-on-error
        16. Problem Details and GraphQL bodies render structurally
            — covers toolcraft-pretty-api-errors
        17. Error report capture writes a usable log file under
            `.toolcraft/errors/` and prints the path — covers
            toolcraft-error-report-capture

      Each section ends with the explicit ANSI regime to run under
      (TTY + colour, TTY + NO_COLOR=1, isTTY=false via piping to
      cat — terminal-pilot can do all three by varying the
      create_session args and following the command with ` | cat`
      where appropriate).

      Acceptance for the QA doc itself:
        - Every task in the pipeline whose change is user-visible
          has at least one section in the QA doc. The unit-test-only
          tasks (toolcraft-openapi-http-error-context structural
          refactor, toolcraft-error-ux-contract-snapshots) do NOT
          need their own section — they are covered transitively by
          the sections of the tasks that surface their behaviour.
        - Each section has explicit terminal-pilot MCP calls, not
          prose like "run the command". A QA-running agent must be
          able to execute the script verbatim.
        - The acceptance bullets quote the literal substrings that
          must appear, in render order. Do NOT use phrases like
          "the error is rendered nicely" — pin the actual text so
          the QA fails when the renderer changes.

      Do NOT bake the QA into CI. It is human / agent-executed,
      consistent with the project rule "QA is not a script, it's a
      plan in markdown".

      Run-the-QA acceptance for THIS task: actually execute the QA
      doc once end-to-end using terminal-pilot before marking the
      task complete. Any acceptance bullet that fails is a real bug
      in one of the preceding tasks — fix it there, do not weaken
      the bullet.
    status:
      implement: open
      test: open
      commit: open
---

## Toolcraft error UX overhaul

Every error message toolcraft prints is read by someone who is stuck. The message has to do three jobs in one or two lines: name what failed, show what was actually there, and point at the next move. Today most messages do one of those, a few do two, none reliably do all three.

The trigger case: an OpenAPI-driven command hits a 500. `--verbose` prints `POST https://…/widgets` before the fetch and nothing after. The thrown `HttpError` only carries `status` and `body`; the CLI sees it as a generic `Error` and prints `HTTP 500. Use --debug for a stack trace.` `--debug` adds a JavaScript stack that lives entirely inside `toolcraft-openapi`'s `requestJson`. The user has every piece of information about their own code and nothing about the request that failed. That single class of bug repeats across spec fetches, OpenAPI parse failures, file IO, JSON parses, and dozens of validation sites.

This plan reshapes the error contract across `toolcraft`, `toolcraft-openapi`, and `toolcraft-schema`. It does not invent a new error framework — it keeps `UserError` as the user-facing class, keeps the `handleRunError` chain in `cli.ts`, and adds three things on top: structured `HttpError` carrying request and response, a `ToolcraftBugError` class so internal invariants stop crashing as raw stacks, and a `--verbose` flag at the toolcraft level so HTTP transcripts and similar runtime detail have a home that isn't `--debug`.

## North star

Every error answers three questions:

1. **What failed.** The operation, named in the user's vocabulary — command path, parameter name, file path, request URL. Not internal symbols (`unwrappedSchema`, `state machine`) and not redundant prefixes (`Error: Error: …`).
2. **What was actually there.** The received value for validation errors. The response body and status for HTTP errors. The parser line for JSON / YAML errors. The available alternatives for "Unknown X" errors.
3. **What to do next.** A concrete next move — set this env var, run this command, edit this file. When the answer is "file a bug", say so plainly and route the user to `--debug` for the stack.

## Testing methodology

Every user-visible feature in this plan is verified at three layers:

1. **Per-task unit tests** — the `Tests:` block at the end of each task. Fast, mocked stdio, asserts on substrings or structured fields. Pins behaviour.
2. **Contract snapshots** — one consolidated test file (`toolcraft-error-ux-contract-snapshots`) renders every error class through the in-process CLI runner with ANSI stripped, so a single diff surfaces any change to the user-visible text.
3. **Terminal-pilot QA** — one consolidated markdown plan (`toolcraft-error-ux-terminal-pilot-qa`) drives a real PTY through the `terminal-pilot` MCP. Each section creates a session, types a command into a fixture binary that intentionally trips one error class, reads the screen, and asserts on the literal substrings + their ordering. Runs at three terminal widths (60 / 100 / 160 columns) and three ANSI regimes (TTY+colour, TTY+`NO_COLOR=1`, piped-to-cat for `isTTY=false`). The terminal-pilot QA is the only layer that catches column wrapping, spinner-line ordering, ANSI escape leakage, and how the error block sits next to whatever the command already wrote to stdout.

Tasks whose change is purely structural (the HttpError class shape; the snapshot file itself) do not get their own terminal-pilot section — they are exercised transitively by the user-visible tasks that consume them.

## Trigger case: HTTP server-side failure

Today:

```text
$ my-tool widgets create --name=foo
HTTP 500. Use --debug for a stack trace.
```

```text
$ my-tool widgets create --name=foo --debug
HTTP 500
    at requestJson (.../toolcraft-openapi/dist/http.js:62:17)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async Object.handler (.../generated/widgets/create.js:14:3)
    at async runCommand (.../toolcraft/dist/cli.js:2934:23)
    …
```

Target, default mode:

```text
$ my-tool widgets create --name=foo
Request:  POST https://api.example.com/v1/widgets
Status:   500 Internal Server Error
Body:     {"error":"internal_panic","trace_id":"8f3c…"}…

Re-run with --verbose to see headers and full body.
```

Target, `--verbose`:

```text
$ my-tool widgets create --name=foo --verbose
→ POST https://api.example.com/v1/widgets
    Authorization: Bearer ****
    Content-Type: application/json
    {"name":"foo"}
← 500 Internal Server Error
    content-type: application/json
    x-request-id: 8f3c-9af2-…
    {
      "error": "internal_panic",
      "trace_id": "8f3c-9af2-…"
    }

Request:  POST https://api.example.com/v1/widgets
Status:   500 Internal Server Error
Response headers:
  content-type: application/json
  x-request-id: 8f3c-9af2-…
Response body:
  {
    "error": "internal_panic",
    "trace_id": "8f3c-9af2-…"
  }
```

Target, `--debug` (rare): everything above plus the stack at the bottom.

## Audit, by site

The categories below are exhaustive of the audit. Each task in the pipeline addresses one row (or a tight cluster of rows).

### packages/toolcraft-openapi/src

| Site | Today | Gap |
|------|-------|-----|
| [http.ts:30-36](packages/toolcraft-openapi/src/http.ts#L30) `HttpError` class | stores `status`, `body`, default message `HTTP ${status}` | drops method, URL, statusText, request body, response headers |
| [http.ts:51-53](packages/toolcraft-openapi/src/http.ts#L51) verbose request log | one line, before fetch | no response logging on success or failure |
| [http.ts:76-83](packages/toolcraft-openapi/src/http.ts#L76) wrong content-type | throws `HttpError(status, text, "Expected JSON…")` | no response headers, no request context |
| [http.ts:92](packages/toolcraft-openapi/src/http.ts#L92) error throw | passes only `status` + parsed body | request and response headers discarded |
| [http.ts:120](packages/toolcraft-openapi/src/http.ts#L120) `Missing path parameter "${key}".` | adequate | could list which keys are provided |
| [http.ts:127](packages/toolcraft-openapi/src/http.ts#L127) `Invalid path template "${path}".` | adequate | doesn't show the unmatched brace position |
| [spec-source.ts:30](packages/toolcraft-openapi/src/spec-source.ts#L30) `Unsupported OpenAPI input` | adequate | |
| [spec-source.ts:38](packages/toolcraft-openapi/src/spec-source.ts#L38) protocol guard | adequate | |
| [spec-source.ts:44](packages/toolcraft-openapi/src/spec-source.ts#L44) fetch !ok | status + statusText only | no response body, no content-type |
| [spec-source.ts:55-57](packages/toolcraft-openapi/src/spec-source.ts#L55) catch-all wrap | includes `getErrorMessage(error)` | template for the http.ts fix |
| [spec-source.ts:67-69](packages/toolcraft-openapi/src/spec-source.ts#L67) YAML parse | passes underlying message | YAML's `linePos` is available; not surfaced |
| [bin/generate.ts:106-112](packages/toolcraft-openapi/src/bin/generate.ts#L106) error handler | catches `UserError` only | plain `Error` (including pre-fix `HttpError`) crashes with stack |
| [bin/generate.ts:171](packages/toolcraft-openapi/src/bin/generate.ts#L171) `Missing value for ${arg}.` | adequate | |
| [bin/generate.ts:194](packages/toolcraft-openapi/src/bin/generate.ts#L194) `Unknown argument ${arg}.` | adequate | could list valid flags |
| [define-client.ts:128](packages/toolcraft-openapi/src/define-client.ts#L128) `Bug: merged command node is missing source metadata.` | plain `Error` | crashes with stack |
| [define-client.ts:134-141](packages/toolcraft-openapi/src/define-client.ts#L134) duplicate command path | adequate | |
| [generate.ts plain Error sites](packages/toolcraft-openapi/src/generate.ts) | several `throw new Error(...)` | crashes with stack |
| [mock/fetch.ts:96-155](packages/toolcraft-openapi/src/mock/fetch.ts#L96) `MockFetchError` throws | extends `Error` | crashes with stack when uncaught |
| [mock/fetch.ts:193](packages/toolcraft-openapi/src/mock/fetch.ts#L193) missing paths object | adequate | |
| [mock/fetch.ts:432, 443](packages/toolcraft-openapi/src/mock/fetch.ts#L432) `$ref` errors | adequate / vague | line 443 doesn't say why resolution failed |
| [mock/fetch.ts:720-724](packages/toolcraft-openapi/src/mock/fetch.ts#L720) unknown fixture keys | excellent | template for "Available: …" pattern |
| [naming.ts:38-91](packages/toolcraft-openapi/src/naming.ts#L38) operationId / tags | adequate | |
| [lock.ts:22](packages/toolcraft-openapi/src/lock.ts#L22) JSON parse | silent | corrupt lock proceeds as no-lock |
| [lock.ts:56](packages/toolcraft-openapi/src/lock.ts#L56) write error | path missing | |
| [auth/bearer-token-auth.ts:190](packages/toolcraft-openapi/src/auth/bearer-token-auth.ts#L190) missing token | mentions login command | could name env var, keychain entry, file path tried |

### packages/toolcraft/src

| Site | Today | Gap |
|------|-------|-----|
| [cli.ts:343](packages/toolcraft/src/cli.ts#L343) synthetic enum invariant | plain `Error` | should be `ToolcraftBugError` |
| [cli.ts:610-622](packages/toolcraft/src/cli.ts#L610) positional declaration errors | adequate | |
| [cli.ts:640](packages/toolcraft/src/cli.ts#L640) reserved flag | adequate (suggests rename) | |
| [cli.ts:676](packages/toolcraft/src/cli.ts#L676) boolean parse | `Expected true or false` | no received value |
| [cli.ts:687](packages/toolcraft/src/cli.ts#L687) enum parse | lists expected | no received value |
| [cli.ts:705](packages/toolcraft/src/cli.ts#L705) pattern mismatch | adequate | |
| [cli.ts:721](packages/toolcraft/src/cli.ts#L721) JSON parse | `Expected valid JSON.` | drops parser message |
| [cli.ts:745](packages/toolcraft/src/cli.ts#L745) number constraint | adequate | |
| [cli.ts:759, 2714, 2883](packages/toolcraft/src/cli.ts#L759) "Unsupported … schema kind" | mentions `unwrappedSchema` | internal jargon |
| [cli.ts:797](packages/toolcraft/src/cli.ts#L797) array items | no found type | |
| [cli.ts:1843..3292](packages/toolcraft/src/cli.ts#L1843) `Operation cancelled.` | five copies | no context |
| [cli.ts:1877, 2856, 3049, 3062, 3098, 3154, 3187](packages/toolcraft/src/cli.ts#L1877) `Missing required parameter "${name}".` | repeated | no type hint, no source hint (flag / env / positional) |
| [cli.ts:2090-2131](packages/toolcraft/src/cli.ts#L2090) preset errors | mixed quality | JSON parse drops cause; unknown-param drops valid list |
| [cli.ts:2354..2464](packages/toolcraft/src/cli.ts#L2354) fixture errors | mixed | `String(entry.error)` is opaque; missing scenario list |
| [cli.ts:2570](packages/toolcraft/src/cli.ts#L2570) reserved service name | no list of reserved names | |
| [cli.ts:2737, 2776](packages/toolcraft/src/cli.ts#L2737) unknown nested parameter | no available list | |
| [cli.ts:2761, 2813, 2818](packages/toolcraft/src/cli.ts#L2761) array indexing | no example of the bad shape | |
| [cli.ts:2922-3024](packages/toolcraft/src/cli.ts#L2922) discriminated union | mixed; 2998 is excellent (lists branch values) | unknown-param inside a branch doesn't name the branch |
| [cli.ts:3319-3344](packages/toolcraft/src/cli.ts#L3319) `handleRunError` | UserError / CommanderError / generic | no HttpError or ToolcraftBugError branch |
| [index.ts:561-619](packages/toolcraft/src/index.ts#L561) requires / secrets | adequate but every message starts with redundant `Error:` | |
| [index.ts:619](packages/toolcraft/src/index.ts#L619) precondition fallback | `Command precondition failed.` | no context |
| [index.ts:788, 793](packages/toolcraft/src/index.ts#L788) default-child guards | plain Error → bug | |
| [mcp.ts:312](packages/toolcraft/src/mcp.ts#L312) "Bug: command must define object params" | plain Error | bug |
| [mcp.ts:397-493](packages/toolcraft/src/mcp.ts#L397) MCP input validation | parallel to sdk.ts | no received value, no available list |
| [mcp.ts:645](packages/toolcraft/src/mcp.ts#L645) missing MCP version | tells user to do the impossible | |
| [sdk.ts:298-414](packages/toolcraft/src/sdk.ts#L298) SDK input validation | mirror of mcp.ts | same gaps |
| [sdk.ts:480](packages/toolcraft/src/sdk.ts#L480) "Bug: command must define object params" | plain Error | bug |
| [sdk.ts:555](packages/toolcraft/src/sdk.ts#L555) non-callable SDK member | adequate | |
| [human-in-loop/approval-tasks.ts:32, 41](packages/toolcraft/src/human-in-loop/approval-tasks.ts#L32) async config / state-machine | internal jargon | |
| [human-in-loop/approvals-commands.ts:100](packages/toolcraft/src/human-in-loop/approvals-commands.ts#L100) reserved "approvals" | redundant `Error:` prefix | |
| [human-in-loop/config.ts:18-30](packages/toolcraft/src/human-in-loop/config.ts#L18) config validation | adequate | |
| [human-in-loop/default-provider.ts:10](packages/toolcraft/src/human-in-loop/default-provider.ts#L10) no provider | internal property name | |
| [human-in-loop/gate.ts:70](packages/toolcraft/src/human-in-loop/gate.ts#L70) `ApprovalDeclinedError` | bare `Declined.` when no reason | could include task id, command path |
| [human-in-loop/runner.ts:96-154](packages/toolcraft/src/human-in-loop/runner.ts#L96) `Malformed approval metadata` / `Unknown approval command path` | three duplicate copies / no available list | |
| [mcp-proxy.ts:140](packages/toolcraft/src/mcp-proxy.ts#L140) upstream input schema | bug | |
| [mcp-proxy.ts:197, 363, 379, 386, 448, 492](packages/toolcraft/src/mcp-proxy.ts#L197) discovery / collision / cache | mixed; collision messages don't name the colliding source | |
| [json-schema-converter.ts](packages/toolcraft/src/json-schema-converter.ts) seven sites | JSON Schema jargon (`items`, `composition`, `$ref`, `branch`) | rewrite per the internal-jargon-pass task |

### packages/toolcraft-schema/src

| Site | Today | Gap |
|------|-------|-----|
| [index.ts:254, 260](packages/toolcraft-schema/src/index.ts#L254) enum constraints | adequate / no duplicate list | |
| [union.ts:24, 33](packages/toolcraft-schema/src/union.ts#L24) union constraints | adequate / no offending indices | |
| [oneof.ts:22](packages/toolcraft-schema/src/oneof.ts#L22) empty branches | adequate | |
| [validate.ts type errors](packages/toolcraft-schema/src/validate.ts) | `received` field carries the type; the `message` field doesn't reference it | redundant `Expected X at path` |
| [validate.ts:228-246](packages/toolcraft-schema/src/validate.ts#L228) array min/max | "at most 1 items" | grammar |
| [validate.ts:323-330](packages/toolcraft-schema/src/validate.ts#L323) oneof discriminator | adequate (lists valid) | doesn't name the received value when missing |
| [validate.ts:368-374](packages/toolcraft-schema/src/validate.ts#L368) union no-match / multi-match | opaque count only | no branch list, no fingerprint |
| [validate.ts:417-418](packages/toolcraft-schema/src/validate.ts#L417) JSON value | doesn't pinpoint the non-serialisable field | |

## Twenty more improvements (explored)

Beyond the trigger case and the systematic vetting in the tasks above, twenty further ideas. Eight are folded into the pipeline as tasks (marked **→ task**); twelve are documented here with rationale for why they're held back.

*Discovery and recovery —*

1. **Did-you-mean for command names** — Levenshtein over sibling group children when commander emits `unknownCommand`. **→ task** `toolcraft-cli-did-you-mean`.
2. **Did-you-mean for flag names** — same algorithm over registered long flags. **→ task** (same).
3. **Did-you-mean for enum values** — when a known-enum param is given a close miss. **→ task** (same).
4. **Did-you-mean for env-var names** — scan `process.env` for close matches when a required secret is missing. **→ task** (same).

*Reporting density —*

5. **Collect-and-report validation** — show every invalid param at once, not one at a time. **→ task** `toolcraft-validation-batch`.
6. **Stable error codes (TC001, TCO042, TCS017)** — pin each `UserError` subclass to a string code; print it bracketed in the message; add a built-in `explain <code>` group that prints long-form docs. *Deferred*: requires a code registry, doc routing, and per-error long-form copy — half a day of pure prose. Worth doing after the structural tasks land, when the message text has settled. Once codes exist, "Did you mean a different code?" becomes a useful follow-up.
7. **Doc URLs on common errors** — append `(see https://…/errors/TC042)` to the bracketed code. *Deferred*: requires a docs site we don't have yet.

*Source context —*

8. **Source snippet with caret** — for JSON/YAML/preset/lock parse failures, render ±2 lines with a caret. **→ task** `toolcraft-source-snippet-on-parse`.
9. **Argv echo with error marker** — on CLI parse failure, echo the full argv on one line with `^^^` under the offending token. *Deferred*: commander parses argv in passes, so reconstructing the token position is fiddly. The did-you-mean task covers most of the same ground; revisit if users still report confusion.

*Network and transport —*

10. **Network error classifier** — translate ECONNREFUSED / ENOTFOUND / etc. into human messages with the URL. **→ task** `toolcraft-network-error-classify`.
11. **Transient-error hint** — on 5xx and ECONNRESET, suggest "this looks transient" and offer a `--retry` flag. *Deferred*: the retry flag itself is a new feature with its own surface (max attempts, backoff, idempotency awareness). Land the classification first; retry is a follow-up plan.
12. **Pretty-print Problem Details (RFC 7807) and GraphQL error envelopes** — recognise the two most common API error shapes and render them structurally instead of as raw JSON. **→ task** `toolcraft-pretty-api-errors`.
13. **Request-ID surfacing** — when `x-request-id` / `x-correlation-id` / `traceparent` is present on a failed response, lift it to the top of the error block ("When reporting, quote x-request-id: …"). *Deferred*: covered by the verbose transcript (headers are visible); a dedicated lift is polish for the truncated default-mode view. One-line code change once the HttpError render task lands; can fold in then.

*Stack trace quality —*

14. **Stack trimming + source maps** — drop framework frames in `--debug`; enable source maps so user frames point at `.ts`. **→ task** `toolcraft-stack-trim`.
15. **Last-action breadcrumb** — toolcraft tracks the last user-observable step ("Reading spec from X", "Fetching token from keychain Y") and prepends it to any error: `Failed while: {last action}`. *Deferred*: requires threading an action-trace context through the runtime; nontrivial because handlers run user code that can do anything. Useful for hard cases but expensive to plumb correctly. Revisit after the structural tasks land.

*Self-help —*

16. **"Run X --help" pointer** — every error message that knows the command path appends the suggestion. **→ task** `toolcraft-help-pointer-on-error`.
17. **Auth-status quick-check on 401/403** — automatically run the auth provider's status check and inline the result in the error block. *Deferred*: requires the runtime to know about the auth provider (which today lives in toolcraft-openapi or in user code as a service). Land an explicit hook (`errorContext?: (error) => Promise<string>`) on `defineCommand` first; auth-status then becomes one user of that hook.

*Reproducibility —*

18. **Error report capture** — write a self-contained `.toolcraft/errors/{timestamp}.log` with argv, env, params, transcript, and stack for any non-trivial failure. **→ task** `toolcraft-error-report-capture`.
19. **Replay** — `toolcraft replay {log}` re-executes from a captured report. *Deferred*: depends on the error-report task and on every command being deterministic enough to replay (env-coupled, time-coupled, network-coupled commands all need policy). Useful for support workflows; large surface; not now.

*Visual —*

20. **Spinner-aware error rendering** — when a command is mid-`progress(...)`, the spinner line gets cleared (not appended after) before the error block renders. *Deferred*: requires coordination with the design-system spinner / progress primitives; the right place is in `progress` itself, not in `handleRunError`. Track as a design-system follow-up.

## Out of scope

- A new error framework. `UserError` stays; only `ToolcraftBugError` is added.
- Replacing the design-system styling layer. Error rendering uses the existing `text.*` helpers.
- Changing the JSON / MCP transport-level error envelope (`ToolError` codes). Only the `message` content improves.
- Localising error messages. Strings stay English.
- Reformatting `--help` output. The help work landed in plan 22.
- Per-package release sequencing. The release step lives in whatever commit cuts these changes — not in this plan.
