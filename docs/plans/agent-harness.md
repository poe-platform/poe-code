---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# agent-harness

A generic runner for agent-script-based harnesses, paired with co-located markdown documents that supply prompts and config.

## 1. What we're building

A new package, `@poe-code/agent-harness`, that runs a **harness pair**:

- `<name>.ajs` — orchestration script (agent-script source, the program the runtime executes)
- `<name>.md` — complementary markdown document with YAML frontmatter (prompts, agent config, status, research brief)

The `.ajs` is the orchestrator; the `.md` is data the orchestrator reads. The runtime pairs them by filename, lints + executes the `.ajs`, and exposes the markdown's validated frontmatter as the entry function's argument plus the body via `import.meta`.

This is **experimental**. It runs alongside the existing `experiment-loop` / `ralph` / `pipeline` / `superintendent` packages without touching them. The shipped templates are demonstrations of how each shape could be expressed as a harness pair; reaching parity with the existing runners is a future goal, not part of this work.

Non-goals:

- Not a new language. Reuses `agent-script` parser/linter/runtime as-is.
- Not a replacement for `agent-harness-tools` runtime helpers (lock, hooks, run-logs, select-agent). Those keep their place; agent-harness uses them for cross-cutting concerns.
- **Not changing anything about `experiment run` / `ralph run` / `pipeline run` / `superintendent run`.** Those runners, their CLI surfaces, frontmatter, schemas, and packages stay untouched. Parity with them is a future goal, explicitly out of scope.
- Not replacing `scripts/generate-plan-schemas.ts` or any existing `docs/schemas/plans/*.schema.json`. Harness schemas emit to a new path that does not collide.
- No regex-based markdown parsing or templating system invented here — uses the existing `agent-script` loader.

## 2. User-facing shape

A harness is a pair of files with the same basename, in the same directory:

```text
.poe-code/harnesses/ralph/
  ralph.ajs       # orchestrator
  ralph.md        # plan / prompt / frontmatter (the document being run)
```

### The `.ajs` orchestrator

ESM-shaped. One required default export (the entry), one optional named export (the frontmatter schema). No top-level `return`. No manual cancellation handling — the interpreter aborts between host calls, the snapshot scheduler persists progress, `restore()` resumes.

```js
import { S } from "schema";
import { spawn } from "agent";
import { event } from "log";

export const schema = S.Object({
  iterations: S.Optional(S.Number({ minimum: 1, default: 3 })),
  agent: S.Optional(S.String({ default: "claude-code" })),
  status: S.Object({
    state: S.Enum(["open", "in_progress", "completed", "failed"] as const),
    iteration: S.Number({ minimum: 0 }),
  }),
});

export default async (frontmatter) => {
  const { kind, filename, body } = import.meta;

  for (let i = frontmatter.status.iteration; i < frontmatter.iterations; i++) {
    const r = await spawn({ agent: frontmatter.agent, prompt: body });
    event("iteration.completed", { kind, file: filename, i, summary: r.summary });
  }
};
```

Contract:

- `export default` — required, must be an async arrow. Receives the validated frontmatter as its single argument. Its return value is the harness result.
- `export const schema` — optional. If present, the loader evaluates it against `toolcraft-schema` builders and validates the `.md` frontmatter before invoking the entry. If absent, the entry receives the raw frontmatter map.
- `import.meta` — exposes `{ kind, version, filename, dirname, body }` of the **paired `.md`**, matching Node's ESM `import.meta` extensions. `body` is the markdown content below the YAML header.

### The `.md` plan

Plain markdown with YAML frontmatter. The frontmatter conforms to whatever `export const schema` declares; the body is free-form prose the orchestrator can use as the prompt.

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/harnesses/ralph.schema.json
kind: ralph
version: 1
agent: claude-code
iterations: 3
status:
  state: open
  iteration: 0
---
# Refactor the auth module

Split the monolithic auth.ts into separate files for session management,
token validation, and middleware. Keep all existing tests passing.
```

### CLI

```bash
# run a harness pair
poe-code harness run .poe-code/harnesses/ralph/ralph.md

# discover-and-run from .poe-code/harnesses/
poe-code harness run

