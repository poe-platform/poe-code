---
kind: pipeline
version: 1
vars:
  plan_doc: "{{file 'docs/plans/plan-extends.md'}}"
tasks:
  - id: scaffold
    title: Scaffold config-extends package with types
    prompt: >
      Plan: {{plan_doc}}


      Create `packages/config-extends/` following existing package conventions (see
      `packages/agent-defs/` for reference):

      - `package.json`: `@poe-code/config-extends`, private, type module, dependencies:
      `gray-matter`, `yaml`

      - `tsconfig.json`: extends root

      - `src/types.ts` with the types from the plan:
        - `DataLayer` (source + data), `DocumentLayer` (source + filePath + content), `BaseLayer` (source + path)
        - `ChainLayer` = union of the three
        - `ResolveOptions` (fs, autoExtend?)
        - `ResolvedDocument` (data, sources, chain)
        - `ParsedDocument` (data, format, extends: boolean)
        - `FileSystem` (readFile)
      - `src/index.ts`: empty re-exports for now

      - `README.md`


      Wire into root workspace, run `npm install`.
    status:
      implement: done
      test: done
      commit: done
  - id: parser
    title: Document parser for md, yaml, and json
    prompt: >
      Plan: {{plan_doc}}


      Create `packages/config-extends/src/parse.ts` with `parseDocument(content, filePath)`.


      Key behavior:

      - Detect format by file extension: `.md` → markdown, `.yaml`/`.yml` → YAML, `.json` → JSON

      - Fallback when no recognized extension: starts with `{` → JSON, starts with `---\n` (after
      optional BOM) → markdown, otherwise → YAML

      - Markdown: use `gray-matter` to split frontmatter + body. Body becomes `data.prompt`.

      - YAML: parse with `yaml` library. All keys go into `data`.

      - JSON: `JSON.parse()`. All keys go into `data`.

      - Extract `extends` as boolean from data and strip it. Only `extends: true` is valid — any
      other value is ignored.

      - Return `ParsedDocument`: `{ data, format, extends }`.


      `prompt` is NOT a separate field — it lives in `data.prompt`.


      TDD — write tests first in `packages/config-extends/src/parse.test.ts`:

      - Markdown with frontmatter + body → `data` has frontmatter keys + `prompt` from body

      - YAML with prompt key → `data.prompt` populated

      - JSON with prompt key → `data.prompt` populated

      - Markdown without body → `data.prompt` is empty string

      - YAML/JSON without prompt key → no `data.prompt`

      - `extends: true` extracted as true, stripped from data

      - `extends: "something"` → ignored (not a boolean), stays in data? No — stripped and extends
      is false

      - No extends field → extends is false

      - BOM handling for markdown

      - Invalid YAML → throws

      - Invalid JSON → throws

      - Format detection by extension (.md, .yaml, .yml, .json)

      - Format detection by content fallback when extension not recognized


      Export `parseDocument` from `src/index.ts`.
    status:
      implement: done
      test: done
      commit: done
  - id: discovery
    title: Base template discovery
    prompt: >
      Plan: {{plan_doc}}


      Create `packages/config-extends/src/discover.ts` with `findBase(name, bases, fs)`:

      - `name`: the base name to look up (derived from document filename, e.g. "review" from
      "review.md")

      - `bases`: ordered array of directory paths (from base layers in the chain)

      - For each directory, check for `<name>.md`, `<name>.yaml`, `<name>.yml`, `<name>.json` in
      that order

      - Return first match: `{ content, filePath }`

      - Throw listing all checked paths if nothing found

      - Gracefully skip directories that don't exist (ENOENT)


      TDD — write tests first in `packages/config-extends/src/discover.test.ts` using memfs:

      - Finds `.md` in first directory

      - Finds `.yaml` in second directory when first has no match

      - Finds `.yml` variant

      - Finds `.json` variant

      - Prefers first directory over second (order matters)

      - Prefers `.md` over `.yaml` over `.yml` over `.json` in same dir

      - Throws with all checked paths when not found

      - Skips missing directories gracefully (no ENOENT crash)


      Export `findBase` from `src/index.ts`.
    status:
      implement: done
      test: done
      commit: done
  - id: merge
    title: Deep merge logic for layered resolution
    prompt: >
      Plan: {{plan_doc}}


      Create `packages/config-extends/src/merge.ts` with `mergeLayers(layers)`:


      Input: ordered array of `{ source: string; data: Record<string, unknown> }`.


      Deep merge (this is the only mode — no shallow option):

      - Walk layers in order. For each key, first non-undefined value wins.

      - When both the current winner and a later layer have a plain object at the same key,
      recursively merge (later layer fills gaps, doesn't override existing keys).

      - Arrays: first defined wins (no recursive merge into arrays).

      - `null` counts as defined — stops the chain for that field.

      - For the `prompt` key specifically: first non-empty string wins (empty string falls through).

      - Return `{ data, sources }` where `sources` maps each key to the source label it came from.


      TDD — write tests first in `packages/config-extends/src/merge.test.ts`:

      - Single layer → returns as-is, source is that layer

      - Two layers: first wins when both define same scalar

      - Two layers: second fills fields missing from first

      - Null in first stops chain (doesn't fall through)

      - Undefined in first falls through to second

      - Prompt: first non-empty wins

      - Prompt: empty string falls through

      - Sources map tracks which layer each field came from

      - Three layers: correct priority ordering

      - Array values: first defined wins, no merging

      - Nested objects: `{ a: { x: 1 } }` + `{ a: { y: 2 } }` → `{ a: { x: 1, y: 2 } }`

      - Nested objects: first layer's nested key wins when both define same key

      - Arrays inside nested objects: first defined wins

      - Non-object over object at same key: first defined wins


      Export `mergeLayers` from `src/index.ts`.
    status:
      implement: done
      test: done
      commit: done
  - id: resolver
    title: Chain resolver with extends and autoExtend
    prompt: >
      Plan: {{plan_doc}}


      Create `packages/config-extends/src/resolve.ts` with:


      ```typescript

      async function resolve(chain: ChainLayer[], options: ResolveOptions):
      Promise<ResolvedDocument>

      ```


      Algorithm:

      1. Classify layers structurally:
         - `"data" in layer` → data layer
         - `"filePath" in layer && "content" in layer` → document layer
         - `"path" in layer` → base layer
      2. Exactly one document layer required. Zero or multiple → error.

      3. Parse the document via `parseDocument(content, filePath)`.

      4. Determine extends:
         - `extends: true` → derive name from filePath (basename without extension)
         - No extends + `autoExtend: true` → same behavior
         - Otherwise → skip extends resolution
      5. If extending: collect base layer paths in chain order, call `findBase(name, basePaths,
      fs)`.
         - Parse the base. If it also has `extends: true`, resolve recursively.
         - Track visited file paths. Throw on cycle. Max depth 5.
         - `autoExtend + no base found` → silently skip (no error).
         - `extends: true + no base found` → throw with checked paths.
      6. Build merge layers in chain order:
         - Data layers before the document (overrides)
         - Document (parsed data)
         - Resolved base (if extends resolved)
         - Data layers after the document (fallbacks)
      7. Call `mergeLayers(layers)` and return `ResolvedDocument`.


      TDD — write tests first in `packages/config-extends/src/resolve.test.ts` using memfs:

      - Document + data layers, no extends → deep merge in chain order

      - Document with `extends: true` + base layers → finds and merges

      - Data layer before document overrides document field

      - Document field overrides data layer after it

      - Base fills fields not in document

      - Data layer after document fills fields not in document or base

      - Nested objects merge across layers (deep merge)

      - `autoExtend: true` without extends field → auto-resolves

      - `autoExtend: true` with no matching base → returns document as-is

      - Chaining: base A extends base B extends base C

      - Depth limit exceeded → error

      - Circular reference detected → error

      - `extends: true` with no matching base → error listing checked paths

      - Cross-format: YAML document extends markdown base

      - Cross-format: JSON document extends YAML base

      - Sources map shows correct source for each field

      - Chain array lists resolved file paths

      - `resolve([...], { fs })` returns as expected from `resolveDocument`


      Export `resolve` from `src/index.ts`.
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-experiment-docs
    title: Integrate config-extends into experiment-loop docs
    prompt: >
      Plan: {{plan_doc}}


      Integrate the chain-based `resolve()` from `@poe-code/config-extends` into experiment-loop.


      In `packages/experiment-loop/src/run/loop.ts`:

      - After reading the raw doc content, build and resolve the chain:
        ```typescript
        import { resolve } from "@poe-code/config-extends";

        const resolved = await resolve([
          { source: "cli",      data: { agent: options.agent } },
          { source: "document", filePath: absoluteDocPath, content: rawContent },
          { source: "base",     path: path.join(options.cwd, ".poe-code/experiments/bases") },
          { source: "base",     path: path.join(options.homeDir, ".poe-code/experiments/bases") },
          { source: "defaults", data: { agent: "claude-code" } },
        ], { fs });
        ```
      - Use `resolved.data` to extract frontmatter fields (agent, metric, baseline, maxExperiments,
      metricTimeout)

      - Use `resolved.data.prompt` for the body

      - The existing frontmatter validation can still type-narrow the resolved data


      In `packages/experiment-loop/src/frontmatter/frontmatter.ts`:

      - Add `extends?: boolean` to `ExperimentFrontmatter`


      Add `@poe-code/config-extends` as dependency in `packages/experiment-loop/package.json`.


      Add tests to `packages/experiment-loop/src/experiment-loop.test.ts`:

      - Experiment doc with `extends: true` inherits base metric and body

      - CLI agent overrides document agent

      - Document agent overrides defaults agent

      - No extends → backward compatible, works exactly as before
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-experiment-runyaml
    title: Integrate config-extends into experiment run.yaml
    prompt: >
      Plan: {{plan_doc}}


      Replace the first-match cascade in `packages/experiment-loop/src/config/loader.ts`
      `loadRunConfig()` with `resolve()`.


      Currently `loadRunConfig()` checks project `.poe-code/experiments/run.yaml` → global → bundled
      `default-run.yaml`. First match wins — project run.yaml completely replaces the bundled
      default (overwrite semantics).


      IMPORTANT: Do NOT use `autoExtend`. Current behavior is overwrite — project run.yaml stands
      alone by default. Users can opt into merging by adding `extends: true` in their run.yaml.


      ```typescript

      import { resolve } from "@poe-code/config-extends";


      const resolved = await resolve([
        { source: "document", filePath: projectRunYamlPath, content: projectRunYaml },
        { source: "base",     path: path.join(homeDir, ".poe-code/experiments") },
        { source: "base",     path: bundledConfigDir },
      ], { fs });

      // no autoExtend — preserves current overwrite behavior

      ```


      If no project run.yaml exists, fall back to loading the bundled default directly (same as
      before).


      Add tests:

      - Project run.yaml WITHOUT extends → fully replaces bundled default (current behavior)

      - Project run.yaml WITH `extends: true` → merges with bundled default

      - No project run.yaml → bundled default used as-is (backward compatible)
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-gh-workflows
    title: Integrate config-extends into github-workflows prompts
    prompt: >
      Plan: {{plan_doc}}


      Integrate the chain-based `resolve()` from `@poe-code/config-extends` into github-workflows.


      In `packages/github-workflows/src/discover.ts` or `commands.ts`:

      - After reading prompt content, build the chain:
        ```typescript
        import { resolve } from "@poe-code/config-extends";

        const resolved = await resolve([
          { source: "document", filePath: promptPath, content: promptContent },
          { source: "base",     path: path.join(cwd, ".poe-code/github-workflows") },
          { source: "base",     path: path.join(cwd, ".github/workflows") },
          { source: "base",     path: builtInPromptsDir },
          { source: "defaults", data: { agent: "codex" } },
        ], { fs });
        ```
      - Use `resolved.data` for frontmatter fields (agent, allow, prefix, mcp, source, label)

      - Use `resolved.data.prompt` for the prompt body (before variable interpolation)


      A project file with just `extends: true` + `agent: claude-code` inherits the full built-in
      prompt.


      Add `@poe-code/config-extends` as dependency in `packages/github-workflows/package.json`.


      Add tests:

      - Project prompt with `extends: true` inherits built-in prompt body and frontmatter

      - Override agent while inheriting everything else

      - Defaults layer provides agent when neither document nor base defines it

      - No extends → backward compatible
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-gh-variables
    title: Integrate config-extends into github-workflows variables.yaml
    prompt: >
      Plan: {{plan_doc}}


      Replace the spread merge in `packages/github-workflows/src/variables.ts` `loadVariables()`
      with `resolve()` using `autoExtend: true`.


      Currently `loadVariables()` does `{ ...builtInVariables, ...projectVariables }` with empty
      string disabling a variable. The `generateProjectVariablesFile()` creates a commented-out
      template of built-in defaults.


      After: project `variables.yaml` auto-extends built-in `variables.yaml` via config-extends.
      Same semantics — project keys override built-in, empty string disables.


      ```typescript

      import { resolve } from "@poe-code/config-extends";


      const resolved = await resolve([
        { source: "document", filePath: projectVariablesPath, content: projectVariablesContent },
        { source: "base",     path: builtInDir },
      ], { fs, autoExtend: true });

      ```


      For the empty-string-disables-variable behavior: handle post-resolution by filtering out empty
      string values from `resolved.data`, same as current code does.


      `loadVariableStatuses()` and `generateProjectVariablesFile()` may need adjustments to work
      with the new loading mechanism.


      Add tests:

      - Project overrides a built-in variable → override wins

      - Project sets variable to empty string → variable disabled

      - Project adds custom variable → appears in result

      - No project file → built-in defaults used (backward compatible)
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-ralph
    title: Integrate config-extends into ralph
    prompt: |
      Plan: {{plan_doc}}

      Integrate the chain-based `resolve()` from `@poe-code/config-extends` into ralph.

      In `packages/ralph/src/run/ralph.ts`:
      - After reading the raw doc content, build the chain:
        ```typescript
        import { resolve } from "@poe-code/config-extends";

        const resolved = await resolve([
          { source: "cli",      data: { agent: cliArgs.agent, iterations: cliArgs.iterations } },
          { source: "document", filePath: docPath, content: rawContent },
          { source: "base",     path: path.join(cwd, ".poe-code/ralph/bases") },
          { source: "base",     path: path.join(homeDir, ".poe-code/ralph/bases") },
          { source: "defaults", data: { agent: "claude-code", iterations: 3 } },
        ], { fs });
        ```
      - Use `resolved.data` for frontmatter fields (agent, iterations, status)
      - Use `resolved.data.prompt` for the body

      In `packages/ralph/src/frontmatter/frontmatter.ts`:
      - Add `extends?: boolean` to frontmatter parsing

      Add `@poe-code/config-extends` as dependency in `packages/ralph/package.json`.

      Add tests:
      - Ralph doc with `extends: true` inherits base prompt and config
      - CLI iterations overrides document iterations
      - Defaults fill in when document and base don't specify
      - No extends → backward compatible
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-pipeline-config
    title: Integrate config-extends into pipeline config.yaml
    prompt: >
      Plan: {{plan_doc}}


      Replace `loadPipelineConfig()` in `packages/pipeline/src/config/loader.ts` with `resolve()`
      using `autoExtend: true`.


      Currently does `{ ...globalConfig, ...projectConfig }` — project completely overrides global
      keys.


      After: project `config.yaml` auto-extends global `config.yaml`. Deep merge preserves nested
      values.


      ```typescript

      import { resolve } from "@poe-code/config-extends";


      const resolved = await resolve([
        { source: "document", filePath: projectConfigPath, content: projectConfigContent },
        { source: "base",     path: path.join(homeDir, ".poe-code/pipeline") },
      ], { fs, autoExtend: true });

      ```


      If no project config.yaml exists, fall back to global only (same as before).


      Add tests:

      - Project overrides planPath → override wins

      - No project config → global used (backward compatible)

      - Both exist → deep merge
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-pipeline-steps
    title: Integrate config-extends into pipeline steps.yaml
    prompt: >
      Plan: {{plan_doc}}


      Replace `loadResolvedSteps()` in `packages/pipeline/src/config/loader.ts` with `resolve()`.


      Currently does custom merge: `{ ...globalConfig.steps, ...projectConfig.steps }` for steps
      (project step REPLACES global step entirely — loses mode, agent, model), and
      `projectConfig.setup ?? globalConfig.setup` coalescing for hooks.


      IMPORTANT: Do NOT use `autoExtend`. Current behavior is per-step overwrite — project step
      replaces global step entirely. Users can opt into deep merge by adding `extends: true` in
      their steps.yaml.


      ```typescript

      import { resolve } from "@poe-code/config-extends";


      const resolved = await resolve([
        { source: "document", filePath: projectStepsPath, content: projectStepsContent },
        { source: "base",     path: path.join(homeDir, ".poe-code/pipeline") },
      ], { fs });

      // no autoExtend — preserves current per-step overwrite behavior

      ```


      If no project steps.yaml exists, fall back to global only.


      Validate that results match current behavior exactly for existing test cases.


      Add tests:

      - Project step `implement: { prompt: "..." }` → replaces global step entirely (current
      behavior)

      - Project with `extends: true` → deep merges with global (new opt-in)

      - Project adds a new step not in global → appears in result

      - Project defines setup → overrides global setup

      - No project steps → global used (backward compatible)
    status:
      implement: done
      test: done
      commit: done
  - id: integrate-config
    title: Integrate config-extends into poe-code-config
    prompt: >
      Plan: {{plan_doc}}


      Replace `deepMergeDocuments()` in `packages/poe-code-config/src/store.ts` with the chain-based
      `resolve()` using `autoExtend: true`.


      In `packages/poe-code-config/src/store.ts`:

      - Replace `readMergedDocument` to use:
        ```typescript
        import { resolve } from "@poe-code/config-extends";

        const resolved = await resolve([
          { source: "project", filePath: projectConfigPath, content: projectContent },
          { source: "base",    path: globalConfigDir },
        ], { fs, autoExtend: true });
        ```
      - `autoExtend: true` means project config auto-inherits from global without needing `extends:
      true`

      - Deep merge handles nested scopes correctly:
        Global `{ ralph: { agent: "claude-code" } }` + Project `{ ralph: { plan_directory: "docs/" } }`
        → `{ ralph: { agent: "claude-code", plan_directory: "docs/" } }`
      - Remove `deepMergeDocuments` from `merge.ts` if no other callers remain


      Add `@poe-code/config-extends` as dependency in `packages/poe-code-config/package.json`.


      All existing tests in `packages/poe-code-config/` must still pass — behavior should be
      identical.
    status:
      implement: done
      test: done
      commit: done
---

# extends

Archived local pipeline plan converted from YAML during docs cleanup.
