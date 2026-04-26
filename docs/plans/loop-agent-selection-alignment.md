---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: shared-resolve-loop-agent
    title: Add resolveLoopAgent helper in agent-harness-tools
    prompt: |
      Add a shared loop agent resolver in
      packages/agent-harness-tools/src/select-agent.ts and export it from
      packages/agent-harness-tools/src/index.ts.

      Function signature:
        resolveLoopAgent(input: {
          providedAgent?: string,
          configuredDefaultAgent?: string | null,
          frontmatterAgent?: string | string[],
          assumeYes: boolean,
          fallbackAgent: string,
          message: string,
          select: typeof import("@poe-code/design-system").select,
          isCancel: typeof import("@poe-code/design-system").isCancel,
        }): Promise<{ agent: string } | { cancelled: true }>

      Precedence (first defined wins):
        1. providedAgent (CLI --agent)
        2. frontmatterAgent (string only — array case stays caller-side)
        3. configuredDefaultAgent (core.defaultAgent)
        4. assumeYes -> fallbackAgent
        5. interactive `select` over allAgents from @poe-code/agent-defs

      Validate the chosen value via parseAgentSpecifier+resolveAgentId from
      @poe-code/agent-defs and throw a plain Error listing supported agents
      when invalid. Return `{ cancelled: true }` when the prompt is cancelled.

      Add packages/agent-harness-tools/src/select-agent.test.ts covering all
      five precedence rungs, the cancel path, the array-frontmatter rejection
      ("array handled by caller"), and invalid-agent validation. Use plain
      function fakes for select/isCancel; do not import design-system in the
      test. No filesystem, no network.

      Do not modify any loop-runner package in this task.
    status:
      implement: done
      test: done
      commit: done

  - id: wire-pipeline-run
    title: Wire pipeline run/init/install to resolveLoopAgent
    prompt: |
      Replace the three local agent-prompt blocks in
      src/cli/commands/pipeline.ts with calls to resolveLoopAgent from
      @poe-code/agent-harness-tools:
        - run handler around line 714-737 ("Select agent to run pipeline steps with:")
        - init handler around line 913-931 ("Select agent to generate pipeline plans with:")
        - install handler around line 1159-1180 ("Select agent to install the Pipeline skill for:")

      Pass providedAgent=options.agent, configuredDefaultAgent=await
      resolveDefaultAgent(container), assumeYes=flags.assumeYes,
      fallbackAgent=DEFAULT_PIPELINE_AGENT, the existing message string,
      and select+isCancel from @poe-code/design-system. Translate
      `{ cancelled: true }` into the existing cancel("Pipeline ... cancelled.")
      + early return. Run the result through resolvePipelineAgent unchanged.

      Keep DEFAULT_PIPELINE_AGENT and resolvePipelineAgent in place — only
      the prompt scaffolding moves. Do not change CLI flags or surface text.

      Update src/cli/commands/pipeline-command.test.ts so the prompt-cancel
      and config-default scenarios still pass; if the tests stub `select`
      directly, switch them to stubbing the resolver via a small seam (e.g.
      a module-level resolveLoopAgent re-export the test can mock) rather
      than reaching into agent-harness-tools internals.
    status:
      implement: done
      test: done
      commit: done

  - id: wire-experiment-run
    title: Wire experiment run to resolveLoopAgent
    prompt: |
      Replace the agent prompt in src/cli/commands/experiment.ts. The
      relevant block lives in the helper around lines 535-557 used by the
      run handler ("Select agent to run the experiment with:") plus the
      single-agent path inside resolveRunAgent.

      Multi-agent frontmatter (array) keeps its existing fan-out behavior —
      only the single-string case routes through resolveLoopAgent. For that
      case, pass providedAgent=options.agent,
      frontmatterAgent=string-form-of-frontmatter,
      configuredDefaultAgent=await resolveDefaultAgent(container),
      assumeYes=flags.assumeYes, fallbackAgent=DEFAULT_EXPERIMENT_AGENT,
      message="Select agent to run the experiment with:". Run the chosen
      value through resolveExperimentAgent.

      Keep allSpawnConfigs out of the new path — the resolver uses
      allAgents from @poe-code/agent-defs, which is the canonical list.
      Update tests in src/cli/commands/experiment-ralph.test.ts that depend
      on the old prompt or option list.
    status:
      implement: done
      test: done
      commit: done

  - id: wire-ralph-run
    title: Wire ralph run to resolveLoopAgent
    prompt: |
      Replace the agent prompt in src/cli/commands/ralph.ts around lines
      420-442 ("Select agent to run Ralph with:") with resolveLoopAgent
      from @poe-code/agent-harness-tools.

      Pass providedAgent=options.agent,
      frontmatterAgent=resolveConfiguredAgents(...) when it returns a
      string (skip the array case — keep existing fan-out),
      configuredDefaultAgent=await resolveDefaultAgent(container),
      assumeYes=flags.assumeYes, fallbackAgent=DEFAULT_RALPH_AGENT,
      message="Select agent to run Ralph with:". Pipe the result through
      resolveRalphAgent.

      Update tests in src/cli/commands/experiment-ralph.test.ts that touch
      the prompt path. Frontmatter-array iteration behavior must remain
      unchanged.
    status:
      implement: done
      test: done
      commit: done

  - id: wire-superintendent-run
    title: Prompt for builder agent in superintendent run instead of bailing
    prompt: |
      In packages/superintendent/src/commands/run.ts, runSuperintendentCommand
      currently sets `selectedBuilderAgent` from `options.builderAgent ??
      document.frontmatter.builder.agent` (around lines 325-326) and crashes
      when both are empty. Use resolveLoopAgent from
      @poe-code/agent-harness-tools as a fourth fallback.

      Add a `configuredDefaultAgent?: string | null` option on
      RunCommandOptions. Threading: in the runCommand handler (around lines
      122-138 of the same file) read core.defaultAgent via the existing
      readMergedDocument + resolveScope path used by
      resolveSuperintendentCommandConfig and pass it through. Do the same in
      createRunMcpCommand.

      Inside runSuperintendentCommand, after parsing the document, when
      neither options.builderAgent nor document.frontmatter.builder.agent
      yields a value, call resolveLoopAgent with:
        providedAgent: options.builderAgent,
        frontmatterAgent: document.frontmatter.builder.agent,
        configuredDefaultAgent: options.configuredDefaultAgent ?? null,
        assumeYes,
        fallbackAgent: "claude-code",
        message: "Select agent to run Superintendent builder with:",
        select: options.selectPrompt ?? select,
        isCancel,
      On cancellation, log a cancel message and exit cleanly (matching the
      existing exit path used elsewhere in the file).

      Add tests in packages/superintendent/src/commands/run.test.ts:
        - prompts when frontmatter + flag are empty and assumeYes=false
        - returns the configured default when set and no flag/frontmatter
        - falls back to claude-code under assumeYes=true
        - --agent still wins over frontmatter and config
      Stub selectPrompt with a function fake; no real prompts.
    status:
      implement: done
      test: done
      commit: done

  - id: document-loop-agent-resolver
    title: Document resolveLoopAgent in agent-harness-tools README
    prompt: |
      Add a "Loop agent selection" section to
      packages/agent-harness-tools/README.md describing resolveLoopAgent:
      the precedence rungs (CLI flag > frontmatter string > core.defaultAgent
      > --yes fallback > interactive prompt), the cancellation contract, and
      a short note that pipeline, experiment, ralph, and superintendent all
      route through this single function. List which env/config keys feed
      `configuredDefaultAgent` (`core.defaultAgent`) so the README's
      "env/config" inventory stays complete per CLAUDE.md.

      No code changes outside the README.
    status:
      implement: done
      commit: done