# scaffold a new harness pair
poe-code harness new my-loop

# list installed harnesses
poe-code harness list
```

The runner pairs `.md` ↔ `.ajs` by basename in the same directory, lints the `.ajs`, validates the `.md` frontmatter against the extracted schema, then executes the entry.

### Built-in templates

`@poe-code/agent-harness` ships templates that `harness new <kind>` scaffolds. They are demonstrations of the pair model on familiar shapes — they are **not** wired to or invoked from the existing `experiment run` / `ralph run` / `pipeline run` / `superintendent run` commands. The existing runners stay exactly as they are; parity with them is a future goal, out of scope for this work.

- `ralph-demo` — iterative single-agent loop
- `experiment-demo` — measure, mutate, keep-or-revert via git
- `pipeline-demo` — sequenced tasks with builder/reviewer roles
- `superintendent-demo` — builder + parallel inspectors + judge + owner

Each is one `.ajs` + one `.md`. Demo names are intentionally distinct from the existing `kind` values to avoid `$schema` URL collisions and to make the experimental status legible.

## 3. Implementation details and technical decisions

### Package layout

New package `@poe-code/agent-harness` at `packages/agent-harness/`. Owns the loader, the discovery / pairing logic, the per-harness templates, and the codegen entry point. Depends on `@poe-code/agent-script`, `@poe-code/agent-harness-tools`, `@poe-code/toolcraft-schema`.

```text
packages/agent-harness/
  src/
    loader/              # paired-file loader: discover, pair, validate, run
      pair.ts            # resolve <name>.ajs ↔ <name>.md
      extract-schema.ts  # AST-level pull of `export const schema` initializer
      validate.ts        # toolcraft-schema validator over frontmatter
      run.ts             # public runHarnessPair()
    modules/
      schema.ts          # makeSchemaModule(): exposes toolcraft-schema `S` to .ajs
    codegen/
      emit-schemas.ts    # walks installed templates, emits docs/schemas/harnesses/*.json
    templates/
      ralph/{ralph.ajs,ralph.md}
      experiment/{experiment.ajs,experiment.md}
      pipeline/{pipeline.ajs,pipeline.md}
      superintendent/{superintendent.ajs,superintendent.md}
    cli/                 # `poe-code harness {run,new,list}` command bodies
    index.ts
