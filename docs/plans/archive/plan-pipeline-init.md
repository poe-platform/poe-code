---
tasks:
  - id: init-prompt-and-sources
    title: Add init prompt builder and source discovery helpers
    prompt: |
      Add two self-contained helpers that the new `pipeline init` command will
      consume. Put both in a new file
      `src/cli/commands/pipeline-init.ts` so the main command file stays focused.

      1. `buildPipelineInitPrompt` — mirrors `buildPlanPrompt` in
         `src/cli/commands/plan.ts:52`. Composes a single prompt string by
         embedding the pipeline skill template plus "User request" and
         "Source document" sections. Inputs: `{ question?: string,
         planDirectory: string, sourceDocPath: string, sourceDocContent: string,
         skillContent: string }`. When the question is empty, include the
         skill's "If The Request Is Empty" fallback instruction (same
         convention used in `buildPlanPrompt`).

      2. `discoverPipelineInitSources` — returns
         `Array<{ absolutePath: string; relativePath: string; title: string }>`
         for Markdown files under the plan-command's plan directory (default
         `docs/plans`, configurable — reuse `resolvePlanDirectory` from
         `src/cli/commands/plan.ts`). Exclude files under `archive/` and
         files that already have a matching `plan-*.md` or `plan-*.yaml`
         sibling in the pipeline plans directory returned by
         `resolvePlanDirectory` from `@poe-code/pipeline`. `title` is the
         first `# Heading` in the file, falling back to the basename.

      Tests live in `src/cli/commands/pipeline-init.test.ts` and MUST use
      `memfs` per CLAUDE.md. Cover:
        - prompt builder with and without a question;
        - prompt builder with source content containing triple-backticks;
        - discovery excludes `archive/*`;
        - discovery excludes files that already have a matching plan file;
        - title falls back to the basename when the file has no `#` heading.

      Do NOT wire this into the CLI in this task. Do NOT add any regex-based
      YAML parsing.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: init-sdk-runner
    title: Add SDK entry point that spawns the agent for each selected source
    prompt: |
      Add `runPipelineInit` to `src/sdk/pipeline.ts`, mirroring the shape and
      style of the existing `runPipeline` in the same file.

      Inputs:
      ```
      {
        agent: string;
        model?: string;
        cwd: string;
        homeDir: string;
        planDirectory?: string;
        sources: Array<{ absolutePath: string; relativePath: string; title: string }>;
        question?: string;
        assumeYes: boolean;
        runAgent?: (...) => Promise<...>; // reuse the type used by runPipeline
        signal?: AbortSignal;
        onSourceStart?(source, index, total): void;
        onSourceComplete?(source, index, total, result): void;
      }
      ```

      For each source:
        1. Read the source Markdown file via `node:fs/promises` (matching how
           `runPipeline` reads files, or whatever fs abstraction it already
           uses).
        2. Build the prompt by importing `buildPipelineInitPrompt` from
           `src/cli/commands/pipeline-init.ts`. Pass the skill template
           imported via `../../templates/pipeline/SKILL_plan.md` using the
           same asset-import pattern already present in
           `src/cli/commands/pipeline.ts` (see the `loadPipelineTemplates`
           helper — reuse it if practical, otherwise replicate the import).
        3. Spawn via `sdkSpawn` from `./spawn.js` with
           `{ prompt, cwd, model, mode: "yolo" }` and await the result. The
           agent writes the plan file itself because the skill instructs it to.
        4. If `signal` aborts between sources, stop and return
           `stopReason: "cancelled"`. If a spawn fails, return
           `stopReason: "failed"` with `failedSource: relativePath`.

      Return:
      ```
      {
        stopReason: "done" | "failed" | "cancelled";
        sourcesProcessed: number;
        failedSource?: string;
      }
      ```

      Tests go in `src/sdk/pipeline-init.test.ts`. Use `memfs` for all file
      IO and inject `runAgent` to avoid real agent spawns or LLM calls. Cover:
      happy path with two sources, one-failed-stops-the-loop, and abort
      between sources.

      Do NOT register the CLI command in this task. Do NOT add anything to
      `@poe-code/pipeline` — the new SDK entry lives in the root `poe-code`
      package.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: init-command
    title: Register `pipeline init` CLI subcommand with multiselect
    prompt: |
      Register a new `pipeline init` subcommand in
      `src/cli/commands/pipeline.ts`, next to the existing `pipeline run`,
      `pipeline validate`, `pipeline plan-path`, and `pipeline install`
      subcommands. Flags:

        --agent <name>          Agent to generate the plan with (default
                                `claude-code`, same as run/install).
        --model <model>         Model override passed to the agent.
        --source <path>         Single source Markdown doc to convert.
        --sources <paths...>    Multiple source Markdown docs; mutually
                                exclusive with `--source` (throw
                                `ValidationError` if both set — follow the
                                `--plan`/`--plans` pattern at
                                `src/cli/commands/pipeline.ts:684`).
        [question]              Optional trailing positional forwarded to
                                the prompt as the user question.

      Behavior:
        1. When no `--source`/`--sources` is provided and the shell is
           interactive (`!flags.assumeYes`), call
           `discoverPipelineInitSources` then present a `multiselect` from
           `@poe-code/design-system` exactly as `pipeline run` multiselects
           plans (see `src/cli/commands/pipeline.ts:696-720`). Cancel
           gracefully on `isCancel`.
        2. When `--yes` is set and no sources are provided, throw
           `ValidationError("Provide --source or --sources when using --yes.")`.
        3. Resolve the agent the same way `pipeline run` does
           (`resolvePipelineAgent`, `select` among `supportedAgents`).
        4. Call `runPipelineInit` from `src/sdk/pipeline.ts`. Use the same
           `intro`/`finalize` pattern as `pipeline run`. Log per-source
           progress via `resources.logger.info` and completion via
           `resources.logger.success`.

      Tests go in `src/cli/commands/pipeline-command.test.ts` (existing
      file). Mirror the style there: `memfs`, injected container, stub
      `runPipelineInit`. Cover: both flags set => ValidationError; `--yes`
      without sources => ValidationError; happy path with two sources.

      Do NOT modify `pipeline run`, `pipeline validate`, `pipeline plan-path`,
      or `pipeline install`. After implementation:
        - `npm run dev -- pipeline init --help` should render the command.
        - `npm run screenshot-poe-code -- pipeline init --help` per the
          CLAUDE.md visual-testing rule.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# Context

