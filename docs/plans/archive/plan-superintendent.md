---
kind: archived-pipeline-plan
version: 1
source: plan-superintendent.yaml
task_count: 28
---

# Superintendent

Archived pipeline plan. The original YAML is retained below for provenance.

````yaml
vars:
  plan_doc: "{{file 'docs/plans/superintendent.md'}}"

tasks:
  # ── Phase 1: Package scaffold + Document model + Validation ───────

  - id: scaffold
    title: Create superintendent package scaffold
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create the `packages/superintendent` package with this structure:

      ```
      packages/superintendent/
        src/
          commands/
            index.ts
            superintendent-group.ts
            builder-group.ts
            inspector-group.ts
          runtime/
          document/
            parse.ts
            write.ts
            tasks.ts
          state/
          cli.ts
          mcp.ts
          index.ts
        package.json
        tsconfig.json
        README.md
      ```

      - `package.json` should follow the same pattern as other workspace packages
        (look at `packages/pipeline/package.json` for reference).
        Name: `@poe-code/superintendent`, set up bin entry for `poe-superintendent-mcp`.
      - `tsconfig.json` extends the root config.
      - `README.md` covers the package purpose, env variables, and config options.
      - `cli.ts` wires the cmdkit CLI entrypoint (import from `@poe-code/cmdkit/cli`).
      - `mcp.ts` wires the cmdkit MCP entrypoint (import from `@poe-code/cmdkit/mcp`).
      - `index.ts` exports the SDK surface.
      - Stub out empty command group files in `commands/`.
      - Stub out empty files in `document/` and `runtime/`.

      Reference: {{plan_doc}}

  - id: parse-frontmatter
    title: Implement superintendent document parser
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/document/parse.ts`.

      This module parses a superintendent markdown document into a typed structure.
      The document has YAML frontmatter (between `---` delimiters) and a markdown body.

      **Exported types:**

      ```ts
      type SuperintendentDoc = {
        frontmatter: SuperintendentFrontmatter
        body: string        // raw markdown body (everything after second ---)
        filePath: string    // absolute path to the source file
      }

      type SuperintendentFrontmatter = {
        kind: "superintendent"
        version: number
        mcp?: Record<string, McpConfig>
        builder: AgentRoleConfig
        inspectors?: Record<string, AgentRoleConfig>
        superintendent: AgentRoleConfig
        owner: AgentRoleConfig
        max_rounds?: number
        status: StatusBlock
      }

      type AgentRoleConfig = {
        agent: string
        mode?: string
        tools?: { mcp?: string[] }
        prompt: string
      }

      type McpConfig = {
        command: string
        args?: string[]
      }

      type StatusBlock = {
        state: "in_progress" | "review" | "completed"
        round: number
        review_turn: number
      }
      ```

      **Exported functions:**

      - `parseSuperintendentDoc(filePath: string, content: string): SuperintendentDoc`
        Parse the YAML frontmatter and extract the body. Throw descriptive errors
        if frontmatter is malformed or `kind` is not `"superintendent"`.

      Use a YAML parsing library (the project already has `yaml` as a dependency).

      Write thorough unit tests in `packages/superintendent/src/document/parse.test.ts`:
      - Parses a valid document with all fields
      - Parses a minimal document (builder + superintendent + owner, no inspectors)
      - Extracts the markdown body correctly
      - Throws on missing `kind` field
      - Throws on invalid YAML
      - Throws on missing required roles (builder, superintendent, owner)
      - Handles optional `mcp` and `inspectors` fields
      - Handles `max_rounds` default (100)
      - Parses status block correctly

      Reference: {{plan_doc}}

  - id: write-status
    title: Implement status block writer
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/document/write.ts`.

      This module writes only the runtime-managed `status` block back to the
      superintendent document. Agents edit the markdown body directly; this module
      only touches frontmatter status fields.

      **Exported functions:**

      - `updateStatus(filePath: string, content: string, status: StatusBlock): string`
        Parse the frontmatter, update the `status` block, and return the full
        document string with updated frontmatter and unchanged body.

      - `incrementRound(filePath: string, content: string): string`
        Convenience: increment `status.round` by 1.

      - `setReviewTurn(filePath: string, content: string, turn: number): string`
        Convenience: set `status.review_turn`.

      - `transitionState(filePath: string, content: string, newState: StatusBlock["state"]): string`
        Convenience: set `status.state`, reset `review_turn` to 0 when transitioning
        to `in_progress`.

      Write tests in `packages/superintendent/src/document/write.test.ts`:
      - `updateStatus` preserves body and other frontmatter
      - `incrementRound` increments correctly
      - `transitionState` resets review_turn when going to in_progress
      - Round-trips with parse (write then parse yields same status)

      Reference: {{plan_doc}}

  - id: task-board-parser
    title: Implement task board parser
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/document/tasks.ts`.

      This module parses and queries the `## Task Board` section from the markdown body.

      Reuse the existing markdown parser from `@poe-code/design-system` which already
      handles AST with `listItem` nodes and `checked` boolean fields. Import it and
      use it to find the Task Board heading and extract checkbox items.

      **Exported types:**

      ```ts
      type TaskItem = {
        text: string
        done: boolean
      }

      type TaskBoard = {
        tasks: TaskItem[]
        allDone: boolean       // true if every task is checked
        openCount: number
        doneCount: number
      }
      ```

      **Exported functions:**

      - `parseTaskBoard(body: string): TaskBoard`
        Find the `## Task Board` section, extract all checkbox items, return a
        TaskBoard. Throw if `## Task Board` heading is not found.

      - `hasTaskBoard(body: string): boolean`
        Check whether the body contains a `## Task Board` heading.

      Write tests in `packages/superintendent/src/document/tasks.test.ts`:
      - Parses a task board with mixed checked/unchecked items
      - `allDone` is true when all items are checked
      - `allDone` is false when any item is unchecked
      - Counts are correct
      - Throws when `## Task Board` is missing
      - `hasTaskBoard` returns true/false correctly
      - Handles empty task board (heading exists but no items)
      - Priority is top-to-bottom (first unchecked = highest priority)

      Reference: {{plan_doc}}

  - id: validate-command
    title: Implement validate command
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement the `superintendent validate` command using cmdkit.

      Create/update `packages/superintendent/src/commands/superintendent-group.ts`
      to include a `validate` command.

      The command takes a single positional argument: the path to the superintendent
      markdown document.

      **Validation checks (return structured result):**

      1. Markdown + frontmatter parse correctly (use `parseSuperintendentDoc`)
      2. Required roles exist: `builder`, `superintendent`, `owner`
      3. `inspectors` parses as a dictionary (if present)
      4. `## Task Board` exists in the body (use `hasTaskBoard`)
      5. Task board uses recognizable markdown checkbox items (use `parseTaskBoard`)
      6. Prompt variables are known/allowed:
         - Scan all prompts for `{{...}}` patterns
         - Allowed variables: `plan.path`, `builder.summary`, `builder.log`,
           `inspectors.<name>` (for each configured inspector), `superintendent.summary`,
           `owner.feedback`
         - Flag any unknown variable references

      **Result type:**

      ```ts
      type ValidationResult = {
        valid: boolean
        problems: ValidationProblem[]
      }

      type ValidationProblem = {
        level: "error" | "warning"
        message: string
      }
      ```

      Scope: `["cli", "mcp", "sdk"]`

      Use design-system rich output for CLI rendering.
      Support `--output json` and `--output markdown`.

      Write tests in `packages/superintendent/src/commands/validate.test.ts`:
      - Valid document passes
      - Missing required role is flagged as error
      - Missing task board is flagged as error
      - Unknown prompt variable is flagged as warning
      - Returns structured result suitable for JSON output

      Reference: {{plan_doc}}

  # ── Phase 2: Builder + Inspector execution ────────────────────────

  - id: template-engine
    title: Implement prompt template variable resolution
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/templates.ts`.

      This module resolves Mustache-style `{{variable}}` placeholders in prompts.

      **Exported types:**

      ```ts
      type TemplateContext = {
        plan: { path: string }
        builder: { summary: string; log: string }
        inspectors: Record<string, string>
        superintendent: { summary: string }
        owner: { feedback: string }
      }
      ```

      **Exported functions:**

      - `resolveTemplate(template: string, context: Partial<TemplateContext>): string`
        Replace `{{plan.path}}`, `{{builder.summary}}`, `{{builder.log}}`,
        `{{inspectors.<name>}}`, `{{superintendent.summary}}`, `{{owner.feedback}}`
        with values from context.

        If a variable is referenced but not present in context, leave it as-is
        (the validate command already warns about unknown variables).

      Do NOT use a full Mustache library. The variable syntax is simple dot-path
      only — implement it with a regex replacement.

      Write tests in `packages/superintendent/src/runtime/templates.test.ts`:
      - Resolves `{{plan.path}}` correctly
      - Resolves `{{builder.summary}}` and `{{builder.log}}`
      - Resolves `{{inspectors.code-quality}}` with hyphenated inspector names
      - Resolves `{{superintendent.summary}}` and `{{owner.feedback}}`
      - Leaves unknown variables as-is
      - Handles templates with no variables (passthrough)
      - Handles multiple variables in one template

      Reference: {{plan_doc}}

  - id: run-builder
    title: Implement builder execution
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/run-builder.ts`.

      This module runs the configured builder agent using `spawn.autonomous`
      from `@poe-code/agent-spawn`.

      **Exported types:**

      ```ts
      type BuilderResult = {
        summary: string
        log: string
      }
      ```

      **Exported function:**

      - `runBuilder(doc: SuperintendentDoc, context: Partial<TemplateContext>): Promise<BuilderResult>`
        1. Resolve the builder prompt using `resolveTemplate`
        2. Invoke `spawn.autonomous` with the builder's agent, mode, and resolved prompt
        3. Capture the output as `log`
        4. Extract or generate a `summary` from the output
        5. Return `{ summary, log }`

      Also implement the `superintendent builder run` cmdkit command in
      `packages/superintendent/src/commands/builder-group.ts`:
      - Takes the path to the superintendent doc as argument
      - Runs the builder and displays the result
      - Scope: `["cli", "mcp", "sdk"]`

      Write tests in `packages/superintendent/src/runtime/run-builder.test.ts`:
      - Mock `spawn.autonomous` to return a known output
      - Verify prompt template resolution before spawn
      - Verify BuilderResult shape
      - Verify error propagation from spawn failure

      Reference: {{plan_doc}}

  - id: run-inspector
    title: Implement inspector execution
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/run-inspector.ts`.

      This module runs configured inspector agents sequentially (not in parallel).
      Each inspector produces a summary string.

      **Exported types:**

      ```ts
      type InspectorResult = {
        name: string
        summary: string
      }
      ```

      **Exported functions:**

      - `runInspector(name: string, config: AgentRoleConfig, doc: SuperintendentDoc, context: Partial<TemplateContext>): Promise<InspectorResult>`
        1. Resolve the inspector prompt using `resolveTemplate`
        2. Invoke `spawn.autonomous` with the inspector's agent, mode, and resolved prompt
        3. Return `{ name, summary: output }`

      - `runAllInspectors(doc: SuperintendentDoc, context: Partial<TemplateContext>): Promise<InspectorResult[]>`
        Run all configured inspectors sequentially. Return results in definition order.

      Also implement cmdkit commands in
      `packages/superintendent/src/commands/inspector-group.ts`:

      - `superintendent inspector list`: List configured inspectors from the doc.
        Scope: `["cli", "mcp", "sdk"]`

      - `superintendent inspector run`: Run one inspector by name, or all inspectors
        if no name is given. Takes doc path and optional inspector name as args.
        Scope: `["cli", "mcp", "sdk"]`

      Inspector outputs are ephemeral — they are returned in command results and
      passed to the superintendent, but not persisted as separate reports.

      Write tests in `packages/superintendent/src/runtime/run-inspector.test.ts`:
      - Mock spawn to return known output per inspector
      - Verify inspectors run sequentially (not in parallel)
      - Verify template resolution per inspector
      - `runAllInspectors` returns results in definition order
      - Handles documents with no inspectors configured

      Reference: {{plan_doc}}

  # ── Phase 3: Superintendent + Owner orchestration ─────────────────

  - id: workflow-tool
    title: Implement built-in workflow transition MCP tool
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/workflow-tool.ts`.

      This module defines the workflow transition MCP tool that the runtime
      injects automatically for superintendent and owner agents.

      The tool is NOT configured in frontmatter. It is baked into the runtime.

      **Tool definition:**

      Tool name: `workflow.transition`

      **Transitions by role and state:**

      - superintendent in `in_progress`:
        - `request_review` — superintendent believes work is done, requests owner review
      - owner in `review`:
        - `approve_completion` — owner approves, loop completes
        - `request_changes` — owner sends back with feedback

      **Exported types:**

      ```ts
      type WorkflowTransition =
        | { action: "request_review"; summary: string }
        | { action: "approve_completion" }
        | { action: "request_changes"; feedback: string }
      ```

      **Exported functions:**

      - `createWorkflowTool(role: "superintendent" | "owner", state: StatusBlock["state"]): McpToolDefinition`
        Returns a tool definition that exposes only valid transitions for the
        given role and state combination.

      - `parseWorkflowCall(input: unknown): WorkflowTransition`
        Validate and parse the tool call input into a typed transition.

      Write tests in `packages/superintendent/src/runtime/workflow-tool.test.ts`:
      - Superintendent in in_progress gets only `request_review`
      - Owner in review gets `approve_completion` and `request_changes`
      - Superintendent in review gets no transitions (empty tool)
      - `parseWorkflowCall` validates action field
      - `request_review` requires summary
      - `request_changes` requires feedback

      Reference: {{plan_doc}}

  - id: run-superintendent
    title: Implement superintendent agent execution
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/run-superintendent.ts`.

      This module runs the superintendent agent with the workflow transition tool
      injected automatically.

      **Exported types:**

      ```ts
      type SuperintendentResult = {
        summary: string
        transition?: WorkflowTransition
      }
      ```

      **Exported function:**

      - `runSuperintendent(doc: SuperintendentDoc, context: Partial<TemplateContext>): Promise<SuperintendentResult>`
        1. Resolve the superintendent prompt using `resolveTemplate`
        2. Create the workflow tool for the superintendent's current state
        3. Invoke `spawn.autonomous` with:
           - the superintendent's agent, mode, and resolved prompt
           - the workflow tool injected as an MCP tool
           - any additional MCP tools configured in frontmatter (`superintendent.tools.mcp`)
        4. Parse the spawn output to detect if the workflow tool was called
        5. Return `{ summary, transition }`

      The superintendent can:
      - Update the Task Board in the plan file directly (via its agent)
      - Call `workflow.transition(request_review)` when it believes work is done
      - Continue planning work if more tasks are needed

      Write tests in `packages/superintendent/src/runtime/run-superintendent.test.ts`:
      - Mock spawn to simulate workflow tool call
      - Verify workflow tool is injected for correct state
      - Verify additional MCP tools from frontmatter are included
      - Verify template resolution
      - Handles case where superintendent does not call transition (continues in_progress)

      Reference: {{plan_doc}}

  - id: run-owner
    title: Implement owner review execution
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/run-owner-review.ts`.

      This module runs the owner agent during the review state.

      **Exported types:**

      ```ts
      type OwnerResult = {
        transition: WorkflowTransition  // always present — owner must decide
      }
      ```

      **Exported function:**

      - `runOwnerReview(doc: SuperintendentDoc, context: Partial<TemplateContext>): Promise<OwnerResult>`
        1. Resolve the owner prompt using `resolveTemplate`
        2. Create the workflow tool for the owner in review state
        3. Invoke `spawn.autonomous` with the owner's agent, mode, resolved prompt,
           and the workflow tool
        4. Parse the output to extract the workflow transition
        5. Return `{ transition }`

      The owner decides based on the actual task list in `{{plan.path}}` and
      the superintendent's summary. Approval is explicit via
      `workflow.transition(approve_completion)`, not inferred from prose.

      Write tests in `packages/superintendent/src/runtime/run-owner-review.test.ts`:
      - Mock spawn to simulate approve_completion call
      - Mock spawn to simulate request_changes call with feedback
      - Verify workflow tool is injected for owner in review state
      - Verify template resolution includes superintendent summary

      Reference: {{plan_doc}}

  - id: state-machine
    title: Implement the fixed runtime state machine
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/state/machine.ts`.

      This module implements the fixed state machine that drives the superintendent
      loop. States are NOT configurable in frontmatter.

      **States:** `in_progress`, `review`, `completed`

      **State machine logic:**

      ```ts
      type LoopState = {
        state: "in_progress" | "review" | "completed"
        round: number
        reviewTurn: number
        maxRounds: number
        maxReviewTurns: number  // fixed at 5, not configurable
      }
      ```

      **Exported functions:**

      - `createLoopState(doc: SuperintendentDoc): LoopState`
        Initialize from doc status block. `maxReviewTurns` is always 5.

      - `applyTransition(state: LoopState, transition: WorkflowTransition): LoopState`
        Apply a workflow transition:
        - `request_review`: state -> review, reviewTurn = 0
        - `approve_completion`: state -> completed
        - `request_changes`: if reviewTurn < maxReviewTurns, stay in review and
          increment reviewTurn. Otherwise, auto-transition to in_progress
          (superintendent loses the review).

      - `startNewRound(state: LoopState): LoopState`
        Increment round, set state to in_progress, reset reviewTurn.

      - `isComplete(state: LoopState): boolean`
        True if state is completed or round > maxRounds.

      - `shouldRunBuilder(state: LoopState): boolean`
        True only in in_progress state.

      Write tests in `packages/superintendent/src/state/machine.test.ts`:
      - `applyTransition` request_review moves to review
      - `applyTransition` approve_completion moves to completed
      - `applyTransition` request_changes increments reviewTurn
      - Review cap at 5 turns auto-transitions to in_progress
      - `startNewRound` increments round and resets state
      - `isComplete` detects completed state
      - `isComplete` detects max_rounds exceeded
      - `shouldRunBuilder` only true in in_progress

      Reference: {{plan_doc}}

  - id: run-loop
    title: Implement the main superintendent run loop
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement `packages/superintendent/src/runtime/loop.ts`.

      This is the main orchestration loop that drives the superintendent lifecycle.

      **Loop flow:**

      ```
      while not complete:
        if in_progress:
          1. run builder
          2. run all inspectors sequentially
          3. run superintendent (with builder + inspector outputs)
          4. if superintendent requests review -> transition to review
          5. else -> start new round

        if review:
          1. run owner (with superintendent summary)
          2. if owner approves -> completed
          3. if owner requests changes -> store feedback, transition to in_progress
          4. if review turn limit reached -> auto-transition to in_progress
      ```

      **Exported types:**

      ```ts
      type LoopCallbacks = {
        onBuilderStart?: () => void
        onBuilderComplete?: (result: BuilderResult) => void
        onBuilderFailed?: (error: Error) => void
        onInspectorStart?: (name: string) => void
        onInspectorComplete?: (result: InspectorResult) => void
        onInspectorFailed?: (name: string, error: Error) => void
        onSuperintendentStart?: () => void
        onSuperintendentComplete?: (result: SuperintendentResult) => void
        onOwnerStart?: () => void
        onOwnerComplete?: (result: OwnerResult) => void
        onRoundComplete?: (round: number) => void
        onLoopComplete?: (state: LoopState) => void
        onStateChange?: (state: LoopState) => void
        shouldPause?: () => boolean
        shouldStop?: () => boolean
      }
      ```

      **Exported function:**

      - `runLoop(docPath: string, callbacks?: LoopCallbacks): Promise<LoopState>`
        1. Read and parse the document
        2. Initialize loop state from doc
        3. Execute the state machine loop
        4. After each agent run, write updated status to the doc
        5. Fire callbacks at each lifecycle point
        6. Respect `shouldPause` and `shouldStop` for dashboard integration
        7. Return final loop state

      The runtime manages all status updates. Agents do NOT manually edit
      the status block — they edit the markdown body and task board only.

      Agent failures are handled by `spawn.autonomous` retry behavior.
      If an agent fails after retries, surface the error via callback and
      halt the current round, leaving the document in its last valid state.

      The `runLoop` function must accept a `runAgent` callback (like ralph/pipeline)
      so that simulation tests can intercept agent execution. The signature should be:

      ```ts
      type RunLoopOptions = {
        docPath: string
        cwd: string
        homeDir: string
        fs: SuperintendentFileSystem
        callbacks?: LoopCallbacks
        runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>
        signal?: AbortSignal
      }
      ```

      This is the same pattern used by `runRalph` and `runPipeline` — the `runAgent`
      callback is the seam that allows simulation tests to replace real agent execution
      with turn-based mocked responses.

      Write unit tests in `packages/superintendent/src/runtime/loop.test.ts` using
      direct mocking of the agent runner modules (vi.mock). The full simulation tests
      come in the next task.

      Reference: {{plan_doc}}

  - id: simulation-infra
    title: Build simulation test infrastructure
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/superintendent/src/testing/simulation.ts` and
      `packages/superintendent/src/testing/index.ts`.

      Follow the exact same pattern as `packages/ralph/src/testing/simulation.ts`
      and `packages/pipeline/src/testing/simulation.ts`. These are the reference
      implementations — read them and replicate the architecture.

      **Key pattern: turn-based agent mocking with memfs.**

      The simulation intercepts `runAgent` calls and dequeues turns sequentially.
      Each turn can assert on the prompt it received, apply file changes to the
      in-memory filesystem, and return a mocked agent result.

      **Types:**

      ```ts
      type TurnContext = {
        fs: SuperintendentFileSystem
        readFile: (filePath: string) => Promise<string>
        writeFile: (filePath: string, content: string) => Promise<void>
        readDoc: () => Promise<SuperintendentDoc>
      }

      type TurnOutput = {
        stdout: string
        stderr?: string
        exitCode?: number
      }

      type TurnSpec = {
        assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>
        fileChanges?: Record<string, string>
        output: TurnOutput
      }

      type SimulationOptions = {
        docContent: string              // full superintendent markdown doc
        docPath?: string                // default: .poe-code/superintendent/plans/plan.md
        turns: TurnSpec[]               // one per agent invocation, dequeued in order
        files?: Record<string, string>  // extra files to seed in memfs
        maxRounds?: number              // override max_rounds from doc
        signal?: AbortSignal
      }

      type SimulationRun = AgentRunInput

      type SimulationResult = {
        result: SuperintendentRunResult  // final loop state + stop reason
        prompts: string[]               // every prompt sent to agents, in order
        runs: SimulationRun[]           // full AgentRunInput for each call
        fs: SuperintendentFileSystem    // final state of the in-memory fs
        readFile: (filePath: string) => Promise<string>
        readDoc: () => Promise<SuperintendentDoc>
      }
      ```

      **Helpers (exported):**

      - `successTurn(assertPrompt?, fileChanges?)` — exitCode 0, empty stdout
      - `failTurn(stderr, assertPrompt?, fileChanges?)` — exitCode 1
      - `builderTurn(fileChanges?, assertPrompt?)` — success turn that applies
        file changes (convenience for simulating builder work)
      - `inspectorTurn(summary, assertPrompt?)` — success turn with stdout as
        the inspector summary
      - `superintendentTurn(transition?, fileChanges?, assertPrompt?)` — success
        turn that can optionally simulate calling the workflow.transition tool.
        The simulation should detect workflow tool calls in the stdout or via a
        structured mechanism matching how the real runtime detects them.
      - `ownerApproveTurn(assertPrompt?)` — simulates owner calling approve_completion
      - `ownerRejectTurn(feedback, assertPrompt?)` — simulates owner calling
        request_changes with feedback

      **Factory:**

      - `createSuperintendentSimulation(options: SimulationOptions): { run: () => Promise<SimulationResult> }`

      **Implementation details:**

      - Use `memfs` `Volume.fromJSON` to create the in-memory filesystem, same as
        ralph and pipeline simulations.
      - The `SuperintendentFileSystem` type should match the abstraction used by
        the runtime (readFile, writeFile, readdir, stat, mkdir, rmdir, rename).
      - Inject the simulation fs and runAgent into `runLoop` via its options.
      - Track all prompts and runs for assertion.
      - The `readDoc` helper re-parses the doc from the current fs state.

      **Export from `testing/index.ts`:**

      ```ts
      export {
        createSuperintendentSimulation,
        successTurn,
        failTurn,
        builderTurn,
        inspectorTurn,
        superintendentTurn,
        ownerApproveTurn,
        ownerRejectTurn,
      } from "./simulation.js"
      export type {
        TurnSpec,
        TurnContext,
        SimulationOptions,
        SimulationResult,
        SimulationRun,
      } from "./simulation.js"
      ```

      Also export from the package index for external consumers:
      ```ts
      export * from "./testing/index.js"
      ```

      Write a basic smoke test in `packages/superintendent/src/testing/simulation.test.ts`:
      - `createSuperintendentSimulation` with one successTurn runs and returns a result
      - Prompts are captured in order
      - File changes from turns are reflected in the final fs state
      - Throws "ran out of turns" if more agent calls happen than turns provided

      Reference: {{plan_doc}}

  - id: sim-happy-path
    title: "Simulation: happy path — single round approval"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Write simulation tests in `packages/superintendent/src/superintendent.test.ts`.

      Use the simulation infrastructure from `./testing/simulation.js` — follow the
      same testing style as `packages/ralph/src/ralph.test.ts` and
      `packages/pipeline/src/pipeline.test.ts`.

      **Scenario: happy path — single round, owner approves**

      Create a superintendent doc with:
      - 1 builder (claude-code, yolo mode)
      - 1 inspector (code-quality)
      - superintendent and owner roles
      - Task board with 2 unchecked tasks
      - status: in_progress, round: 0

      Turns (in order of expected agent calls):
      1. Builder turn — applies fileChanges that check off both tasks in the doc body
      2. Inspector turn — returns summary "All checks pass"
      3. Superintendent turn — calls workflow.transition(request_review) with summary
      4. Owner turn — calls workflow.transition(approve_completion)

      Assertions:
      - `result.state === "completed"`
      - `result.round === 1`
      - `result.reviewTurn === 0`
      - `prompts.length === 4` (builder, inspector, superintendent, owner)
      - Builder prompt contains `{{plan.path}}` resolved to the actual doc path
      - Inspector prompt contains `{{plan.path}}`
      - Superintendent prompt contains builder summary and inspector summary
      - Owner prompt contains superintendent summary
      - Final doc on fs has `status.state: completed`
      - Final doc task board has both tasks checked

      Use inline `assertPrompt` callbacks in turns to verify prompt content
      at each step.

      Reference: {{plan_doc}}

  - id: sim-owner-rejects
    title: "Simulation: owner rejects and loop continues"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: owner rejects, superintendent replans, second round succeeds**

      Doc: 2 tasks, 1 inspector. status: in_progress, round: 0.

      Round 1 turns:
      1. Builder — checks off task 1 only
      2. Inspector — returns "Task 2 still open"
      3. Superintendent — calls request_review (premature)
      4. Owner — calls request_changes with feedback: "Task 2 is not done"

      Round 2 turns:
      5. Builder — checks off task 2
      6. Inspector — returns "All tasks complete"
      7. Superintendent — calls request_review
      8. Owner — calls approve_completion

      Assertions:
      - `result.state === "completed"`
      - `result.round === 2`
      - `prompts.length === 8`
      - Run 5 (builder round 2) prompt should contain owner feedback
        (`{{owner.feedback}}` resolved to "Task 2 is not done")
      - Verify state transitions: in_progress -> review -> in_progress -> review -> completed
      - Use `assertPrompt` on the round-2 superintendent turn to verify it receives
        fresh builder and inspector outputs (not stale round-1 data)
      - Final doc has all tasks checked and state completed

      Reference: {{plan_doc}}

  - id: sim-review-cap
    title: "Simulation: review turn cap forces back to in_progress"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: owner keeps requesting changes, hits 5-turn review cap**

      Doc: 1 task. status: in_progress, round: 0.

      Round 1 turns:
      1. Builder — success (marks task done)
      2. Inspector — "looks good"
      3. Superintendent — calls request_review

      Review turns (cap is 5):
      4. Owner — request_changes("fix formatting")
      5. Superintendent — calls request_review again
      6. Owner — request_changes("still not right")
      7. Superintendent — calls request_review
      8. Owner — request_changes("nope")
      9. Superintendent — calls request_review
      10. Owner — request_changes("try again")
      11. Superintendent — calls request_review
      12. Owner — request_changes("no") ← 5th rejection

      After 5th rejection, the runtime should auto-transition back to in_progress
      (superintendent loses the review).

      Round 2 turns:
      13. Builder — success
      14. Inspector — "all good"
      15. Superintendent — calls request_review
      16. Owner — approve_completion

      Assertions:
      - `result.state === "completed"`
      - `result.round === 2`
      - Review turn counter resets to 0 after auto-transition to in_progress
      - Verify the review back-and-forth happened (check `runs` array for
        alternating superintendent/owner agent calls in the review phase)
      - Final doc state is completed
      - `prompts.length === 16`

      Reference: {{plan_doc}}

  - id: sim-max-rounds
    title: "Simulation: max_rounds safeguard stops the loop"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: loop hits max_rounds without completing**

      Doc: 1 task, max_rounds: 2. status: in_progress, round: 0.

      Round 1 turns:
      1. Builder — success (does not check off the task)
      2. Inspector — "task still open"
      3. Superintendent — does NOT call request_review (continues in_progress)

      Round 2 turns:
      4. Builder — success (still does not complete)
      5. Inspector — "still open"
      6. Superintendent — does NOT call request_review

      After round 2, max_rounds is reached.

      Assertions:
      - `result.round === 2`
      - Loop stopped due to max_rounds, NOT due to completion
      - `result.state !== "completed"` (still in_progress)
      - `prompts.length === 6` (3 per round x 2 rounds)
      - No owner turns were invoked (never entered review)
      - Result includes a stop reason indicating max_rounds reached

      Reference: {{plan_doc}}

  - id: sim-builder-failure
    title: "Simulation: builder crash halts the round"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: builder fails, round halts, doc stays in last valid state**

      Doc: 1 task. status: in_progress, round: 0.

      Turns:
      1. Builder — failTurn("Process exited with code 1")

      Assertions:
      - Loop surfaces the error (check result or callbacks)
      - Inspector and superintendent are NOT invoked after builder failure
      - `prompts.length === 1` (only the builder prompt)
      - Document on fs is unchanged (status still in_progress, round still 0)
      - Task board is unchanged (task still unchecked)

      Reference: {{plan_doc}}

  - id: sim-inspector-failure
    title: "Simulation: inspector failure halts the round"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: one inspector fails, round halts after builder completed**

      Doc: 1 task, 2 inspectors (code-quality, manual-qa). status: in_progress, round: 0.

      Turns:
      1. Builder — success (checks off the task)
      2. Inspector code-quality — success ("all good")
      3. Inspector manual-qa — failTurn("timeout")

      Assertions:
      - Loop surfaces the inspector error
      - Superintendent is NOT invoked (inspectors didn't all complete)
      - `prompts.length === 3` (builder + 2 inspectors)
      - `runs[2].agent` matches the manual-qa inspector agent
      - Document preserves the builder's file changes (task is checked off)
        but status.round is not incremented (round halted)

      Reference: {{plan_doc}}

  - id: sim-multiple-inspectors
    title: "Simulation: multiple inspectors run sequentially"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: 3 inspectors run in order, outputs passed to superintendent**

      Doc: 1 task, 3 inspectors: code-quality, manual-qa, developer-experience.
      Builder prompt uses `{{plan.path}}`.
      Inspector developer-experience prompt uses `{{builder.log}}`.
      Superintendent prompt uses `{{inspectors.code-quality}}`,
      `{{inspectors.manual-qa}}`, `{{inspectors.developer-experience}}`.
      status: in_progress, round: 0.

      Turns:
      1. Builder — success, stdout: "Built feature X"
      2. Inspector code-quality — stdout: "Code quality: A+"
      3. Inspector manual-qa — stdout: "Manual QA: all pass"
      4. Inspector developer-experience — stdout: "DX: good ergonomics"
      5. Superintendent — calls request_review
      6. Owner — approve_completion

      Assertions:
      - Inspectors ran in definition order: code-quality, manual-qa, developer-experience
      - `runs[1].agent` is the code-quality agent
      - `runs[2].agent` is the manual-qa agent
      - `runs[3].agent` is the developer-experience agent
      - Use assertPrompt on turn 4 (developer-experience) to verify `{{builder.log}}`
        was resolved to "Built feature X"
      - Use assertPrompt on turn 5 (superintendent) to verify all 3 inspector
        summaries are present in the prompt
      - result.state === "completed"

      Reference: {{plan_doc}}

  - id: sim-abort-signal
    title: "Simulation: abort signal stops the loop gracefully"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: abort signal fires mid-loop**

      Doc: 1 task. status: in_progress, round: 0.

      Use an AbortController. Abort after the builder turn completes.

      Turns:
      1. Builder — success, assertPrompt triggers `controller.abort()`
      2. (Inspector turn should not be reached)

      Assertions:
      - Loop stopped after builder
      - `prompts.length === 1`
      - Result indicates the loop was aborted (not completed, not max_rounds)
      - Document on fs preserves builder changes but status is not advanced

      Reference: {{plan_doc}}

  - id: sim-template-resolution
    title: "Simulation: prompt template variables resolve correctly across all roles"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: verify every template variable resolves at the right time**

      Doc with all template variables used:
      - builder prompt: "Work on {{plan.path}}"
      - inspector code-quality prompt: "Inspect {{plan.path}}"
      - inspector dx prompt: "Review DX. Build log: {{builder.log}}"
      - superintendent prompt: "Plan: {{plan.path}}\nBuilder: {{builder.summary}}\nLog: {{builder.log}}\nQuality: {{inspectors.code-quality}}\nDX: {{inspectors.dx}}"
      - owner prompt: "Plan: {{plan.path}}\nSuperintendent: {{superintendent.summary}}"

      Turns:
      1. Builder — stdout: "built stuff", assertPrompt verifies `{{plan.path}}`
         resolved to actual doc path (NOT the literal string "{{plan.path}}")
      2. Inspector code-quality — stdout: "quality-ok", assertPrompt verifies
         `{{plan.path}}` resolved
      3. Inspector dx — stdout: "dx-ok", assertPrompt verifies `{{builder.log}}`
         resolved to "built stuff"
      4. Superintendent — calls request_review with summary "all done",
         assertPrompt verifies:
         - `{{builder.summary}}` resolved (not empty, not literal)
         - `{{builder.log}}` resolved to "built stuff"
         - `{{inspectors.code-quality}}` resolved to "quality-ok"
         - `{{inspectors.dx}}` resolved to "dx-ok"
      5. Owner — approve_completion, assertPrompt verifies:
         - `{{superintendent.summary}}` resolved to "all done"
         - `{{plan.path}}` resolved

      Assertions:
      - No prompt contains unresolved `{{...}}` patterns for known variables
      - Each role gets the correct context for its execution phase

      Reference: {{plan_doc}}

  - id: sim-doc-state-persistence
    title: "Simulation: document state persists correctly across rounds"
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add simulation test to `packages/superintendent/src/superintendent.test.ts`.

      **Scenario: verify runtime writes status back to doc after each phase**

      Doc: 2 tasks. status: in_progress, round: 0.

      Turns:
      1. Builder — checks off task 1 via fileChanges
         assertPrompt: use ctx.readDoc() to verify status.round === 1 (runtime
         should have incremented before running builder)
      2. Inspector — success
      3. Superintendent — calls request_review
         assertPrompt: use ctx.readDoc() to verify status.state is still in_progress
         (hasn't transitioned yet — that happens after superintendent returns)
      4. Owner — request_changes("finish task 2")
         assertPrompt: use ctx.readDoc() to verify status.state === "review"
         and status.review_turn === 0
      5. Builder — checks off task 2 via fileChanges
         assertPrompt: use ctx.readDoc() to verify status.state === "in_progress"
         (owner sent it back) and status.round === 2
      6. Inspector — success
      7. Superintendent — calls request_review
      8. Owner — approve_completion

      Assertions:
      - Final doc has state: completed, round: 2
      - Both tasks checked off
      - The inline assertPrompt callbacks verify the runtime wrote correct status
        at each intermediate step (this is the key — verifying the doc on disk
        reflects the runtime state machine at every point in the loop)

      Reference: {{plan_doc}}

  - id: complete-command
    title: Implement complete command
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add the `superintendent complete` command to the superintendent group.

      This is the manual operator fallback to force-complete the loop.

      **Behavior:**
      - Takes doc path as argument
      - Optional `--reason` flag for recording why
      - Sets `status.state: completed` in the document
      - Does NOT silently rewrite remaining tasks
      - Scope: `["cli", "mcp", "sdk"]`

      Use `transitionState` from `document/write.ts`.

      Write tests in `packages/superintendent/src/commands/complete.test.ts`:
      - Sets state to completed
      - Preserves existing task board (no task rewriting)
      - Accepts optional reason

      Reference: {{plan_doc}}

  - id: run-command
    title: Implement run command with dashboard UI
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Implement the `superintendent run` command.

      This is the main entry point that runs the full loop with a live dashboard UI.

      **Pre-dashboard flow (interactive prompts):**
      1. Plan selection — pick which superintendent document to run
         (scan for `kind: superintendent` docs, or accept doc path as arg)
      2. Agent selection — pick or confirm the builder agent
         (read from doc frontmatter, allow override via `--agent` arg)

      Both prompts can be skipped via args:
      ```bash
      superintendent run <doc> --agent claude-code
      ```

      **Dashboard integration:**

      Use `createDashboard` from `@poe-code/design-system`.

      **Left pane — "Superintendent":**
      Agent lifecycle events as timestamped output items:
      - Builder starting/completed/failed
      - Inspector <name> starting/completed/failed
      - Superintendent reviewing/requesting review
      - Owner reviewing/approved/requesting changes
      - Round completed / Loop completed

      **Right pane — "Loop":**
      - Status: in_progress/review/completed
      - Round number
      - Review Turn (only during review state)
      - Elapsed time
      - Tokens In/Out/Total
      - Current Action

      **Keyboard commands:**
      - `q` / Ctrl+C: graceful stop after current agent
      - `p`: pause/resume
      - `e`: open plan file in $EDITOR

      Wire the dashboard callbacks to the `LoopCallbacks` from the run loop.
      The dashboard is ONLY for this command — all other commands use standard output.

      Scope: `["cli"]` (dashboard is CLI-only, MCP uses the loop directly)

      Write tests:
      - Pre-dashboard flow respects --yes for defaults
      - Command wires callbacks to dashboard correctly (unit test with mocked dashboard)

      Reference: {{plan_doc}}

  # ── Phase 4: MCP exposure + final wiring ──────────────────────────

  - id: mcp-entrypoint
    title: Wire MCP entrypoint and verify tool names
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Wire up the MCP entrypoint in `packages/superintendent/src/mcp.ts`:

      ```ts
      import { createMCPServer } from "@poe-code/cmdkit/mcp";
      import { superintendentGroup } from "./commands/index.js";

      createMCPServer(superintendentGroup, {
        name: "superintendent",
        version: "0.0.1",
      });
      ```

      Verify the following MCP tool names are generated:
      - `superintendent.run` (without dashboard, just loop execution)
      - `superintendent.validate`
      - `superintendent.complete`
      - `superintendent.builder.run`
      - `superintendent.inspector.run`
      - `superintendent.inspector.list`

      Make sure all commands have `scope: ["cli", "mcp", "sdk"]` except
      `superintendent.run` which should have a separate MCP-compatible handler
      that runs the loop without the dashboard UI.

      Update `packages/superintendent/package.json` bin entry so
      `poe-superintendent-mcp` maps to the MCP entrypoint.

      Also compose into the main `poe-code mcp` if applicable — check how other
      packages like pipeline integrate their MCP tools into the main CLI.

      Write tests:
      - MCP server starts without errors
      - Tool names match expected list
      - All commands are accessible via MCP

      Reference: {{plan_doc}}

  - id: sdk-exports
    title: Finalize SDK exports and package index
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Finalize `packages/superintendent/src/index.ts` with clean SDK exports:

      ```ts
      // Document
      export { parseSuperintendentDoc } from "./document/parse.js"
      export { updateStatus, transitionState, incrementRound } from "./document/write.js"
      export { parseTaskBoard, hasTaskBoard } from "./document/tasks.js"
      export type { SuperintendentDoc, SuperintendentFrontmatter, StatusBlock, TaskBoard, TaskItem } from "./document/parse.js"

      // Runtime
      export { runLoop } from "./runtime/loop.js"
      export { runBuilder } from "./runtime/run-builder.js"
      export { runInspector, runAllInspectors } from "./runtime/run-inspector.js"
      export { resolveTemplate } from "./runtime/templates.js"
      export type { LoopCallbacks, BuilderResult, InspectorResult, TemplateContext } from "./runtime/types.js"

      // State
      export { createLoopState, applyTransition, isComplete } from "./state/machine.js"

      // Testing
      export * from "./testing/index.js"

      // Commands (for composition)
      export { superintendentGroup } from "./commands/index.js"
      ```

      Update `README.md` with:
      - Package overview
      - CLI commands and usage
      - MCP tool names
      - SDK API summary
      - Environment variables (if any)
      - Configuration options

      Verify the build passes: `npm run build` in the superintendent package.

      Reference: {{plan_doc}}
````