```

### Subset extensions to agent-script

Three additions, all gated to top-level use only.

1. **`ExportNamedDeclaration`** — `export const NAME = expr;`. Limited to a single declarator. Allowlist of names is configured per-host: agent-harness allows `schema`. Anything else is `AS-EXPORT-UNKNOWN`. Keeps the surface narrow; nothing else can be exported.
2. **`ExportDefaultDeclaration`** — `export default expr;`. Initializer must be an arrow function expression (sync or async). Exactly one per file. Lint code `AS-EXPORT-DEFAULT-MISSING` / `AS-EXPORT-DEFAULT-MULTIPLE` / `AS-EXPORT-DEFAULT-NOT-ARROW`.
3. **`MetaProperty` for `import.meta`** — recognized as an expression. Resolves at runtime to a host-injected sandbox object. Cannot be assigned to (`import.meta.x = ...` is a lint error).

Top-level `return` becomes a lint warning in `.ajs` files paired with markdown (`AS-RETURN-AT-TOP`); the new shape uses the default export's return value.

Existing single-file harness markdowns (`packages/agent-script/examples/*.md`) keep working — the legacy top-level-return path stays. The new package only consumes the new shape.

### `schema` host module

```ts
// packages/agent-harness/src/modules/schema.ts
import { S } from "@poe-code/toolcraft-schema";

export function makeSchemaModule(): { S: typeof S } {
  return { S };
}
```

Registered as `schema` for both lint and execution. The builders are pure — no IO, no host bridge needed. This lets the loader run the schema initializer in the standard interpreter without special-casing pure evaluation.

### Two-pass loader

```ts
async function runHarnessPair(mdPath: string, options: RunHarnessPairOptions): Promise<RunResult> {
  const ajsPath = await resolvePair(mdPath);                       // <name>.md ↔ <name>.ajs
  const ajsSource = await readFile(ajsPath, "utf8");
  const { frontmatter, body } = splitFrontmatter(await readFile(mdPath, "utf8"));

  // Pass 1: lint, then evaluate just `export const schema` if present
  const ast = parse(ajsSource, ajsPath);
  lint(ajsSource, { filename: ajsPath, modules: lintModulesFor(options) });
  const schemaInit = findExportedConstInitializer(ast, "schema");
  const schema = schemaInit
    ? await evaluateSchemaInitializer(schemaInit, { schemaModule: makeSchemaModule() })
    : undefined;

  // Validate frontmatter (no-op if no schema)
  const validated = schema ? validate(schema, frontmatter) : frontmatter;

  // Pass 2: full execution; default export receives validated frontmatter
  return run(ajsSource, {
    modules: options.modulesFor(validated, { kind: validated.kind, version: validated.version, filepath: mdPath, body }),
    importMeta: { kind: validated.kind, version: validated.version, filename: mdPath, dirname: path.dirname(mdPath), body },
    entryPointArgs: [validated],
    signal: options.signal,
    snapshotPath: options.snapshotPath,
  });
}
```

`run()` gets two new options — `importMeta` (object injected as `import.meta`) and `entryPointArgs` (forwarded to the resolved default export). When `entryPointArgs` is set, the runtime treats the resolved default export as the entry instead of expecting a top-level returned value.

`evaluateSchemaInitializer` reuses the existing interpreter with a stripped-down module registry (only `schema`) and a tight budget. Initializer that calls anything not exported by `schema` is a lint error before this step.

### Runtime validator on toolcraft-schema

`@poe-code/toolcraft-schema` gains `validate(schema, value)` returning `{ ok: true, value } | { ok: false, errors: ValidationError[] }`. Walks the descriptor mirror of `toJsonSchema`. Zero-dep, no ajv. Errors carry `path` (dotted), `expected`, `received`. Validation failure surfaces to the user with the `.md` filepath and the offending field path.

### Codegen

A new script walks `packages/agent-harness/src/templates/*/`, statically loads each `.ajs`'s `export const schema`, and emits `docs/schemas/harnesses/<kind>.schema.json` via `toJsonSchema(schema)`. Wired in as `npm run codegen:harness-schemas` and added to `npm run build` **alongside** the existing `codegen:plan-schemas` — neither replaces the other. Output path `docs/schemas/harnesses/` is new, so there's no overlap with `docs/schemas/plans/*.schema.json`.

### Locks, run logs, snapshots

All cross-cutting concerns reuse `@poe-code/agent-harness-tools`:

- **Lock**: `lockWorkflow(mdPath)` before pass 1; release on completion or error. Existing `<mdPath>.lock` file convention.
- **Run logs**: `resolveRunLogDir({ planPath: mdPath, runner: "harness", homeDir })`. Each `event(...)` call from the orchestrator is appended as JSONL.
- **Snapshot**: `snapshotPath = resolveRunLogDir(...) + "/snapshot.json"`. Passed straight to `agent-script`'s `run({ snapshotPath, snapshotIntervalMs })`. On rerun, the loader reads it and passes it to `run({ snapshot })` — agent-script's existing `restore()` validates source-hash match before resuming.

### Relationship to existing packages

Out of scope. `experiment-loop`, `ralph`, `pipeline`, `superintendent` are not touched. Their bespoke runtimes, frontmatter parsers, JsonSchema literals, CLI commands, dashboards, and emitted `docs/schemas/plans/*.schema.json` files remain exactly as they are. `agent-harness` is a parallel experimental track. If/when parity is reached and we decide to converge, that's a separate plan.

### Edge cases

- **No `export const schema`** — frontmatter passes through to the entry as the raw parsed YAML (untyped). Allowed; useful for trivial harnesses.
- **No `.md` paired** — hard error. Every `.ajs` requires a `.md`.
- **No `.ajs` paired** — hard error. Every `.md` discovered as a harness target requires a sibling `.ajs`.
- **Schema initializer references a non-pure value** — caught by lint. `schema` module is the only allowed import inside the initializer.
- **Default export is not an arrow** — lint error. Arrow + async arrow only.
- **Frontmatter fails validation** — runner exits non-zero with a message naming the `.md` path and the failing field. Snapshot is not touched.
- **Source hash drift on resume** — existing `restore()` behavior: the snapshot is rejected, the run starts fresh.
- **Concurrent runs against the same `.md`** — `lockWorkflow` rejects the second one with `EEXIST`.
- **Top-level `import.meta` aliasing (`const m = import.meta`)** — supported. Subsequent `m.body` works because `MetaProperty` resolves to a sandbox object with normal property access.

## 4. Interfaces and test plan

### Public API of `@poe-code/agent-harness`

```ts
export type HarnessImportMeta = {
  kind: string | undefined;
  version: number | undefined;
  filename: string;
  dirname: string;
  body: string;
};

export type HarnessPair = {
  ajsPath: string;
  mdPath: string;
  basename: string;
};

export type RunHarnessPairOptions = {
  modulesFor: (
    frontmatter: Record<string, unknown>,
    meta: HarnessImportMeta
  ) => ModuleRegistry;
  signal?: AbortSignal;
  snapshotPath?: string;
};

export function resolvePair(mdPath: string): Promise<HarnessPair>;
export function discoverHarnesses(rootDir: string): Promise<HarnessPair[]>;
export function runHarnessPair(
  mdPath: string,
  options: RunHarnessPairOptions
): Promise<RunResult>;

export function listBuiltinTemplates(): readonly { kind: string; ajsPath: string; mdPath: string }[];
export function scaffoldFromTemplate(
  kind: string,
  destination: { dir: string; basename: string }
): Promise<HarnessPair>;
```

### New surface on `@poe-code/agent-script`

```ts
// run.ts — additions to RunOptions
export type RunOptions = {
  // ...existing fields
  importMeta?: Record<string, unknown>;
  entryPointArgs?: readonly unknown[];
};

// parser AST additions
export type ExportNamedDeclaration = BaseNode & {
  type: "ExportNamedDeclaration";
  declaration: VariableDeclaration; // const only, single declarator
};
export type ExportDefaultDeclaration = BaseNode & {
  type: "ExportDefaultDeclaration";
  declaration: ArrowFunctionExpression;
};
export type MetaProperty = BaseNode & {
  type: "MetaProperty";
  meta: Identifier; // "import"
  property: Identifier; // "meta"
};

// new public helper
export function findExportedConstInitializer(
  module: Module,
  name: string
): Expression | undefined;
```

### New surface on `@poe-code/toolcraft-schema`

```ts
export type ValidationIssue = {
  path: readonly string[];
  expected: string;
  received: string;
  message: string;
};
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ValidationIssue[] };

export function validate<S extends SchemaDescriptor>(
  schema: S,
  value: unknown
): ValidationResult<Static<S>>;
```

### Test plan

#### `@poe-code/toolcraft-schema`

- Unit: `validate()` accepts every `S.*` builder, surfaces typed issues, applies `default` for missing optionals, rejects unknown properties on `S.Object` (matching emitted `additionalProperties: false`).
- Snapshot: `toJsonSchema(schema)` output for each builder remains stable.

#### `@poe-code/agent-script`

- Parser: `export const x = …`, `export default async () => {}`, `import.meta`, `import.meta.X`. Reject `export function`, `export class`, `export *`, multiple `export default`, top-level `import.meta = …`.
- Linter: only `schema` is allowlisted as a named export (configurable per registry via lint options); unknown export names emit `AS-EXPORT-UNKNOWN`. `AS-RETURN-AT-TOP` warns when `.ajs` has both top-level `return` and `export default`.
- Runtime: `run({ importMeta, entryPointArgs })` resolves the default export and invokes it with `entryPointArgs`. Cancellation between host calls inside the entry still throws `SandboxError("aborted")`. Snapshot/restore round-trip works across an aborted entry call.

#### `@poe-code/agent-harness`

- `resolvePair`: pairs by basename in same dir, surfaces `MissingPair` errors, ignores non-`.md`/`.ajs` siblings.
- `discoverHarnesses`: walks `.poe-code/harnesses/` and `<homedir>/.poe-code/harnesses/`, returns deduped list (project beats user).
- `extractSchema`: returns `undefined` when absent, returns evaluated descriptor when present, errors when initializer references non-`schema` modules.
- `runHarnessPair`:
  - happy path: validates frontmatter, invokes default export, returns its result.
  - missing schema: passes raw frontmatter through.
  - failing validation: rejects with named field path, leaves snapshot untouched, releases lock.
  - missing default export: lint error before run.
  - top-level `return` in `.ajs`: lint warning, run still proceeds.
  - resume: on a second invocation with a snapshot, the entry resumes from the next host call.
- Lock: second concurrent run against same `.md` errors with `EEXIST`.
- All filesystem state through `memfs` per CLAUDE.md.

#### Integration

- Run each shipped demo template end-to-end with a stub `agent` module. Assert: result, journal entries, snapshot file exists and parses.
- CLI: `poe-code harness run <md>` happy path, `harness new <kind> <name>`, `harness list`. Use `npm run dev -- harness ...` for spot tests; rely on screenshot tests for visual UI surfaces.
- Confirm the existing `experiment run` / `ralph run` / `pipeline run` / `superintendent run` test suites still pass unchanged — proving the new package doesn't touch them.

### Autonomy checklist

What an agent needs to build the package end-to-end without coming back:

- This document for level 1–5 context.
- Existing `agent-script` parser/lint/run code as the reference for adding `Export*` and `MetaProperty` AST nodes.
- Existing `toolcraft-schema` builders and `toJsonSchema` as the reference for `validate`.
- Existing `agent-harness-tools` (lock, run-logs, paths) — used as-is.
- Existing per-package frontmatter files as **inspiration only** for what a demo template might cover. The agent-harness package does not import from, modify, or replace those packages.
- `scripts/generate-plan-schemas.ts` as a structural reference for the new `scripts/generate-harness-schemas.ts`. The original is left untouched.

### Rollout

1. Land subset extensions (`Export*`, `MetaProperty`) + `toolcraft-schema` validator. No consumers yet, green build.
2. Land `agent-harness` package with templates, codegen, and the `harness` command marked experimental. The four existing runners keep working unchanged.
3. Stop here. Parity with the existing runners is a separate, future plan.

## 5. Code plan

Build order keeps the branch green at every step. Each step is one PR.

### Step 1 — `toolcraft-schema` validator

Files to create:

- `packages/toolcraft-schema/src/validate.ts`
- `packages/toolcraft-schema/src/validate.test.ts`

Files to change:

- `packages/toolcraft-schema/src/index.ts` — re-export `validate`, `ValidationIssue`, `ValidationResult`.

Signatures:

- `function validate<S extends SchemaDescriptor>(schema: S, value: unknown): ValidationResult<Static<S>>`
- internal: `function walk(schema: SchemaDescriptor, value: unknown, path: readonly string[], issues: ValidationIssue[]): unknown`

### Step 2 — agent-script subset extensions

Files to create:

- `packages/agent-script/src/parse/parse-export.ts`
- `packages/agent-script/src/parse/parse-import-meta.ts`
- `packages/agent-script/src/loader/find-exported.ts`
- `packages/agent-script/src/loader/find-exported.test.ts`

Files to change:

- `packages/agent-script/src/parse/parser.ts` — add `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `MetaProperty` to `Statement`/`Expression` unions; wire token-level entrypoints.
- `packages/agent-script/src/lint.ts` — add `AS-EXPORT-UNKNOWN`, `AS-EXPORT-DEFAULT-MISSING`, `AS-EXPORT-DEFAULT-MULTIPLE`, `AS-EXPORT-DEFAULT-NOT-ARROW`, `AS-RETURN-AT-TOP`, `AS-IMPORT-META-ASSIGN`. Accept `allowedExportNames` in `LintOptions`.
- `packages/agent-script/src/run.ts` — add `importMeta?` and `entryPointArgs?` to `RunOptions`. When `entryPointArgs` is set, after evaluating the module, look up the default export binding and call it with the args; the result becomes `returnValue`.
- `packages/agent-script/src/interp/scope.ts` — bind `import.meta` resolution to the runtime-injected value.
- `packages/agent-script/src/index.ts` — export `findExportedConstInitializer`, the new AST types.

Signatures:

- `function findExportedConstInitializer(module: Module, name: string): Expression | undefined`

### Step 3 — `agent-harness` package skeleton

Files to create:

- `packages/agent-harness/package.json`
- `packages/agent-harness/README.md`
- `packages/agent-harness/tsconfig.json`
- `packages/agent-harness/src/index.ts`
- `packages/agent-harness/src/loader/pair.ts`
- `packages/agent-harness/src/loader/pair.test.ts`
- `packages/agent-harness/src/loader/extract-schema.ts`
- `packages/agent-harness/src/loader/extract-schema.test.ts`
- `packages/agent-harness/src/loader/validate.ts`
- `packages/agent-harness/src/loader/validate.test.ts`
- `packages/agent-harness/src/loader/run.ts`
- `packages/agent-harness/src/loader/run.test.ts`
- `packages/agent-harness/src/modules/schema.ts`
- `packages/agent-harness/src/modules/schema.test.ts`
- `packages/agent-harness/src/discovery/discover.ts`
- `packages/agent-harness/src/discovery/discover.test.ts`
- `packages/agent-harness/src/templates/index.ts`

Signatures:

- `function resolvePair(mdPath: string, fs?: HarnessFs): Promise<HarnessPair>`
- `function discoverHarnesses(rootDir: string, fs?: HarnessFs): Promise<HarnessPair[]>`
- `function extractSchema(ajsSource: string, ajsPath: string): Promise<SchemaDescriptor | undefined>`
- `function validateFrontmatter(schema: SchemaDescriptor, frontmatter: Record<string, unknown>): Record<string, unknown>` (throws with named field path on failure)
- `function runHarnessPair(mdPath: string, options: RunHarnessPairOptions): Promise<RunResult>`
- `function makeSchemaModule(): { S: typeof S }`

### Step 4 — built-in demo templates

Files to create:

- `packages/agent-harness/src/templates/ralph-demo/ralph-demo.ajs`
- `packages/agent-harness/src/templates/ralph-demo/ralph-demo.md`
- `packages/agent-harness/src/templates/experiment-demo/experiment-demo.ajs`
- `packages/agent-harness/src/templates/experiment-demo/experiment-demo.md`
- `packages/agent-harness/src/templates/pipeline-demo/pipeline-demo.ajs`
- `packages/agent-harness/src/templates/pipeline-demo/pipeline-demo.md`
- `packages/agent-harness/src/templates/superintendent-demo/superintendent-demo.ajs`
- `packages/agent-harness/src/templates/superintendent-demo/superintendent-demo.md`
- `packages/agent-harness/src/templates/index.test.ts` — fixture tests that each template lints, frontmatter validates, runs against stub modules.

Each `.ajs` declares `export const schema = S.Object({...})` and `export default async (frontmatter) => {...}`. Names are `*-demo` to make experimental status legible and to keep `$schema` URLs separate from the existing runners' schemas.

### Step 5 — codegen + CLI

Files to create:

- `packages/agent-harness/src/codegen/emit-schemas.ts`
- `packages/agent-harness/src/codegen/emit-schemas.test.ts`
- `scripts/generate-harness-schemas.ts` — one-line wrapper over the codegen entry.
- `src/cli/commands/harness.ts`
- `src/cli/commands/harness-command.test.ts`
- `docs/schemas/harnesses/.gitkeep` — emitted output lives here.

Files to change:

- `package.json` — add `codegen:harness-schemas` script; add it to the `build` chain alongside the existing `codegen:plan-schemas` (do not remove or modify `codegen:plan-schemas`).
- `src/cli/index.ts` (or wherever commands register) — register the new `harness` command. No edits to existing `experiment` / `ralph` / `pipeline` / `superintendent` command registrations.

That's the full scope of this plan. `experiment-loop`, `ralph`, `pipeline`, `superintendent`, `scripts/generate-plan-schemas.ts`, and `docs/schemas/plans/*.schema.json` are not touched.
