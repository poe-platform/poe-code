---
kind: archived-pipeline-plan
version: 1
source: plan-core-default-agent-config.yaml
task_count: 8
---

# Core Default Agent Config

Archived pipeline plan. The original YAML is retained below for provenance.

````yaml
vars:
  plan_doc: '{{file "docs/plans/core-default-agent-config.md"}}'

tasks:
  - id: schema
    title: Add defaultAgent to coreConfigScope
    prompt: |
      Add `defaultAgent` to `coreConfigScope` in `src/services/config.ts`.

      Spec:

      ```
      defaultAgent: {
        type: "string",
        default: "",
        env: "POE_DEFAULT_AGENT",
        doc: "Agent (or agent:model) used when no --agent flag is provided; skips the selection prompt"
      }
      ```

      No behavior change expected yet — the field is declared but nothing reads it.

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: helpers
    title: Add resolveMergedDocument and resolveDefaultAgent
    prompt: |
      Add two new helpers to `src/cli/commands/shared.ts`:

      ```
      export async function resolveMergedDocument(
        container: CliContainer
      ): Promise<ConfigDocument>;

      export async function resolveDefaultAgent(
        container: CliContainer
      ): Promise<string | null>;
      ```

      `resolveMergedDocument` merges global + project + env overrides using the
      same pipeline currently inlined in `executeConfigShow` (see
      `src/cli/commands/config.ts` lines 78-86): `readMergedDocument` →
      `collectEnvOverrides` → `deepMergeDocuments`.

      `resolveDefaultAgent`:
      - Reads `core.defaultAgent` from the merged document.
      - Returns `null` when empty / whitespace / unset.
      - Parses with `parseAgentSpecifier` from `@poe-code/agent-defs`.
      - Validates the agent id against `allAgents`.
      - Throws `ValidationError` (from `src/cli/errors.js`) with message
        `Invalid value for core.defaultAgent: "<value>". Supported agents: <list>`
        when the agent id is unknown.
      - Returns the normalized specifier string on success (e.g. `"claude-code"`
        or `"claude-code:anthropic/claude-sonnet-4.6"`).
      - Does not prompt, does not log.

      Add unit tests in `src/cli/commands/shared.test.ts` (create if missing),
      using `memfs` and a mocked `container.env.variables`. Nine cases:

      1. Returns `null` when the `core` scope is absent.
      2. Returns `null` when `defaultAgent` is empty string.
      3. Returns `null` when `defaultAgent` is whitespace only.
      4. Returns the bare id for a valid agent.
      5. Returns the full specifier for valid `agent:model` input.
      6. Throws `ValidationError` naming `core.defaultAgent` for an unknown agent id.
      7. Throws `ValidationError` for `agent:model` with an unknown agent portion.
      8. Project-scope value overrides global-scope value.
      9. `POE_DEFAULT_AGENT` env overrides both file scopes.

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: refactor-config-show
    title: Use resolveMergedDocument in config show
    prompt: |
      Refactor `executeConfigShow` in `src/cli/commands/config.ts` (lines 75-97)
      to call the new `resolveMergedDocument` helper instead of inlining the
      merge chain.

      Goal: one definition of the merge pipeline across the codebase. The
      existing `config show` tests must stay green without modification — that
      proves the helper is behavior-equivalent.

      Do not change the output format of `config show`.

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: wire-configure
    title: Wire resolveDefaultAgent into configure/test/install
    prompt: |
      Wire `resolveDefaultAgent` into `resolveServiceArgument` in
      `src/cli/commands/configure.ts` (lines 173-212). This shared resolver is
      also used by `test` and `install`, so this single change covers three
      commands (sites 1, 2, 3 in the plan's level-1 inventory).

      Wiring pattern (inside `resolveServiceArgument`, after the `provided`
      short-circuit and before any prompt):

      ```
      const fromConfig = await resolveDefaultAgent(container);
      if (fromConfig !== null) {
        return parseAgentSpecifier(fromConfig).agent;
      }
      ```

      Non-run command → strip the model portion with `parseAgentSpecifier`.

      Add integration tests:

      - `configure` with `defaultAgent = claude-code` and no positional arg →
        no prompt shown; returns `claude-code`.
      - `configure --agent codex` with `defaultAgent = claude-code` set →
        returns `codex` (CLI wins).
      - `configure --yes` with `defaultAgent = claude-code` set → returns
        `claude-code` (config wins over `--yes`).
      - `configure --yes` with `defaultAgent` unset → returns the hardcoded
        `DEFAULT_*_AGENT` (regression guard).
      - `configure` with invalid `defaultAgent = "foo"` → `ValidationError`
        before any prompt or action.
      - `configure` with `defaultAgent = "claude-code:anthropic/claude-sonnet-4.6"`
        → returns `claude-code` (model dropped for this non-run command).

      Use memfs and the existing `container.prompts` mock pattern. Do not
      create real files.

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: wire-ralph
    title: Wire resolveDefaultAgent into ralph and prove frontmatter precedence
    prompt: |
      Wire `resolveDefaultAgent` into `promptForAgent` in
      `src/cli/commands/ralph.ts` (lines 436-455). The outer `resolveRunAgent`
      already checks explicit `--agent` first, then frontmatter, then falls
      through to `promptForAgent` — so putting the config check inside
      `promptForAgent` makes frontmatter naturally outrank config.

      Wiring pattern (inside `promptForAgent`, before the `assumeYes` check):

      ```
      const fromConfig = await resolveDefaultAgent(container);
      if (fromConfig !== null) {
        return resolveRalphAgent(fromConfig);
      }
      ```

      Pass `container` in if it isn't already in scope at that call site.

      Integration tests:

      - `ralph run` with `defaultAgent = claude-code`, no `--agent`, no
        frontmatter → no prompt, returns `claude-code`.
      - `ralph run` with `defaultAgent = claude-code` and frontmatter
        `agent: codex` → returns `codex` (frontmatter wins).
      - `ralph run` with `defaultAgent = "claude-code:anthropic/claude-sonnet-4.6"`
        → returns the full specifier with model preserved (run command).

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: wire-inline-mcp
    title: Wire resolveDefaultAgent into mcp configure (inline select pattern)
    prompt: |
      Wire `resolveDefaultAgent` into the inline `select()` in
      `src/cli/commands/mcp.ts` (lines 106-110). This is the template for all
      remaining inline-`select()` sites (skill, pipeline, experiment-install).

      Wiring pattern (inside the `if (!agent)` block, before the `options.yes`
      check):

      ```
      const fromConfig = await resolveDefaultAgent(container);
      if (fromConfig !== null) {
        agent = parseAgentSpecifier(fromConfig).agent;
      } else if (options.yes) {
        agent = DEFAULT_MCP_AGENT;
      } else {
        /* existing select() */
      }
      ```

      Integration test:

      - `mcp configure` with `defaultAgent = claude-code` → no prompt, proceeds
        with `claude-code`.

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: wire-remaining
    title: Wire resolveDefaultAgent into remaining prompt sites
    prompt: |
      Apply the same wiring pattern to the remaining prompt sites, following
      the templates established in `wire-configure`, `wire-ralph`, and
      `wire-inline-mcp`. No new integration tests required — coverage is
      already established; these should just follow the existing patterns.

      Sites:

      - `src/cli/commands/experiment.ts` `promptForAgent` (lines 534-553) —
        run-command pattern, reuse `resolveExperimentAgent`.
      - `src/cli/commands/experiment.ts` inline `select()` for install
        (lines 936-940) — non-run pattern, strip model with
        `parseAgentSpecifier`.
      - `src/cli/commands/pipeline.ts` inline `select()` at run
        (lines 666-673) — run-command pattern, use the command's existing
        specifier parsing.
      - `src/cli/commands/pipeline.ts` inline `select()` at install
        (lines 960-964) — non-run pattern.
      - `src/cli/commands/plan.ts` `resolvePlanAgent` (lines 613-634) —
        non-run pattern.
      - `src/cli/commands/skill.ts` inline `select()` at configure
        (lines 55-61) — non-run pattern.
      - `src/cli/commands/skill.ts` inline `select()` at unconfigure
        (lines 159-162) — non-run pattern.

      Verify by grep that every `select({ message: /Select agent|Pick an agent/ })`
      call in `src/cli/commands/` has a `resolveDefaultAgent` consultation
      immediately upstream. If any site cannot follow the template without
      reshaping a command's resolver signature, stop and escalate per the
      plan's stop conditions.

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: qa-doc
    title: Write manual QA walkthrough
    prompt: |
      Create `docs/development/qa-default-agent.md` as a markdown walkthrough
      (not a script) per CLAUDE.md: "QA is not a script. It's a plan in
      markdown format executed by an agent."

      Six steps:

      1. Set `POE_DEFAULT_AGENT=claude-code`, run `npm run dev -- configure`
         → verify no agent prompt appears.
      2. With env var still set, run `npm run dev -- ralph run <some-plan>`
         → verify no agent prompt appears.
      3. With env var still set, run `npm run dev -- mcp configure`
         → verify no agent prompt appears.
      4. Override with `npm run dev -- configure --agent codex`
         → verify it uses codex despite the env var.
      5. Set `POE_DEFAULT_AGENT=not-a-real-agent`, run `npm run dev -- configure`
         → verify ValidationError naming `core.defaultAgent` is printed and
         the process exits non-zero without prompting.
      6. Clear `POE_DEFAULT_AGENT`, run `npm run dev -- configure`
         → verify the prompt returns.

      Keep the doc short. Do not add to README without user permission
      (CLAUDE.md rule).

      Full plan context:

      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done
````
