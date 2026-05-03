---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: toolcraft-schema-validate
    title: Add runtime validate() to @poe-code/toolcraft-schema
    prompt: |
      In packages/toolcraft-schema, add a runtime `validate()` that walks
      a SchemaDescriptor and returns either `{ ok: true, value }` (with
      defaults applied for missing optionals) or `{ ok: false, issues }`.

      Files to create:
        - packages/toolcraft-schema/src/validate.ts
        - packages/toolcraft-schema/src/validate.test.ts

      Files to change:
        - packages/toolcraft-schema/src/index.ts — re-export
          `validate`, `ValidationIssue`, `ValidationResult`.

      Signatures:
        type ValidationIssue = { path: readonly string[]; expected: string;
                                  received: string; message: string };
        type ValidationResult<T> =
          | { ok: true; value: T }
          | { ok: false; issues: readonly ValidationIssue[] };
        function validate<S extends SchemaDescriptor>(
          schema: S, value: unknown
        ): ValidationResult<Static<S>>;

      Behavior:
        - Walk schema mirror of toJsonSchema. Zero-dep, no ajv.
        - S.Optional + missing value: emit `default` if set; otherwise omit.
        - S.Object: reject unknown properties (matches the
          `additionalProperties: false` toJsonSchema emits).
        - S.Enum: reject values not in the const tuple.
        - S.Number minimum / S.String minLength / S.Array minItems all
          enforced; emit issue with `path` (dotted segments) and `received`.
        - On any issue, return ok:false with all collected issues; do not
          throw.

      Tests must run in-memory only (no fs). Cover every builder, defaults
      application, additionalProperties rejection, nested object paths,
      and the multi-issue accumulation behavior.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-export-parser
    title: Parse `export const X = expr` and `export default expr` in agent-script
    prompt: |
      Extend agent-script's parser to accept two new top-level forms:
        - `export const NAME = <expression>;` — single declarator only.
        - `export default <expression>;` — initializer must be an
          ArrowFunctionExpression (sync or async).

      Both are top-level only. Reject `export function`, `export class`,
      `export *`, `export { ... }`, multiple `export default`, and any
      non-arrow default initializer at parse time (DisallowedSyntaxError).

      Files to create:
        - packages/agent-script/src/parse/parse-export.ts

      Files to change:
        - packages/agent-script/src/parse/parser.ts — add AST types
          `ExportNamedDeclaration` { type, declaration: VariableDeclaration }
          and `ExportDefaultDeclaration`
          { type, declaration: ArrowFunctionExpression } to the Statement
          union; wire token-level entrypoints from the top-level
          statement parser. Disallow these forms when the top-level is an
          expression rather than a module.

      Tests in packages/agent-script/src/parse/parse.test.ts (or a new
      parse-export.test.ts):
        - accept: `export const x = 1`, `export const schema = S.Object({})`,
          `export default async () => 1`, `export default () => {}`.
        - reject: function decl, class decl, `export *`, `export {x}`,
          `export default function`, two `export default` in one module,
          `export const a = 1, b = 2` (single declarator only),
          export inside a block.

      Do not change runtime semantics yet; just parsing + AST.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-import-meta-parser
    title: Parse `import.meta` as a MetaProperty expression in agent-script
    prompt: |
      Extend agent-script's parser to accept `import.meta` as an
      expression. Member access (`import.meta.body`), destructuring
      (`const { body } = import.meta`), and aliasing
      (`const m = import.meta`) all work via standard expression rules.
      Direct assignment to `import.meta` or any of its properties is a
      DisallowedSyntaxError at parse time.

      Files to create:
        - packages/agent-script/src/parse/parse-import-meta.ts

      Files to change:
        - packages/agent-script/src/parse/parser.ts — add AST type
          `MetaProperty` { type, meta: Identifier("import"),
          property: Identifier("meta") } to the Expression union;
          recognize the token sequence `import` `.` `meta` in expression
          position.

      Tests:
        - accept: `import.meta`, `import.meta.body`,
          `const { body } = import.meta`, `const m = import.meta;
          m.body`.
        - reject: `import.meta = x`, `import.meta.x = 1`,
          `[import.meta] = [...]`, `import.meta()` may parse as a call
          (allowed) but assignment-to is rejected.

      Do not wire runtime resolution yet — that's a later task.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-export-lint
    title: Lint rules for export forms and import.meta in agent-script
    prompt: |
      Add lint codes for the new export and import.meta syntax. The
      linter takes a new option `allowedExportNames?: readonly string[]`
      defaulting to no allowed names; unknown names emit
      `AS-EXPORT-UNKNOWN`.

      Files to change:
        - packages/agent-script/src/lint.ts — add codes:
          - `AS-EXPORT-UNKNOWN` (named export of a name not in
            allowedExportNames).
          - `AS-EXPORT-DEFAULT-MULTIPLE` (more than one export default
            in the module).
          - `AS-EXPORT-DEFAULT-NOT-ARROW` (default initializer is not an
            arrow expression).
          - `AS-RETURN-AT-TOP` (warning, top-level `return` statement
            present alongside an `export default`).
          - `AS-IMPORT-META-ASSIGN` (assignment target involves
            `import.meta`).
          Add `allowedExportNames` to `LintOptions`.

      Files to change in tests (or create new):
        - packages/agent-script/src/lint.test.ts — cover each new code
          for accept and reject cases. Use `allowedExportNames: ["schema"]`
          to test that path; default empty to test the rejection path.

      Do not introduce a runtime requirement that there must be an
      `export default`. That decision belongs to the agent-harness
      loader, not the linter.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-runtime-entry
    title: Wire importMeta and entryPointArgs into agent-script run()
    prompt: |
      Extend the agent-script runtime so a host can inject a value for
      `import.meta` and supply arguments to be passed into the resolved
      `export default` function.

      Files to change:
        - packages/agent-script/src/run.ts — add to RunOptions:
            importMeta?: Record<string, unknown>;
            entryPointArgs?: readonly unknown[];
          When `entryPointArgs` is set: after evaluating the module
          top-level, look up the default export binding (must be a
          callable). Call it with `entryPointArgs`; the awaited result
          becomes `returnValue`. If the default export is missing, throw
          a runtime error that names the script filename.
        - packages/agent-script/src/interp/scope.ts (or the import
          binding equivalent) — resolve `MetaProperty` to a deeply-copied
          sandbox value of `options.importMeta ?? {}`.
        - packages/agent-script/src/interp/cancel.ts — confirm the
          existing cancellation wrapping still applies inside the entry
          call. The script never sees `signal`; cancellation throws
          `SandboxError("aborted")` at the next host call as today.

      Tests in packages/agent-script/src/run.test.ts:
        - import.meta resolves to the injected object; properties are
          deep-copied (mutating the host object after run starts does
          not affect script-side reads).
        - entryPointArgs: arrow default export receives the args, its
          return becomes returnValue.
        - missing default export with entryPointArgs set: runtime error
          with filename.
        - default export throws: error propagates with sandbox-correct
          formatting.
        - cancellation between two host calls inside the entry function
          still aborts; snapshot captured before the abort allows
          restore() to resume from the next tick (use the existing
          snapshot test patterns).

      No regex use, no string-level surgery. Use the parser + interpreter
      end-to-end.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-find-exported
    title: Add findExportedConstInitializer to agent-script
    prompt: |
      Add a helper that, given a parsed Module AST, returns the
      initializer Expression of `export const <name> = <expr>;` at the
      top level, or undefined.

      Files to create:
        - packages/agent-script/src/loader/find-exported.ts
        - packages/agent-script/src/loader/find-exported.test.ts

      Files to change:
        - packages/agent-script/src/index.ts — export
          `findExportedConstInitializer` and the `ExportNamedDeclaration`,
          `ExportDefaultDeclaration`, `MetaProperty` AST types added in
          earlier tasks.

      Signature:
        function findExportedConstInitializer(
          module: Module,
          name: string
        ): Expression | undefined;

      Behavior:
        - Walk only top-level Statements (no recursion into blocks).
        - Match `ExportNamedDeclaration` whose declaration is a
          `VariableDeclaration` with `kind: "const"` and a single
          declarator whose id is an Identifier with the given name.
        - Return the declarator's `init` expression. Return undefined if
          no match.

      Tests with parsed fixtures: present, absent, wrong name, nested
      block (should be ignored), `let`/`var` (should be ignored).
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-skeleton
    title: Create @poe-code/agent-harness package skeleton
    prompt: |
      Create the new package at packages/agent-harness/ with the standard
      poe-code package layout. Per CLAUDE.md the package must have its
      own README listing env variables and config options (this package
      reads neither, so document that explicitly).

      Files to create:
        - packages/agent-harness/package.json — name
          `@poe-code/agent-harness`, depends on `@poe-code/agent-script`,
          `@poe-code/agent-harness-tools`, `@poe-code/toolcraft-schema`.
          Match the script set used by other monorepo packages
          (build/test). No publish-time CLI.
        - packages/agent-harness/tsconfig.json — extend the repo's
          shared package tsconfig.
        - packages/agent-harness/README.md — short overview, env vars
          (none), config options (none).
        - packages/agent-harness/src/index.ts — empty re-export hub for
          types added in later tasks.

      Files to change:
        - root tsconfig.json / turbo.json / package.json workspaces if
          required so the package is recognized by the build.

      Do not implement loader, modules, templates, codegen, or CLI here —
      those land in subsequent tasks. The package must build green
      (`npm run build` succeeds) at the end of this task.
    status:
      implement: open
      commit: open

  - id: agent-harness-schema-module
    title: Implement schema host module exposing toolcraft-schema S
    prompt: |
      Add a host module for agent-script that exposes the toolcraft-schema
      builders under the module name `schema`. The builders are pure
      data constructors so no host bridging logic is needed.

      Files to create:
        - packages/agent-harness/src/modules/schema.ts
        - packages/agent-harness/src/modules/schema.test.ts

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `makeSchemaModule`.

      Signature:
        import { S } from "@poe-code/toolcraft-schema";
        export function makeSchemaModule(): { S: typeof S };

      Tests:
        - Round-trip through agent-script's `run()`: a script that does
          `import { S } from "schema"; return S.Object({ x: S.Number() });`
          returns the same descriptor toolcraft-schema would build
          directly.
        - Lint round-trip: passing the module's exports list to
          `lint({ modules })` accepts `import { S } from "schema"`.
        - All filesystem state through memfs (none expected here).
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-pair-resolver
    title: Resolve <name>.md ↔ <name>.ajs in the same directory
    prompt: |
      Add a pair resolver. Given the path to an .md, find its sibling
      .ajs with the same basename in the same directory; given a .ajs,
      find its sibling .md. Either input form must work.

      Files to create:
        - packages/agent-harness/src/loader/pair.ts
        - packages/agent-harness/src/loader/pair.test.ts

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `resolvePair`, `HarnessPair`, `HarnessFs`.

      Signatures:
        type HarnessPair = { ajsPath: string; mdPath: string;
                              basename: string };
        type HarnessFs = {
          stat(path: string): Promise<{ isFile(): boolean }>;
        };
        function resolvePair(
          inputPath: string,
          fs?: HarnessFs
        ): Promise<HarnessPair>;

      Behavior:
        - Accept either `.md` or `.ajs` input; compute the sibling.
        - Both files must exist and be regular files. Otherwise throw a
          `MissingPairError` naming which side is missing.
        - Reject inputs whose extension is neither `.md` nor `.ajs`
          with a typed error.
        - `basename` is the shared stem.

      Tests use memfs per CLAUDE.md. Cover: pair with both, missing
      .ajs, missing .md, wrong extension input, directory passed
      instead of file.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-discovery
    title: Discover harness pairs in .poe-code/harnesses/
    prompt: |
      Walk a root directory and return all valid harness pairs found in
      first-level subdirectories. Project-level results take precedence
      over user-level when paths conflict.

      Files to create:
        - packages/agent-harness/src/discovery/discover.ts
        - packages/agent-harness/src/discovery/discover.test.ts

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `discoverHarnesses`.

      Signature:
        function discoverHarnesses(
          rootDir: string,
          fs?: HarnessFs
        ): Promise<HarnessPair[]>;

      Behavior:
        - For each immediate subdirectory of rootDir, look for a
          `<dir>/<dir>.md` + `<dir>/<dir>.ajs` pair using the resolver
          from the previous task. Skip subdirectories without both.
        - Return results sorted alphabetically by basename.
        - Do not recurse beyond one level — harnesses live in their own
          named directory.
        - Missing rootDir resolves to `[]` (not an error).

      Tests with memfs: empty root, one valid pair, multiple pairs,
      half-valid subdir (just .md), unrelated files mixed in, missing
      root.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-extract-schema
    title: Extract `export const schema` initializer from .ajs
    prompt: |
      Extract the schema descriptor declared in a .ajs file's
      `export const schema = ...` initializer. Use a sandboxed evaluation
      with only the `schema` host module bound and a tight budget.

      Files to create:
        - packages/agent-harness/src/loader/extract-schema.ts
        - packages/agent-harness/src/loader/extract-schema.test.ts

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `extractSchema`.

      Signature:
        function extractSchema(
          ajsSource: string,
          ajsPath: string
        ): Promise<SchemaDescriptor | undefined>;

      Behavior:
        - Parse the .ajs into a Module AST (use agent-script's parse).
        - Use `findExportedConstInitializer(module, "schema")`. If
          undefined, return undefined.
        - Synthesize a minimal source string of the form
          `import { S } from "schema"; return <init-source>;` using the
          original initializer's source span. Run it through
          agent-script's `run()` with only `makeSchemaModule()` bound
          and a small budget.
        - On runtime error, throw with a message that points at
          ajsPath and explains the schema initializer must be pure
          (only `schema` module imports allowed).
        - Return the awaited descriptor.

      Tests:
        - Returns undefined when the script has no export const schema.
        - Returns the correct descriptor for a simple S.Object schema.
        - Returns the correct descriptor for a nested schema using
          S.Optional, S.Enum, S.Array.
        - Throws with a clear message when the initializer references
          an identifier other than `S` or attempts an `import { ... }
          from "agent"`.
        - Tight budget rejects non-terminating initializers.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-validate-frontmatter
    title: Validate .md frontmatter against a SchemaDescriptor
    prompt: |
      Wrap toolcraft-schema's `validate()` with friendlier error
      formatting suited to surfacing validation issues in CLI output.

      Files to create:
        - packages/agent-harness/src/loader/validate.ts
        - packages/agent-harness/src/loader/validate.test.ts

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `validateFrontmatter`, `FrontmatterValidationError`.

      Signature:
        function validateFrontmatter(
          schema: SchemaDescriptor,
          frontmatter: Record<string, unknown>,
          mdPath: string
        ): Record<string, unknown>; // typed to Static<typeof schema>
                                    // when the caller has the type

      Behavior:
        - Call toolcraft-schema's `validate(schema, frontmatter)`.
        - On ok:true return `value` (with defaults applied).
        - On ok:false throw a `FrontmatterValidationError` whose message
          lists each issue as `<mdPath>: <dotted.path>: <message>` on
          its own line. Include the original issues array as an
          `issues` property on the error.

      Tests cover ok path with defaults, single-issue rejection,
      multi-issue rejection, empty frontmatter against a schema with
      required fields. memfs only if you read the .md; this function
      itself takes a parsed object, no fs needed.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-run
    title: Implement runHarnessPair end-to-end
    prompt: |
      Public entry point that runs a harness pair: lock, read both
      files, split frontmatter, extract schema, validate frontmatter,
      execute the .ajs with import.meta + entryPointArgs wired.

      Files to create:
        - packages/agent-harness/src/loader/run.ts
        - packages/agent-harness/src/loader/run.test.ts

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `runHarnessPair`, `RunHarnessPairOptions`,
          `HarnessImportMeta`.

      Signatures:
        type HarnessImportMeta = {
          kind: string | undefined;
          version: number | undefined;
          filename: string;
          dirname: string;
          body: string;
        };
        type RunHarnessPairOptions = {
          modulesFor: (
            frontmatter: Record<string, unknown>,
            meta: HarnessImportMeta
          ) => ModuleRegistry;
          signal?: AbortSignal;
          snapshotPath?: string;
        };
        function runHarnessPair(
          mdPath: string,
          options: RunHarnessPairOptions
        ): Promise<RunResult>;

      Wiring:
        - Resolve pair via resolvePair.
        - Acquire the workflow lock via @poe-code/agent-harness-tools'
          `lockWorkflow(mdPath)`. Release on completion or error.
        - Read .ajs and .md sources.
        - Split .md frontmatter + body using agent-script's
          `splitFrontmatter`.
        - Lint the .ajs with `allowedExportNames: ["schema"]`. Throw
          on errors.
        - Extract schema. If present, validateFrontmatter; otherwise
          pass raw frontmatter through.
        - Build `meta: HarnessImportMeta = { kind: validated.kind,
          version: validated.version, filename: mdPath,
          dirname: dirname(mdPath), body }`.
        - Build modules via `options.modulesFor(validated, meta)`,
          plus `schema: makeSchemaModule()` (in case the entry needs
          it — keep it available).
        - Call agent-script's `run(ajsSource, { modules, importMeta:
          meta, entryPointArgs: [validated], signal: options.signal,
          snapshotPath: options.snapshotPath })`.
        - Default snapshotPath when not provided: under the runner's
          run-log dir from `resolveRunLogDir({ planPath: mdPath,
          runner: "harness", homeDir: os.homedir() })`.

      Tests with memfs:
        - happy path: validates frontmatter, invokes default export
          with the validated value, returns its result.
        - missing schema: passes raw frontmatter through.
        - failing validation: throws with mdPath + field path; lock
          released; snapshot file not touched.
        - missing default export: lint error from the inner lint pass.
        - top-level `return` in .ajs: lint warning only, run still
          succeeds.
        - resume: with a snapshotPath pointing to a snapshot from a
          previous aborted run, the entry resumes from the next host
          call. Build this by aborting via signal mid-run, then
          re-invoking with the same path.
        - concurrent run: second invocation against same .md while the
          first holds the lock errors with EEXIST.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-templates
    title: Ship four demo template pairs
    prompt: |
      Ship four demo harness pairs as built-in templates. Each pair is
      one `.ajs` orchestrator + one `.md` plan with default frontmatter.
      Names use `*-demo` suffix to keep `kind` values and `$schema`
      URLs distinct from the existing experiment / ralph / pipeline /
      superintendent runners (which are not touched by this work).

      Files to create:
        - packages/agent-harness/src/templates/ralph-demo/ralph-demo.ajs
        - packages/agent-harness/src/templates/ralph-demo/ralph-demo.md
        - packages/agent-harness/src/templates/experiment-demo/experiment-demo.ajs
        - packages/agent-harness/src/templates/experiment-demo/experiment-demo.md
        - packages/agent-harness/src/templates/pipeline-demo/pipeline-demo.ajs
        - packages/agent-harness/src/templates/pipeline-demo/pipeline-demo.md
        - packages/agent-harness/src/templates/superintendent-demo/superintendent-demo.ajs
        - packages/agent-harness/src/templates/superintendent-demo/superintendent-demo.md
        - packages/agent-harness/src/templates/index.ts — exports
          `listBuiltinTemplates()` returning the four pairs with
          kind + paths.
        - packages/agent-harness/src/templates/index.test.ts — fixture
          tests that for each template: lints clean with
          allowedExportNames: ["schema"]; the schema initializer
          extracts; the default `.md` frontmatter validates against
          the extracted schema; running with a stub `agent` module
          completes and returns a non-error result.

      Each `.ajs` uses:
        import { S } from "schema";
        import { spawn } from "agent";
        // optional: import { event } from "log";
        export const schema = S.Object({ ... });
        export default async (frontmatter) => { ... };

      No top-level `return`. No manual signal / abort handling. Use
      `import.meta` for `kind`, `filename`, `dirname`, `body`. Inside
      each entry, drive the loop using the existing
      packages/agent-script/examples/{experiment,pipeline,superintendent}.md
      bodies as design references for what each demo should *do*, not
      as imports.

      Files to change:
        - packages/agent-harness/src/index.ts — re-export
          `listBuiltinTemplates`.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-codegen
    title: Codegen *.schema.json from agent-harness templates
    prompt: |
      Walk the built-in template directory, statically extract each
      template's `export const schema`, run it through
      `toolcraft-schema`'s `toJsonSchema`, and emit
      `docs/schemas/harnesses/<kind>.schema.json`. Wire the script
      into `npm run build` *alongside* the existing
      `codegen:plan-schemas` — do not modify, replace, or remove
      `codegen:plan-schemas` or any file under `docs/schemas/plans/`.

      Files to create:
        - packages/agent-harness/src/codegen/emit-schemas.ts
        - packages/agent-harness/src/codegen/emit-schemas.test.ts
        - scripts/generate-harness-schemas.ts — one-line wrapper that
          calls the package entry.
        - docs/schemas/harnesses/.gitkeep — placeholder so the empty
          directory is tracked.

      Files to change:
        - package.json — add `"codegen:harness-schemas":
          "tsx scripts/generate-harness-schemas.ts"` to scripts; append
          it to the `build` chain right after `codegen:plan-schemas`.
          Use deep-merge / parse — do not regex over package.json (per
          CLAUDE.md).
        - packages/agent-harness/src/index.ts — re-export
          `runHarnessCodegen` (the package-level entrypoint).

      Signature of the package entry:
        function runHarnessCodegen(options?: {
          fs?: { mkdir; writeFile };
          repoRoot?: string;
        }): Promise<void>;

      Output format mirrors scripts/generate-plan-schemas.ts: sorted
      JSON keys, $id pointing at the public docs URL
      `https://poe-platform.github.io/poe-code/schemas/harnesses/<kind>.schema.json`,
      $schema set to draft 2020-12.

      Tests use memfs to assert the four expected files are written
      with the expected $id and a stable key order. Do not write to
      the real filesystem.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-harness-cli
    title: Add `poe-code harness {run,new,list}` CLI command
    prompt: |
      Register a new top-level command `harness` exposing three
      subcommands: `run`, `new`, `list`. Implement using the project's
      design-system primitives — do not import @clack/prompts or chalk
      directly (CLAUDE.md). Per CLAUDE.md, every CLI option must also
      be accepted as an arg so the command is usable in CI; defaults
      are accepted only with `--yes`.

      Files to create:
        - src/cli/commands/harness.ts
        - src/cli/commands/harness-command.test.ts

      Files to change:
        - src/cli/index.ts (or wherever commands register) — register
          the new `harness` command. Do not edit registrations for
          `experiment`, `ralph`, `pipeline`, or `superintendent`.

      Subcommand behavior:
        - `poe-code harness run [<md-path>] [--yes]`: if md-path given,
          run that pair via runHarnessPair. If omitted, discover
          harnesses from `.poe-code/harnesses/` (project) then
          `~/.poe-code/harnesses/` (user); 0 → error, 1 → run it,
          >1 → interactive select (or fail with "ambiguous, pass a
          path" under --yes).
        - `poe-code harness new <kind> <basename> [--dir <path>]
          [--yes]`: scaffold a new pair from a built-in template under
          `--dir` (defaults to `.poe-code/harnesses/<basename>/`).
          Refuse to overwrite existing files.
        - `poe-code harness list`: print discovered pairs as a table
          (basename, dir, .md mtime).

      Tests:
        - Unit tests via the existing CLI test harness (mock fs, mock
          spawn). Cover: run with explicit path, run with discovery,
          new with missing template, new refusing to overwrite, list
          empty / list multiple.
        - After implementation, run a screenshot validation per
          CLAUDE.md: `npm run screenshot-poe-code -- harness --help`
          and one of `harness list` against a fixture directory, to
          verify the visual surface is consistent with other commands.
          Do not commit screenshot tests; screenshots are for ad-hoc
          validation only.
    status:
      implement: open
      test: open
      commit: open
---

# Context

`@poe-code/agent-harness` is a new experimental package that runs **harness pairs**: a `<name>.ajs` orchestrator paired with a sibling `<name>.md` plan. The orchestrator is agent-script source; the markdown carries YAML frontmatter (validated against a schema declared inside the `.ajs`) and a body the orchestrator can use as a prompt. This is a parallel track — the existing `experiment-loop` / `ralph` / `pipeline` / `superintendent` packages and their CLI commands are **not** modified, replaced, or migrated. Parity is a future plan.

## Canonical .ajs shape

```js
import { S } from "schema";
import { spawn } from "agent";
import { event } from "log";

export const schema = S.Object({
  iterations: S.Optional(S.Number({ minimum: 1, default: 3 })),
  agent: S.Optional(S.String({ default: "claude-code" })),
});

export default async (frontmatter) => {
  const { kind, filename, body } = import.meta;
  for (let i = 0; i < frontmatter.iterations; i++) {
    const r = await spawn({ agent: frontmatter.agent, prompt: body });
    event("iteration.completed", { kind, file: filename, i, summary: r.summary });
  }
};
```

Rules:

- **`export default`** — required. Async arrow only. Receives the validated frontmatter as its single argument. Its return value is the harness result.
- **`export const schema`** — optional. If present, the loader evaluates it in a sandboxed pre-pass with only the `schema` host module bound, then validates the `.md` frontmatter against it.
- **`import.meta`** — exposes `{ kind, version, filename, dirname, body }` of the **paired `.md`** (mirroring Node's ESM extensions; `body` is harness-specific).
- **No top-level `return`** in the new shape. **No manual signal / abort handling** — the agent-script interpreter aborts between host calls automatically; the snapshot scheduler persists progress; `restore()` resumes.

## Subset extensions to agent-script

Three additions, top-level only:

- `ExportNamedDeclaration` — `export const NAME = expr;` (single declarator, allowlist-controlled name).
- `ExportDefaultDeclaration` — `export default expr;` (must be an arrow expression, exactly one per file).
- `MetaProperty` for `import.meta` — sandbox value injected via a new `RunOptions.importMeta`. Cannot be assigned to.

`run()` gains `entryPointArgs?: readonly unknown[]` — when set, the runtime invokes the resolved default export with these args after evaluating the module top-level, and that result becomes `returnValue`.

## Two-pass loader

```ts
async function runHarnessPair(mdPath, options) {
  // pair, lock, read both files
  // pass 1: lint + extract `export const schema` initializer + sandboxed eval
  // validate .md frontmatter against the schema (pass-through if absent)
  // pass 2: agent-script run() with importMeta + entryPointArgs
}
```

The schema is extracted with `findExportedConstInitializer` and evaluated through agent-script's `run()` with only `makeSchemaModule()` bound and a tight budget. The schema initializer that imports anything other than `schema` is rejected at lint time.

## Cross-cutting concerns reuse `@poe-code/agent-harness-tools`

- **Lock**: `lockWorkflow(mdPath)` before pass 1; release on completion or error.
- **Run logs**: `resolveRunLogDir({ planPath: mdPath, runner: "harness", homeDir })` for log directory.
- **Snapshot**: written under the run-log dir; agent-script's existing `restore()` validates source-hash match before resuming.

## Codegen

`codegen:harness-schemas` walks `packages/agent-harness/src/templates/*/`, statically loads each `.ajs`'s `export const schema`, and emits `docs/schemas/harnesses/<kind>.schema.json` via `toJsonSchema(schema)`. Added to the `build` chain **alongside** the existing `codegen:plan-schemas`. Output path is new — there is no overlap with `docs/schemas/plans/*.schema.json`.

## Edge cases

- No `export const schema` → frontmatter passes through raw to the entry. Allowed.
- Missing pair (.md without .ajs or vice versa) → hard error.
- Schema initializer references non-`schema` module → lint error before evaluation.
- Default export not an arrow → lint error.
- Frontmatter fails validation → runner exits non-zero with mdPath + dotted field path; snapshot untouched.
- Source hash drift on resume → existing `restore()` rejects the snapshot, run starts fresh.
- Concurrent runs against same `.md` → second errors with `EEXIST`.
- `import.meta` aliasing (`const m = import.meta`) → supported; member access works because MetaProperty resolves to a sandbox object.

## Public API surface

```ts
// @poe-code/agent-harness
export type HarnessImportMeta = {
  kind: string | undefined;
  version: number | undefined;
  filename: string;
  dirname: string;
  body: string;
};
export type HarnessPair = { ajsPath: string; mdPath: string; basename: string };
export type RunHarnessPairOptions = {
  modulesFor: (frontmatter: Record<string, unknown>, meta: HarnessImportMeta) => ModuleRegistry;
  signal?: AbortSignal;
  snapshotPath?: string;
};
export function resolvePair(inputPath: string, fs?: HarnessFs): Promise<HarnessPair>;
export function discoverHarnesses(rootDir: string, fs?: HarnessFs): Promise<HarnessPair[]>;
export function extractSchema(ajsSource: string, ajsPath: string): Promise<SchemaDescriptor | undefined>;
export function validateFrontmatter(schema: SchemaDescriptor, frontmatter: Record<string, unknown>, mdPath: string): Record<string, unknown>;
export function runHarnessPair(mdPath: string, options: RunHarnessPairOptions): Promise<RunResult>;
export function makeSchemaModule(): { S: typeof S };
export function listBuiltinTemplates(): readonly { kind: string; ajsPath: string; mdPath: string }[];
export function runHarnessCodegen(options?: { fs?: { mkdir; writeFile }; repoRoot?: string }): Promise<void>;

// @poe-code/agent-script — additions
export type RunOptions = { /* existing */ importMeta?: Record<string, unknown>; entryPointArgs?: readonly unknown[] };
export type ExportNamedDeclaration; ExportDefaultDeclaration; MetaProperty;
export function findExportedConstInitializer(module: Module, name: string): Expression | undefined;

// @poe-code/toolcraft-schema — additions
export type ValidationIssue = { path: readonly string[]; expected: string; received: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: readonly ValidationIssue[] };
export function validate<S extends SchemaDescriptor>(schema: S, value: unknown): ValidationResult<Static<S>>;
```

## Out of scope

- No changes to `experiment-loop`, `ralph`, `pipeline`, `superintendent` packages.
- No changes to their CLI commands or dashboards.
- No changes to `scripts/generate-plan-schemas.ts` or any file under `docs/schemas/plans/`.
- No deletion of `packages/agent-script/examples/*.md` legacy single-file harnesses.