Add a new `pipeline init` CLI command that generates pipeline plan files from
existing Markdown design docs. It mirrors the UX of `pipeline run`: when the
user doesn't supply `--source`/`--sources`, they pick candidate source docs via
a multiselect. For each selected source the command spawns the configured
agent with the pipeline skill template embedded in the prompt, plus the source
doc content as context. The agent writes a Markdown-with-frontmatter pipeline
plan to the plans directory.

## Relevant files

- `src/cli/commands/pipeline.ts` — existing `run`/`validate`/`plan-path`/
  `install` subcommands; new `init` goes here.
- `src/cli/commands/plan.ts` — reference implementation for embedding a skill
  template into a prompt (`buildPlanPrompt`, `runPlanSession`).
- `src/templates/pipeline/SKILL_plan.md` — the pipeline-plan skill embedded in
  the prompt.
- `src/sdk/pipeline.ts` — SDK surface for pipeline runs; `runPipelineInit` goes
  here.
- `packages/pipeline/src/plan/discovery.ts` — existing plan discovery, useful
  reference.
- `.poe-code/pipeline/steps.yaml` — defines project step order:
  implement → refactor → test → commit (teardown inherited).

## Non-goals

- Updating `pipeline run`, `validate`, `plan-path`, or `install`.
- Adding new exports from `@poe-code/pipeline`.
- Any regex-based YAML parsing (parse via existing library usage only).
