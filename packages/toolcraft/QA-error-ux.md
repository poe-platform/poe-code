# Error UX QA

This is a manual QA walkthrough for Toolcraft error rendering. It is not a test runner and must not be wired into CI.

Run from `packages/toolcraft`:

```sh
npm run build
unset POE_API_KEY
export POE_KEY=near-miss-token
```

Fixture command shape:

```sh
node QA-error-ux-fixture/bin.js <command> [args]
```

Exercise every section at 60, 100, and 160 columns by repeating the listed terminal automation script with `cols=60`, `cols=100`, and `cols=160`. Use `rows=40` unless a section asks for more. Run each section under these ANSI regimes: TTY + colour, TTY + `NO_COLOR=1`, and isTTY=false by appending `2>&1 | cat` to the command in the same terminal session. For colour runs, leave `NO_COLOR` unset.

## 1. HttpError Default Render

**What it tests** — `toolcraft-openapi-http-error-context`, `toolcraft-openapi-http-error-render`

**Setup** — `cwd=$REPO/packages/toolcraft`; `NO_COLOR` unset for the first pass.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=40)
type("node QA-error-ux-fixture/bin.js throw-http-500\n")
wait_for(pattern="Re-run with --verbose", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `Saved error report to .toolcraft/errors/`
- In order: `Request:  GET https://api.example.test/v1/widgets/42`
- In order: `Status:   500 Internal Server Error`
- In order: `Response body: { "error": "internal_panic", "trace_id": "qa-trace-500"`
- In order: `Re-run with --verbose to see headers and full body.`
- Visual check: at 60 columns the response snippet wraps without clipping or overwriting the status line.

**Negative checks**

- Must not contain `HttpError: GET`
- Must not contain `authorization:`
- Must not contain `Bearer qa-secret-token`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and `node QA-error-ux-fixture/bin.js throw-http-500 2>&1 | cat`.

## 2. HttpError Verbose Transcript

**What it tests** — `toolcraft-openapi-verbose-transcript`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=50)
type("node QA-error-ux-fixture/bin.js throw-http-500 --verbose\n")
wait_for(pattern="Response body:", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `Request:  GET https://api.example.test/v1/widgets/42`
- In order: `Request headers:`
- In order: `authorization: Bearer ****`
- In order: `x-client: toolcraft-error-ux-fixture`
- In order: `Request body:`
- In order: `"name": "qa-widget"`
- In order: `Status:   500 Internal Server Error`
- In order: `Response headers:`
- In order: `content-type: application/json`
- In order: `x-request-id: qa-request-123`
- In order: `"message": "The upstream service failed while rendering a widget."`

**Negative checks**

- Must not contain `Bearer qa-secret-token`
- Must not contain `Use --debug for a stack trace`
- Must not contain `HttpError: GET`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and `node QA-error-ux-fixture/bin.js throw-http-500 --verbose 2>&1 | cat`.

## 3. HttpError Debug

**What it tests** — `toolcraft-openapi-http-error-render`, `toolcraft-stack-trim`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=60)
type("node QA-error-ux-fixture/bin.js throw-http-500 --debug\n")
wait_for(pattern="framework / runtime frame hidden", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `Request headers:`
- In order: `authorization: Bearer ****`
- In order: `Request body:`
- In order: `"name": "qa-widget"`
- In order: `Response body:`
- In order: `HttpError: GET https://api.example.test/v1/widgets/42 -> 500 Internal Server Error`
- In order: `at fixtureHandler`
- In order: `framework / runtime frame hidden`

**Negative checks**

- Must not contain `Bearer qa-secret-token`
- Must not contain `node:internal/process/task_queues`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and `node QA-error-ux-fixture/bin.js throw-http-500 --debug 2>&1 | cat`.

## 4. Verbose And Debug Hidden From Help

**What it tests** — visibility gate in `toolcraft-openapi-http-error-render`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=40)
type("node QA-error-ux-fixture/bin.js throw-http-500 --help\n")
wait_for(pattern="Usage:", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `toolcraft-error-ux throw-http-500 — Throw an HTTP 500 error with a JSON body.`
- In order: `Usage: node QA-error-ux-fixture/bin.js throw-http-500 [OPTIONS]`

**Negative checks**

- Must not contain `--verbose`
- Must not contain `--debug`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and `node QA-error-ux-fixture/bin.js throw-http-500 --help 2>&1 | cat`.

## 5. Spec Fetch Failure

**What it tests** — `toolcraft-openapi-spec-source-context`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=40)
type("node QA-error-ux-fixture/bin.js throw-http-text-html-404\n")
wait_for(pattern="No OpenAPI document exists here", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js throw-http-500\n")
wait_for(pattern="qa-trace-500", timeout=5000)
read_screen()
```

**Acceptance**

- For 404, in order: `Request:  GET https://api.example.test/openapi.json`
- For 404, in order: `Status:   404 Not Found`
- For 404, in order: `Response body: <!doctype html><html><body><h1>Not Found</h1>`
- For 500, in order: `Status:   500 Internal Server Error`
- For 500, in order: `"trace_id": "qa-trace-500"`

**Negative checks**

- Must not contain `undefined undefined`
- Must not contain `Bearer qa-secret-token`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to both commands.

## 6. ToolcraftBugError Banner

**What it tests** — `toolcraft-openapi-bug-errors-to-user-errors`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=40)
type("node QA-error-ux-fixture/bin.js throw-bug\n")
wait_for(pattern="toolcraft hit an internal invariant", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `Saved error report to .toolcraft/errors/`
- In order: `toolcraft hit an internal invariant: command registry invariant failed.`
- In order: `This is a bug in toolcraft or in the command definition`
- In order: `Re-run with --debug for a stack trace and file an issue.`

**Negative checks**

- Must not contain `ToolcraftBugError:`
- Must not contain `at fixtureHandler`
- Must not contain `node:internal`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and `node QA-error-ux-fixture/bin.js throw-bug 2>&1 | cat`.

## 7. Validation Error Includes Received Value

**What it tests** — `toolcraft-validation-shows-received`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=40)
type("node QA-error-ux-fixture/bin.js validate-multi --slug Bad-Value --owner-email ok@example.com --mode safe --yes\n")
wait_for(pattern="Bad-Value", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `Invalid value for "slug": "Bad-Value" does not match pattern "^[a-z]+$".`
- In order: `Run node QA-error-ux-fixture/bin.js validate-multi --help for usage.`

**Negative checks**

- Must not contain `<string>`
- Must not contain `unwrappedSchema`
- Must not contain `Error: Error:`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat`.

## 8. Available Lists

**What it tests** — `toolcraft-validation-lists-options`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=50)
type("node QA-error-ux-fixture/bin.js union-zero-match --contact-kind email --contact.phone 123 --yes\n")
wait_for(pattern="Available: contact.email", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js widgets create --name demo --tier bad --yes\n")
wait_for(pattern="Expected one of: free, pro, enterprise", timeout=5000)
read_screen()
```

**Acceptance**

- For unknown branch field, in order: `Unknown parameter "contact.phone" for contact-kind="email". Available: contact.email.`
- For enum, in order: `Invalid value for "tier".`
- For enum, in order: `Expected one of: free, pro, enterprise, got "bad".`

**Negative checks**

- Must not contain `unwrappedSchema`
- Must not contain `state machine`
- Must not contain `<string>`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to both commands.

## 9. Internal Jargon Pass

**What it tests** — `toolcraft-internal-jargon-pass`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=60)
type("node QA-error-ux-fixture/bin.js validate-multi --slug Bad-Value --owner-email nope --mode slow --yes\n")
wait_for(pattern="3 parameter errors:", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `3 parameter errors:`
- In order: `slug: Invalid value for "slug": "Bad-Value"`
- In order: `ownerEmail: Invalid value for "ownerEmail": "nope"`
- In order: `mode: Invalid value for "mode". Expected one of: safe, fast, got "slow".`

**Negative checks**

- Must not contain `<string>`
- Must not contain `unwrappedSchema`
- Must not contain `state machine`
- Must not contain `Error: Error:`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat`.

## 10. Preset And Fixture Parse Errors

**What it tests** — `toolcraft-cause-chain-on-parse-and-io`, `toolcraft-source-snippet-on-parse`

**Setup** — `cwd=$REPO/packages/toolcraft`; fixture startup writes `QA-error-ux-fixture/bad-preset.json` and `QA-error-ux-fixture/bin.fixture.json`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=70)
type("node QA-error-ux-fixture/bin.js bad-preset --preset QA-error-ux-fixture/bad-preset.json --yes\n")
wait_for(pattern="bad-preset.json:2:1", timeout=5000)
read_screen()
type("TOOLCRAFT_FIXTURE='first scenario' node QA-error-ux-fixture/bin.js bad-fixture-json --yes\n")
wait_for(pattern="bin.fixture.json:2:1", timeout=5000)
read_screen()
```

**Acceptance**

- For preset, in order: `Preset file "QA-error-ux-fixture/bad-preset.json" is not valid JSON`
- For preset, in order: `--> QA-error-ux-fixture/bad-preset.json:2:1`
- For preset, in order: `1 | {`
- For preset, in order: `2 | ,`
- For preset, in order: `| ^`
- For fixture, in order: `Fixture file $REPO/packages/toolcraft/QA-error-ux-fixture/bin.fixture.json is not valid JSON`
- For fixture, in order: `--> $REPO/packages/toolcraft/QA-error-ux-fixture/bin.fixture.json:2:1`
- For fixture, in order: `2 | ,`

**Negative checks**

- Must not contain `SyntaxError:`
- Must not contain `at JSON.parse`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to both commands.

## 11. Union Branch Context

**What it tests** — `toolcraft-schema-union-context`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=50)
type("node QA-error-ux-fixture/bin.js union-zero-match --contact-kind fax --yes\n")
wait_for(pattern="Expected one of: email, phone", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js union-zero-match --contact-kind email --contact.phone 123 --yes\n")
wait_for(pattern="Available: contact.email", timeout=5000)
read_screen()
```

**Acceptance**

- Zero-match, in order: `2 parameter errors:`
- Zero-match, in order: `contact-kind: Invalid value for "contact-kind". Expected one of: email, phone, got "fax".`
- Multi-branch mismatch, in order: `Unknown parameter "contact.phone" for contact-kind="email". Available: contact.email.`

**Negative checks**

- Must not contain `unwrappedSchema`
- Must not contain `<string>`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to both commands.

## 12. Did You Mean

**What it tests** — `toolcraft-cli-did-you-mean`

**Setup** — `cwd=$REPO/packages/toolcraft`; `POE_KEY=near-miss-token`; `POE_API_KEY` unset.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=70)
type("node QA-error-ux-fixture/bin.js widgts\n")
wait_for(pattern="Did you mean: widgets?", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js widgets create --namee demo --yes\n")
wait_for(pattern="Did you mean: --name?", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js widgets create --name demo --tier prp --yes\n")
wait_for(pattern="Did you mean: pro?", timeout=5000)
read_screen()
type("env -u POE_API_KEY POE_KEY=near-miss-token node QA-error-ux-fixture/bin.js missing-secret-near-miss\n")
wait_for(pattern="Did you mean: POE_KEY?", timeout=5000)
read_screen()
```

**Acceptance**

- Command typo, in order: `Unknown command "widgts".`
- Command typo, in order: `Did you mean: widgets?`
- Flag typo, in order: `Unknown option "--namee".`
- Flag typo, in order: `Did you mean: --name?`
- Enum typo, in order: `Invalid value for "tier". Did you mean: pro?`
- Env typo, in order: `Missing required secret POE_API_KEY`
- Env typo, in order: `Did you mean: POE_KEY?`

**Negative checks**

- Must not contain `POE_KEY=near-miss-token`
- Must not contain `Bearer`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to each command.

## 13. Multi-Error Validation

**What it tests** — `toolcraft-validation-batch`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=50)
type("node QA-error-ux-fixture/bin.js validate-multi --slug Bad-Value --owner-email nope --mode slow --yes\n")
wait_for(pattern="3 parameter errors:", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `3 parameter errors:`
- In order: `- slug: Invalid value for "slug": "Bad-Value" does not match pattern "^[a-z]+$".`
- In order: `- ownerEmail: Invalid value for "ownerEmail": "nope" does not match pattern "^[^@]+@[^@]+$".`
- In order: `- mode: Invalid value for "mode". Expected one of: safe, fast, got "slow".`
- In order: `Run node QA-error-ux-fixture/bin.js validate-multi --help for usage.`

**Negative checks**

- Must not contain a second separate block beginning with `Invalid value for "ownerEmail"` before `3 parameter errors:`
- Must not contain `Error:`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat`.

## 14. Network Classifier

**What it tests** — `toolcraft-network-error-classify`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=60)
type("node QA-error-ux-fixture/bin.js throw-econnrefused\n")
wait_for(pattern="ECONNREFUSED", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js throw-enotfound\n")
wait_for(pattern="ENOTFOUND", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js throw-etimedout\n")
wait_for(pattern="ETIMEDOUT", timeout=5000)
read_screen()
```

**Acceptance**

- ECONNREFUSED, in order: `ECONNREFUSED connect refused for https://api.example.test/v1/widgets`
- ENOTFOUND, in order: `ENOTFOUND getaddrinfo failed for https://api.example.test/v1/widgets`
- ETIMEDOUT, in order: `ETIMEDOUT request timed out for https://api.example.test/v1/widgets`
- Each command includes: `Use --debug for a stack trace.`

**Negative checks**

- Must not contain `at fixtureHandler`
- Must not contain `node:internal`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to each command.

## 15. Help Pointer On Error

**What it tests** — `toolcraft-help-pointer-on-error`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=60)
type("node QA-error-ux-fixture/bin.js widgets create --yes\n")
wait_for(pattern="widgets create --help", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js widgets create --unknown value --yes\n")
wait_for(pattern="widgets create --help", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js widgts\n")
wait_for(pattern="node QA-error-ux-fixture/bin.js --help", timeout=5000)
read_screen()
```

**Acceptance**

- Missing param, in order: `Missing required parameter "name".`
- Missing param, in order: `Run node QA-error-ux-fixture/bin.js widgets create --help for usage.`
- Unknown param, in order: `Unknown option "--unknown".`
- Unknown param, in order: `Run node QA-error-ux-fixture/bin.js widgets create --help for usage.`
- Unknown command, in order: `Unknown command "widgts".`
- Unknown command, in order: `Run node QA-error-ux-fixture/bin.js --help for usage.`

**Negative checks**

- Must not contain `commander.unknownOption`
- Must not contain `commander.unknownCommand`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to each command.

## 16. Problem Details And GraphQL Bodies

**What it tests** — `toolcraft-pretty-api-errors`

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=70)
type("node QA-error-ux-fixture/bin.js throw-http-problem-details --verbose\n")
wait_for(pattern="Problem: Invalid widget request", timeout=5000)
read_screen()
type("node QA-error-ux-fixture/bin.js throw-http-graphql --verbose\n")
wait_for(pattern="GraphQL error: Widget missing", timeout=5000)
read_screen()
```

**Acceptance**

- Problem details, in order: `Problem: Invalid widget request`
- Problem details, in order: `Detail:  name must be at least 3 characters`
- Problem details, in order: `Type:    https://api.example.test/problems/invalid-widget`
- Problem details, in order: `Instance: /v1/widgets/42`
- Problem details, in order: `Status:  400`
- GraphQL, in order: `GraphQL error: Unauthorized`
- GraphQL, in order: `at path: viewer`
- GraphQL, in order: `code:    UNAUTHENTICATED`
- GraphQL, in order: `GraphQL error: Widget missing`
- GraphQL, in order: `at path: widget.42`
- GraphQL, in order: `code:    NOT_FOUND`

**Negative checks**

- Must not contain `"errors": [`
- Must not contain `"extensions":`
- Must not contain `Bearer qa-secret-token`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to both commands.

## 17. Error Report Capture

**What it tests** — `toolcraft-error-report-capture`

**Setup** — `cwd=$REPO/packages/toolcraft`; remove only this fixture's report directory before the run: `rm -rf QA-error-ux-fixture/.toolcraft/errors`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=60)
type("rm -rf QA-error-ux-fixture/.toolcraft/errors\n")
wait_for(pattern="$", timeout=5000)
type("node QA-error-ux-fixture/bin.js throw-http-401 --verbose\n")
wait_for(pattern="Saved error report to .toolcraft/errors/", timeout=5000)
read_screen()
type("ls QA-error-ux-fixture/.toolcraft/errors/*throw-http-401.log\n")
wait_for(pattern="throw-http-401.log", timeout=5000)
read_screen()
type("sed -n '1,120p' QA-error-ux-fixture/.toolcraft/errors/*throw-http-401.log\n")
wait_for(pattern="HTTP Transcript", timeout=5000)
read_screen()
```

**Acceptance**

- CLI output, in order: `Saved error report to .toolcraft/errors/`
- CLI output, in order: `throw-http-401.log`
- Report file, in order: `Toolcraft Error Report`
- Report file, in order: `Command Path`
- Report file, in order: `throw-http-401`
- Report file, in order: `HTTP Transcript`
- Report file, in order: `GET https://api.example.test/v1/widgets/42`
- Report file, in order: `authorization: Bearer ****`
- Report file, in order: `401 Unauthorized`

**Negative checks**

- Must not contain `Bearer qa-secret-token`
- Must not contain `POE_KEY=near-miss-token`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and append `2>&1 | cat` to the `throw-http-401 --verbose` command.

## 18. Long-Running Progress Ordering

**What it tests** — current progress rendering before an error; spinner-aware rendering is deferred, but stdout / stderr ordering is still user-visible.

**Setup** — `cwd=$REPO/packages/toolcraft`.

**Terminal-pilot script**

```text
create_session(cwd="$REPO/packages/toolcraft", cols=100, rows=40)
type("node QA-error-ux-fixture/bin.js long-running\n")
wait_for(pattern="Long-running fixture failed after progress.", timeout=5000)
read_screen()
```

**Acceptance**

- In order: `starting long-running fixture`
- In order: `halfway through long-running fixture`
- In order: `Long-running fixture failed after progress.`
- In order: `Run node QA-error-ux-fixture/bin.js long-running --help for usage.`
- Visual check: progress lines remain above the final error block at 60 columns and do not overwrite it.

**Negative checks**

- Must not contain `UnhandledPromiseRejection`
- Must not contain `at fixtureHandler`
- Must not contain `node:internal`

**ANSI regimes** — Run TTY + colour, TTY + `NO_COLOR=1`, and `node QA-error-ux-fixture/bin.js long-running 2>&1 | cat`.
