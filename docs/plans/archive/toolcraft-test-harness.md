---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: extract-runtime-io
    title: Extract shared runtime io module
    prompt: >
      In packages/toolcraft the context-building primitives are copy-pasted four

      times: createFs/createEnv in src/sdk.ts (~312/336), src/mcp.ts (~207/231),

      src/cli.ts (~3044/3068), src/human-in-loop/runner.ts (~251/275), and

      validateServices/RESERVED_SERVICE_NAMES in src/sdk.ts (~344/30) and

      src/mcp.ts (~239/44).


      Create packages/toolcraft/src/runtime/io.ts as the single home:
        export function createFs(fs?: HandlerFs): HandlerFs            // default: current real node:fs/promises-backed impl
        export function createEnv(values?: Record<string, string | undefined>): HandlerEnv  // default: process.env
        export function validateServices(services: object): void
        export const RESERVED_SERVICE_NAMES

      HandlerFs/HandlerEnv are the interfaces in src/index.ts (~61/74). Switch

      sdk.ts, mcp.ts, cli.ts, human-in-loop/runner.ts to import from
      runtime/io.ts

      and delete their local copies. Behavior-preserving move: write

      src/runtime/io.test.ts (injection, defaults, reserved-name rejection) and

      keep the full toolcraft suite green (`npx vitest run packages/toolcraft`

      from the repo root).
    status:
      implement: done
      test: done
  - id: adapter-injection-options
    title: Add env/fs/outputEmitter injection options to adapters
    prompt: >
      In packages/toolcraft, add hermetic injection options to all three

      adapters. CreateSDKOptions (src/sdk.ts), RunMCPOptions (src/mcp.ts), and

      RunCLIOptions (src/cli.ts) gain:

        env?: Record<string, string>  — passed to resolveCommandSecrets(command, env)
          (src/index.ts ~598; the parameter exists but no adapter passes it), to
          assertCommandRequirements(..., { env }), and to createEnv(env) from
          src/runtime/io.ts. Default stays process.env.
        fs?: HandlerFs — passed to createFs(fs). Default stays the real fs.

      Also fix: mcp.ts drops apiVersion when calling assertCommandRequirements

      (~mcp.ts:1166) — thread options.apiVersion through like sdk.ts does.


      RunCLIOptions additionally gains outputEmitter?: (entry) => void, threaded

      into the CLI's createLogger(emitter) inside executeCommand (~cli.ts:4704),

      so callers capture rendered output without spying on process.stdout.


      All additive; defaults preserve current behavior; existing sdk/mcp/cli

      tests stay green. Add tests proving each option is honored (SDK, then MCP

      including the apiVersion fix, then CLI).
    status:
      implement: done
      test: done
  - id: testing-fakes
    title: Add memory fs and fake service/fetch helpers
    prompt: >
      Create packages/toolcraft/src/testing/memory-fs.ts and

      packages/toolcraft/src/testing/fakes.ts with tests (memory-fs.test.ts,

      fakes.test.ts). No new dependencies — do NOT add memfs; HandlerFs

      (src/index.ts ~61) is six methods (readFile/writeFile/exists/lstat/

      rename/unlink), implement it in-memory directly.


      memory-fs.ts:
        export function createMemoryFs(files?: Record<string, string>): MemoryFs
        export interface MemoryFs extends HandlerFs {
          snapshot(): Record<string, string>;
          changes(): FsChange[];
        }
        export type FsChange = { op: "writeFile" | "rename" | "unlink"; path: string; to?: string };
      Match real-fs semantics for readFile encoding, exists, lstat, and

      missing-file errors.


      fakes.ts:
        export function fakeService<T extends object>(stubs?: Partial<T>): T & { calls: ServiceCall[] }
        export interface ServiceCall { method: string; args: unknown[]; result?: unknown; error?: unknown }
      Proxy-based; records every call in order; invoking an unstubbed method

      throws an error naming the method.

        export function fakeFetch(routes: FetchRoute[]): typeof globalThis.fetch & { calls: Request[] }
        export interface FetchRoute {
          method?: string;
          url: string | ((url: string) => boolean);
          status?: number;
          json?: unknown;
          text?: string;
          error?: Error;
        }
      First matching route wins; unmatched request throws an error listing the

      configured routes; every call is recorded.
    status:
      implement: done
      test: done
  - id: harness-core
    title: Build createCommandTestHarness core pipeline
    prompt: >
      Create packages/toolcraft/src/testing/harness.ts, fixtures.ts,

      harness.test.ts, harness-hermetic.test.ts implementing the in-process

      command test harness from GitHub issue #501 (design:

      docs/plans/toolcraft-test-harness.md).

        export function createCommandTestHarness<TServices extends object = {}>(
          root: Group, options?: HarnessOptions<TServices>): CommandTestHarness

        HarnessOptions: services?, env? (sealed map — process.env must never be
        read anywhere in a harness run), secrets? (Record<secret name, value>,
        reverse-mapped through SecretDefinition.env into the sealed env, winning
        on conflict), fs? (Record<string,string> -> createMemoryFs, or any
        HandlerFs), fetch? (fetch fn or FetchRoute[] -> fakeFetch),
        confirmations? ("approve" | "decline" | (req) => boolean | Promise<boolean>),
        apiVersion?, logLevel? (capture threshold, default "debug").

        CommandTestHarness:
          run<T>(path: string[], params?: Record<string, unknown>): Promise<RunResult<T>>
          fs: MemoryFs
          timeline: EffectEvent[]        // cumulative across runs

      run() executes the REAL pipeline in production order by reusing the

      existing pieces — resolveCommandSecrets and assertCommandRequirements

      (src/index.ts ~598/~651), filterSchemaForScope(schema, "sdk")

      (src/schema-scope.ts), the SDK validator validateObjectSchema

      (src/sdk.ts ~556, export it if needed), invokeWithHumanInLoop

      (src/human-in-loop/gate.ts ~31), and buildBaseContext primitives from

      src/runtime/io.ts. Do not re-implement validation or secret logic.

      Command resolution by path must honor aliases, group `default` commands,

      and hidden commands; resolving under an MCP-proxy (deferred) group throws

      a UserError saying those need a live server. Params are camelCase.


      run() never throws. RunResult:
        ok, value, error (raw, never stringified), failedAt (PipelineStage |
        undefined), pending (async human-in-loop enqueued — return the
        HumanInLoopPending as value, never spawn approval runners), logs
        (DiagnosticLogEvent[] captured via a RuntimeLogger sink from
        src/runtime-logging.ts), progress (string[]), confirmations
        (captured requests), timeline (this run), fsChanges.
        PipelineStage = "resolve" | "secrets" | "requirements" | "params" |
        "confirm" | "handler" | "render".

      Timeline: EffectEvent =
        { seq, kind: "fetch", method, url } |
        { seq, kind: "fs", op: "writeFile"|"rename"|"unlink", path } |
        { seq, kind: "service", service, method, args } |
        { seq, kind: "env", key } |
        { seq, kind: "progress", message } |
        { seq, kind: "confirm", message, approved }
      Monotonic seq, no timestamps anywhere — two identical runs must

      JSON.stringify identically.


      fixtures.ts defines a fixture group covering: params with defaults,

      required + optional secrets, requires.auth + requires.check, a confirm

      command, a humanInLoop command, rich/markdown/json renderers, a

      service-calling handler, an fs-writing handler, an alias, a group

      default, and handlers throwing UserError, an http-errors NotFound, and a

      plain Error.


      harness.test.ts: one describe block per pipeline stage proving correct

      failedAt, correct error type, and — for every pre-handler failure —

      empty timeline and zero fakeService calls. Success block proves value,

      logs, progress, timeline ordering, fsChanges.


      harness-hermetic.test.ts: poison process.env with a matching secret var

      and prove the run still fails at "secrets" (nothing leaked); run one case

      twice and assert both serialized results are identical.
    status:
      implement: done
      refactor: done
      test: done
  - id: render-capture
    title: Capture rendered output on run results
    prompt: |
      Add packages/toolcraft/src/testing/render-capture.ts and populate
      rendered: { rich?; markdown?; json? } on the harness RunResult
      (packages/toolcraft/src/testing/harness.ts).

      After a successful handler, run each renderer the command defines
      (command.render.rich/markdown/json) with RenderPrimitives
      (src/index.ts ~78: logger, renderTable, getTheme, note) built for
      capture: toolcraft-design's createLogger(emitter) collecting into a
      string, colors disabled, fixed 80-column width — deterministic and
      snapshot-safe. Only populate keys for renderers the command defines. A
      renderer that throws sets failedAt: "render" and error while keeping
      result.value. Extend harness.test.ts with renderer coverage using the
      existing fixture commands.
    status:
      implement: done
      test: done
  - id: surface-parity
    title: Add cross-surface parity runner
    prompt: >
      Add packages/toolcraft/src/testing/parity.ts and a

      parity(path, params?): Promise<ParityResult> method on the harness in

      packages/toolcraft/src/testing/harness.ts. It runs the same case through

      the three REAL adapters in-process, no child processes:

        sdk: createSDK(root, { services, env, fs, fetch, apiVersion })
        mcp: createMCPServer over tiny-mcp-client's in-memory transport
             (createSdkTestPair, already used in
             packages/toolcraft-openapi/src/runtime.test.ts; tiny-mcp-client is
             already a bundled dependency) — arguments snake_cased, value parsed
             from structuredContent/content
        cli: runCLI with argv built from params (--kebab-case flags +
             positionals from command.positional), --output json, env/fs/fetch
             injected, value parsed from output captured via outputEmitter

        export interface ParityResult {
          sdk: SurfaceOutcome; mcp: SurfaceOutcome; cli: SurfaceOutcome;
          agree: boolean; diff?: string;
        }
        export interface SurfaceOutcome { ok: boolean; value: unknown; error: unknown }

      agree = same ok, deep-equal values, same error class + message; diff is a

      human-readable explanation when false. Respect per-surface scope: a

      command filtered out of a surface reports that in diff. parity.test.ts:

      a success case and a validation-failure case agree across all three; a

      scope-limited param yields agree === false with a readable diff.
    status:
      implement: done
      test: done
  - id: export-docs-migrate
    title: Export toolcraft/testing, document, migrate exemplar tests
    prompt: |
      Finish the toolcraft test harness (issue #501):

      1. packages/toolcraft/src/testing/index.ts re-exporting
         createCommandTestHarness, fakeService, fakeFetch, createMemoryFs and
         their types; add "./testing" to the exports map in
         packages/toolcraft/package.json (dist/testing/index.js + .d.ts).
      2. Add a "Testing commands" section to packages/toolcraft/README.md:
         harness options, RunResult with failedAt stage assertions, hermeticity
         guarantees, a parity example.
      3. Migrate packages/superintendent/src/commands/complete.test.ts from raw
         command.handler(ctx as any) calls to createCommandTestHarness — casts
         gone, plus a new assertion that invalid params never invoke the
         injected services (failedAt === "params", timeline empty).
      4. Migrate one case in packages/toolcraft-openapi/src/runtime.test.ts the
         same way.
      5. `npx vitest run packages/toolcraft packages/superintendent
         packages/toolcraft-openapi` green from the repo root.
    status:
      implement: done
      test: done
name: toolcraft-test-harness
state: archived
---

# Toolcraft command test harness

In-process unit-test harness that runs a command through toolcraft's real runtime pipeline with injected env, secrets, services, fs, and fetch, and returns everything a test needs to assert on (issue #501).

## 1. What we're building

An in-process unit-test harness for toolcraft command behavior. Downstream tools can prove that validation, defaults, secrets, requirements, errors, service injection, and side-effect ordering behave identically across CLI, MCP, and SDK — without spawning child processes, without reading the developer's real environment, and without a `dryRun` convention.

Non-goals:

- No product-level `dryRun` flag in application commands.
- No clock abstraction in toolcraft — no seam exists today; tests use `vi.useFakeTimers()`.
- No mass migration of the ~28 downstream test files that call `command.handler(ctx)` directly; this plan migrates two exemplars, the rest follow opportunistically.
- No process-spawning e2e mode; everything runs in-process.

## 2. User-facing shape

New subpath export `toolcraft/testing`.

```ts
import { createCommandTestHarness, fakeService, fakeFetch } from "toolcraft/testing";
import { root } from "../commands.js";

const homey = fakeService<HomeyService>({
  push: async () => ({ ok: true })
});

const harness = createCommandTestHarness(root, {
  services: { homey },
  env: { HOMEY_PAT: "test" }, // sealed: process.env is never read
  fs: { "/project/flow.json": "{}" }, // in-memory HandlerFs from a path→content map
  fetch: fakeFetch([
    { method: "POST", url: "https://api.homey.app/v1/sync", json: { id: "flow-1" } }
  ]),
  confirmations: "approve"
});

const result = await harness.run(["flows", "sync"], { root: "/project", id: "flow-1" });

expect(result.ok).toBe(true);
expect(result.value).toEqual({ id: "flow-1" });
expect(result.progress).toEqual(["Syncing flow-1"]);
expect(homey.calls).toEqual([{ method: "push", args: [{ id: "flow-1" }] }]);
expect(result.timeline).toMatchSnapshot(); // ordered fetch/fs/service/progress events
expect(result.rendered.markdown).toContain("Synced");
```

`run()` never throws. Failures come back typed, with the pipeline stage that stopped the run:

```ts
const result = await harness.run(["flows", "sync"], { id: 42 });

expect(result.ok).toBe(false);
expect(result.failedAt).toBe("params"); // handler was never reached
expect(result.error).toBeInstanceOf(ValidationAggregateError);
expect(result.timeline).toEqual([]); // no fetch, no fs write, no service call
expect(homey.calls).toEqual([]);
```

Stages, in real pipeline order: `"resolve" | "secrets" | "requirements" | "params" | "confirm" | "handler" | "render"`. A missing required secret fails at `"secrets"`, a failing `requires.check` at `"requirements"`, and neither ever invokes the handler or a service.

Hermeticity guarantees:

- `process.env` is never read — secrets resolution, `requires.auth`, and `ctx.env.get()` all see only the `env` option. Every `ctx.env.get()` read is recorded in the timeline, so accidental dependence on the developer's environment shows up as a test failure, not a flake.
- An unmatched `fetch` call throws listing the configured routes.
- Calling an unstubbed method on a `fakeService` throws naming the service and method.
- Results contain no timestamps; ordering is expressed by `seq`. Two identical runs serialize identically, so snapshots are stable.

Surface parity — the same case through all three real adapters, in-process:

```ts
const parity = await harness.parity(["flows", "sync"], { root: "/project", id: "flow-1" });

expect(parity.agree).toBe(true); // same outcome, deep-equal value, same error class + message
parity.sdk.value; // raw SDK return
parity.mcp.value; // parsed from structuredContent via in-memory MCP transport
parity.cli.value; // parsed from captured `--output json` stdout
```

The harness maps params per surface automatically: camelCase for SDK, snake_case arguments for MCP, `--kebab-case` flags plus positionals for CLI. No child processes; MCP runs over `tiny-mcp-client`'s in-memory transport pair.

Helpers, importable on their own:

```ts
const fs = createMemoryFs({ "/a.txt": "hi" });   // HandlerFs + snapshot() + changes()
const fetch = fakeFetch([...routes]);             // typeof globalThis.fetch + .calls
const svc = fakeService<MyService>({ ... });      // T + .calls, throws on unstubbed methods
```

`fs` also accepts any existing `HandlerFs`, so current memfs wrappers keep working.

## 3. Implementation details and technical decisions

Autonomy audit: everything needed is in-repo. Vitest is the runner, `tiny-mcp-client` (zero runtime deps, MCP SDK is dev-only) is already a bundled dependency of toolcraft, `toolcraft-design` provides `createLogger(emitter)` for output capture. No credentials, network, services, or new external dependencies. The in-memory `HandlerFs` is implemented directly (`HandlerFs` is six methods) — no memfs dependency added to toolcraft.

### Fix at the correct layer: extract the shared runtime first

The pipeline is currently re-implemented inline in `sdk.ts`, `mcp.ts`, `cli.ts`, and `human-in-loop/runner.ts`, with `createFs`/`createEnv`/`validateServices`/`RESERVED_SERVICE_NAMES` copy-pasted four times (`sdk.ts:312`, `mcp.ts:207`, `cli.ts:3044`, `human-in-loop/runner.ts:251`). The harness must not become a fifth copy. Step one consolidates these into `src/runtime/io.ts`, and threads two injection gaps that already have function-level seams but no adapter-level options:

- `resolveCommandSecrets(command, env)` (`index.ts:598`) accepts an env override but every adapter calls it without one. Adapters gain an `env?: Record<string, string>` option, passed to secrets resolution, `assertCommandRequirements({ env })`, and `createEnv(env)`. Default stays `process.env`.
- `createFs(fs?)` gains an injectable `HandlerFs`; default stays the real `node:fs/promises`-backed implementation.

After this, the harness is a fourth consumer of the same pipeline the adapters run — identical order: resolve command by path (aliases, group `default`, hidden included) → `resolveCommandSecrets` → `assertCommandRequirements` → scope-filtered param validation with defaults → confirm/HIL gate → `invokeWithHumanInLoop` → render. Not a parallel re-implementation.

### Decisions

- **Casing**: `harness.run()` accepts camelCase params and uses the SDK validator (`validateObjectSchema`, `sdk.ts:556`) with `filterSchemaForScope(schema, "sdk")`. Parity mode converts per surface.
- **Secrets option**: `secrets: { pat: "test" }` (keyed by secret name, as in the issue) is sugar — the harness reverse-maps names to `SecretDefinition.env` vars and merges into the sealed env, `secrets` winning on conflict. Resolution still runs through the real `resolveCommandSecrets`, so missing-secret and did-you-mean behavior is exercised, not bypassed.
- **Stage tracking**: the harness wraps each pipeline step and records the first failing stage into `failedAt`; the error is captured raw (`UserError`, `HttpError`, aggregated validation errors) — never stringified.
- **Timeline**: instrumentation wraps the injected `fetch`, `HandlerFs` mutating ops, `fakeService` methods, `ctx.env.get`, `progress`, and confirmations, appending `{ seq, kind, ... }` events to a single per-run array (plus a cumulative `harness.timeline` across runs for multi-step tests). Single-threaded capture with a monotonic counter; no wall-clock anywhere.
- **Rendering capture**: `result.rendered` runs the command's `render.rich/markdown/json` with `RenderPrimitives` built from `toolcraft-design` `createLogger(emitter)` capturing into strings, colors disabled, fixed 80-column width — deterministic and snapshot-safe. Only populated for renderers the command defines. Render errors set `failedAt: "render"` while keeping `result.value`.
- **Confirmations / human-in-loop**: `confirmations: "approve" | "decline" | (req) => boolean | Promise<boolean>` drives both the legacy `confirm` gate and a scripted `HumanInLoopProvider` for sync approvals; every request is captured in `result.confirmations`. Async HIL returns the `HumanInLoopPending` as `result.value` with `result.pending: true` — the harness does not spawn approval runners.
- **CLI parity output capture**: `RunCLIOptions` gains `outputEmitter?: (entry: LoggerEntry) => void`, threaded into the CLI's `createLogger(emitter)` (`cli.ts:4704`), so parity captures stdout without `vi.spyOn(process.stdout)`. Parity runs the CLI with `--output json` and compares the parsed value against SDK/MCP results.
- **MCP-proxy groups** (`createDeferredSDK` paths): unsupported in the harness; resolving a command under an MCP-proxy group throws a `UserError` explaining they require a live server.
- **`root` argument**: same `Group` value passed to `runCLI`/`createSDK`/`runMCP` — the harness resolves from the identical materialized tree, so inherited secrets/requires/scope cascade exactly as in production.

Edge cases: alias resolution and group `default` commands resolve like the CLI; hidden commands are runnable (they exist on SDK); reserved service names rejected by the shared `validateServices`; commands with `result` schemas get MCP `structuredContent` validation exercised in parity; `apiVersion` requirement testable via the harness option (and the existing MCP gap — `mcp.ts:1166` passes no `apiVersion` — will surface as a parity disagreement, which is the harness doing its job; fix it in this plan by threading the option).

No new env vars. No config file surface. Everything is programmatic options.

## 4. Interfaces and test plan

### Types (exported from `toolcraft/testing`)

```ts
export function createCommandTestHarness<TServices extends object = {}>(
  root: Group,
  options?: HarnessOptions<TServices>
): CommandTestHarness;

export interface HarnessOptions<TServices extends object> {
  services?: TServices;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  fs?: Record<string, string> | HandlerFs;
  fetch?: typeof globalThis.fetch | FetchRoute[];
  confirmations?:
    | "approve"
    | "decline"
    | ((req: ConfirmationRequest) => boolean | Promise<boolean>);
  apiVersion?: string;
  logLevel?: DiagnosticLevel; // capture threshold, default "debug"
}

export interface CommandTestHarness {
  run<T = unknown>(path: string[], params?: Record<string, unknown>): Promise<RunResult<T>>;
  parity(path: string[], params?: Record<string, unknown>): Promise<ParityResult>;
  fs: MemoryFs; // inspect state between runs
  timeline: EffectEvent[]; // cumulative across runs
}

export type PipelineStage =
  | "resolve"
  | "secrets"
  | "requirements"
  | "params"
  | "confirm"
  | "handler"
  | "render";

export interface RunResult<T> {
  ok: boolean;
  value: T | undefined;
  error: unknown; // UserError | HttpError | ValidationAggregateError | ...
  failedAt: PipelineStage | undefined;
  pending: boolean; // async human-in-loop enqueued
  logs: DiagnosticLogEvent[];
  progress: string[];
  confirmations: ConfirmationRequest[];
  rendered: { rich?: string; markdown?: string; json?: string };
  timeline: EffectEvent[]; // this run only
  fsChanges: FsChange[];
}

export type EffectEvent =
  | { seq: number; kind: "fetch"; method: string; url: string }
  | { seq: number; kind: "fs"; op: "writeFile" | "rename" | "unlink"; path: string }
  | { seq: number; kind: "service"; service: string; method: string; args: unknown[] }
  | { seq: number; kind: "env"; key: string }
  | { seq: number; kind: "progress"; message: string }
  | { seq: number; kind: "confirm"; message: string; approved: boolean };

export function fakeService<T extends object>(stubs?: Partial<T>): T & { calls: ServiceCall[] };
export interface ServiceCall {
  method: string;
  args: unknown[];
  result?: unknown;
  error?: unknown;
}

export function fakeFetch(routes: FetchRoute[]): typeof globalThis.fetch & { calls: Request[] };
export interface FetchRoute {
  method?: string;
  url: string | ((url: string) => boolean);
  status?: number;
  json?: unknown;
  text?: string;
  error?: Error;
}

export function createMemoryFs(files?: Record<string, string>): MemoryFs;
export interface MemoryFs extends HandlerFs {
  snapshot(): Record<string, string>;
  changes(): FsChange[];
}
export type FsChange = { op: "writeFile" | "rename" | "unlink"; path: string; to?: string };

export interface ParityResult {
  sdk: SurfaceOutcome;
  mcp: SurfaceOutcome;
  cli: SurfaceOutcome;
  agree: boolean;
  diff?: string; // human-readable when agree === false
}
export interface SurfaceOutcome {
  ok: boolean;
  value: unknown;
  error: unknown;
}
```

Adapter option additions (backwards-compatible, all default to today's behavior):

```ts
// CreateSDKOptions, RunMCPOptions, RunCLIOptions
env?: Record<string, string>;               // secrets + requirements + ctx.env; default process.env
fs?: HandlerFs;                             // default real-fs implementation
// RunCLIOptions only
outputEmitter?: (entry: LoggerEntry) => void;
// RunMCPOptions
apiVersion is now passed through to assertCommandRequirements (fixes the mcp.ts:1166 gap)
```

### Tests (TDD — each step below starts with its tests)

Fixture tree in `src/testing/fixtures.ts`: one group with commands covering params with defaults, required + optional secrets, `requires.auth` + `requires.check`, a confirm command, a humanInLoop command, all three renderers, a service-calling handler, an fs-writing handler, an alias, a group `default`, and a throwing handler (`UserError`, `NotFound` HTTP error, plain `Error`).

- `runtime/io.test.ts` — shared `createFs`/`createEnv`/`validateServices`: injection, defaults, reserved-name rejection.
- `memory-fs.test.ts`, `fakes.test.ts` — HandlerFs semantics (readFile encoding, exists, lstat, rename, unlink), fetch route matching + unmatched throw + call recording, service recording + unstubbed throw.
- `harness.test.ts` — one describe block per pipeline stage proving: correct `failedAt`, correct error type, and (for pre-handler stages) empty timeline and zero service calls. Success path proves value, logs, progress, rendered output, fsChanges, timeline ordering.
- `harness-hermetic.test.ts` — poisons `process.env` with a matching secret var before running; asserts the run fails at `"secrets"` (nothing leaked). Runs the same case twice and asserts `JSON.stringify` equality of both results.
- `parity.test.ts` — success and validation-failure cases agree across all three surfaces; an intentionally CLI-only param (scope) produces `agree === false` with a readable diff.
- Existing `sdk.test.ts` / `mcp.test.ts` / `cli.test.ts` stay green through the refactor — they are the regression net for the extraction.

### Real-world test

1. `cd /Users/kjopek/Workspace/poe-code && npx vitest run packages/toolcraft/src/testing` — all harness suites pass.
2. Rewrite `packages/superintendent/src/commands/complete.test.ts` (today: raw `command.handler(ctx as any)`) to use `createCommandTestHarness`; `npx vitest run packages/superintendent/src/commands/complete.test.ts` passes with the `as any` casts gone and a new assertion that invalid params never touch the injected services.
3. Rewrite one `toolcraft-openapi` runtime case the same way; `npx vitest run packages/toolcraft-openapi/src/runtime.test.ts` passes.
4. `npx vitest run packages/toolcraft` — full package green, proving the runtime extraction changed no adapter behavior.

### Must-work checklist

- [ ] Successful run returns `value`, `logs`, `progress`, `rendered`, ordered `timeline` — proven by `harness.test.ts` success block.
- [ ] Invalid params: `failedAt === "params"`, handler and services never invoked — proven by the validation describe block asserting empty timeline and `calls`.
- [ ] Missing required secret fails at `"secrets"` before requirements/handler — proven by secrets describe block.
- [ ] Failing `requires.check` fails at `"requirements"` with the check's `UserError` — proven by requirements describe block.
- [ ] `process.env` never read: poisoned-env test passes — `harness-hermetic.test.ts`.
- [ ] Deterministic output: identical runs serialize identically — `harness-hermetic.test.ts`.
- [ ] Parity across SDK/MCP/CLI in-process, no child processes — `parity.test.ts` plus `grep -r "spawn" packages/toolcraft/src/testing` returning nothing.
- [ ] No new runtime dependency in `packages/toolcraft/package.json` `dependencies` — inspection of the diff.
- [ ] Adapters unchanged for existing callers — full `packages/toolcraft` suite green.
- [ ] `toolcraft/testing` documented in `packages/toolcraft/README.md` with typed examples.

### Rollout

Adapter option additions are additive with process-env/real-fs defaults; no existing caller changes. The two migrated downstream tests are the template; remaining direct-handler tests migrate opportunistically as their packages are touched.

## 5. Code plan

Create:

- `packages/toolcraft/src/runtime/io.ts` — single home for `createFs`, `createEnv`, `validateServices`, `RESERVED_SERVICE_NAMES` (moved from the four copies), plus `buildBaseContext(command, runtime)` assembling `{ ...services, secrets, fetch, fs, env, diagnostics, progress }`.
- `packages/toolcraft/src/runtime/io.test.ts`
- `packages/toolcraft/src/testing/index.ts` — public surface re-exports.
- `packages/toolcraft/src/testing/harness.ts` — `createCommandTestHarness`, path resolution, stage-tracked pipeline, capture wiring.
- `packages/toolcraft/src/testing/fakes.ts` — `fakeService`, `fakeFetch`.
- `packages/toolcraft/src/testing/memory-fs.ts` — `createMemoryFs`.
- `packages/toolcraft/src/testing/render-capture.ts` — capturing `RenderPrimitives` over `toolcraft-design` `createLogger(emitter)`.
- `packages/toolcraft/src/testing/parity.ts` — surface mapping (camel/snake/kebab), SDK/MCP/CLI execution, outcome comparison.
- `packages/toolcraft/src/testing/fixtures.ts` + `harness.test.ts`, `harness-hermetic.test.ts`, `parity.test.ts`, `fakes.test.ts`, `memory-fs.test.ts`.

Change:

- `packages/toolcraft/src/sdk.ts` — delete local `createFs`/`createEnv`/`validateServices`; import from `runtime/io.ts`; `CreateSDKOptions` gains `env`/`fs`; pass `options.env` to `resolveCommandSecrets` and `assertCommandRequirements`.
- `packages/toolcraft/src/mcp.ts` — same extraction and options; thread `apiVersion` into `assertCommandRequirements` (fixes the existing gap).
- `packages/toolcraft/src/cli.ts` — same extraction; `RunCLIOptions` gains `env`/`fs`/`outputEmitter`; `executeCommand` builds its logger with `createLogger(options.outputEmitter)`.
- `packages/toolcraft/src/human-in-loop/runner.ts` — use `runtime/io.ts` instead of its local copies.
- `packages/toolcraft/package.json` — add `"./testing"` to `exports`.
- `packages/toolcraft/README.md` — "Testing commands" section: harness options, `RunResult`, stage assertions, parity example.

New/modified signatures beyond §4:

```ts
// runtime/io.ts
export function createFs(fs?: HandlerFs): HandlerFs;
export function createEnv(values?: Record<string, string | undefined>): HandlerEnv;
export function validateServices(services: object): void;
export function buildBaseContext<TServices>(
  command: Command,
  runtime: ResolvedRuntimeIO<TServices>
): BaseHandlerContext & TServices;

// testing/harness.ts (internal)
function resolveCommandByPath(root: Group, path: string[]): Command; // aliases, default, hidden
function runPipeline<T>(
  command: Command,
  params: unknown,
  runtime: HarnessRuntime
): Promise<RunResult<T>>;
```

Build order (branch stays green at every step):

1. Tests for `runtime/io.ts`, then the module; switch `sdk.ts`, `mcp.ts`, `cli.ts`, `human-in-loop/runner.ts` to it. Pure move — full toolcraft suite green.
2. Adapter `env`/`fs` options with tests proving injection (SDK first, then MCP + `apiVersion` fix, then CLI + `outputEmitter`). Defaults preserve behavior.
3. `memory-fs.ts` and `fakes.ts`, tests first.
4. `fixtures.ts` + `harness.ts` core: resolution, stage tracking, capture, timeline — one stage at a time, tests first.
5. `render-capture.ts` + `rendered` on results.
6. `parity.ts` + tests.
7. `package.json` export, README section, migrate the two downstream exemplar tests.