---

# Context

Today each loop has its own copy of "select an agent" UX:

- [src/cli/commands/pipeline.ts:724](src/cli/commands/pipeline.ts#L724) — pipeline run
- [src/cli/commands/pipeline.ts:919](src/cli/commands/pipeline.ts#L919) — pipeline init
- [src/cli/commands/pipeline.ts:1167](src/cli/commands/pipeline.ts#L1167) — pipeline install
- [src/cli/commands/experiment.ts:545](src/cli/commands/experiment.ts#L545) — experiment run
- [src/cli/commands/ralph.ts:430](src/cli/commands/ralph.ts#L430) — ralph run
- [packages/superintendent/src/commands/run.ts:325](packages/superintendent/src/commands/run.ts#L325) — superintendent has none; it bails when `builder.agent` is missing

The user hit the bail directly: `superintendent run` exited without prompting because the doc's frontmatter didn't pin a builder agent. The fix is to align all four loops behind one resolver.

`agent-kit` is the conceptual name; the real package is `@poe-code/agent-harness-tools`. `packages/toolcraft/src/docs.test.ts` actively asserts the literal "agent-kit" must not appear, so the resolver lives in `agent-harness-tools` next to `selectParticipantAgent`.

## Precedence (single source of truth)

1. `--agent` CLI flag
2. Frontmatter `agent` (single-string only — string[] keeps each loop's existing fan-out)
3. `core.defaultAgent` from merged config
4. `--yes` → loop-specific fallback constant (`claude-code` everywhere today)
5. Interactive `select` over `allAgents` from `@poe-code/agent-defs`

## Out of scope

- Multi-agent frontmatter (array) fan-out — stays in each loop's runner.
- Renaming or relocating the existing `DEFAULT_*_AGENT` constants.
- Any change to `--agent` flag names or messages, beyond the new superintendent prompt.
