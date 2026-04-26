---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: task-list-state-machine-types
    title: task-list — state machine types and validateMachine
    prompt: |
      In packages/task-list, add the configurable state machine type system.

      Files to create:
      - packages/task-list/src/state-machine.ts — exports:
          - StateMachineDef<TState extends string, TEvent extends string>
            with fields: initial, states, events
          - EventDef<TState extends string>
            with fields: from (readonly TState[] | "*"), to, guard?, onEnter?, onExit?
          - validateMachine(machine: StateMachineDef): void
              - rejects: state in events.from not in states[]; state in events.to not in states[];
                initial not in states[]; any event with from === "*" and to === currentState for any state
                (no-op self-loop) — rejected at config time
          - eventsFromState(machine, fromState): readonly string[]
          - findEvent(machine, fromState, eventName): EventDef | undefined
      - packages/task-list/src/state-machine.test.ts — tests for validateMachine
        (accept default-shaped machine; reject each invalid form)

      Constraints:
      - No zod, no schema library — plain TS guards
      - No regex
      - No new dependencies
      - Types only, no behaviour change to existing task-list yet

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "Task-list state machine extension".
    status:
      implement: done
      test: done
      commit: done

  - id: task-list-default-machine
    title: task-list — convert hardcoded LEGAL_TRANSITIONS to defaultStateMachine
    prompt: |
      In packages/task-list/src/state.ts, replace the hardcoded
      LEGAL_TRANSITIONS constant with a derivation from a StateMachineDef,
      and export defaultStateMachine matching today's behaviour with explicit
      event names:

        initial: "draft"
        states:  ["draft", "planned", "in-progress", "done", "archived"]
        events:
          plan:     { from: ["draft"],         to: "planned"     }
          start:    { from: ["planned"],       to: "in-progress" }
          complete: { from: ["in-progress"],   to: "done"        }
          archive:  { from: "*",               to: "archived"    }

      Add to packages/task-list/src/state.ts:
      - assertEvent(machine, fromState, eventName): EventDef — throws InvalidTransitionError
        when the event is not legal from fromState. Used by the new fire() API.
      - Keep existing TaskState type. Add exported "TaskEvent" type if useful for the default.

      Behavior must not change for existing callers — all current task-list tests still pass.
      The grep `LEGAL_TRANSITIONS` in packages/task-list/src must be empty after this task.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "Task-list state machine extension".
    status:
      implement: done
      test: done
      commit: done

  - id: task-list-fire-api
    title: task-list — fire / canFire / events on Tasks
    prompt: |
      In packages/task-list, add the state-machine event API on the Tasks
      interface used by both backends (markdown-dir and yaml-file).

      Add to Tasks:
        fire(id: string, event: string, opts?: { metadataPatch?: Record<string, unknown> }): Promise<Task>
        canFire(id: string, event: string): Promise<boolean>
        events(id: string): Promise<readonly string[]>   // events legal from current state

      Semantics:
      - fire reads the task, runs guard if any (true = allow, string = decline reason
        → throw InvalidTransitionError with that reason), runs onExit, persists
        new state and shallow-merges metadataPatch into metadata, runs onEnter.
      - canFire returns true iff the event is legal from the task's current state
        AND the guard (if any) returns true.
      - events returns event names whose `from` includes the current state.
      - InvalidTransitionError carries: task, event, to (the would-be target), reason.

      Tests in packages/task-list/src/tasks.fire.test.ts (uses memfs, both backends):
      - fire transitions when legal; throws when illegal
      - guard returning string → InvalidTransitionError with that reason
      - metadataPatch shallow-merges
      - onEnter / onExit are awaited; failures propagate
      - canFire returns true/false without mutating
      - events returns the right list

      No bespoke locking. Existing Tasks.transition stays in place for now;
      it is removed in a later task.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 / §4.
    status:
      implement: done
      test: done
      commit: done

  - id: task-list-open-options
    title: task-list — plumb stateMachine through openTaskList
    prompt: |
      In packages/task-list:

      - Extend OpenTaskListOptions with `stateMachine?: StateMachineDef`.
      - Default to defaultStateMachine when omitted.
      - Run validateMachine(stateMachine) once at openTaskList.
      - Expose `stateMachine` on the loaded List (read-only field) for
        introspection: `taskList.list(name).stateMachine`.

      Loosen task validation: state strings are validated against the
      configured machine's states[] at runtime (in the Tasks methods that
      mutate state), NOT against a hardcoded enum in
      packages/task-list/src/schema/task.schema.json — change that field to
      `string` there.

      Tests in packages/task-list/src/open-task-list.test.ts:
      - Default machine when stateMachine is not passed (existing tests
        rewritten in terms of fire("plan") / fire("start") / etc. should pass).
      - Custom machine when passed; list.stateMachine returns it by reference.
      - task.state validation reflects the configured machine's states.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 / §4.
    status:
      implement: done
      test: done
      commit: done

  - id: task-list-drop-transition
    title: task-list — drop transition; restrict create/update mutations
    prompt: |
      In packages/task-list, simplify the Tasks API now that fire is in place
      (this is pre-release; no external callers).

      Remove:
      - Tasks.transition(id, to)
      - AmbiguousTransitionError if it was added — not needed.

      Tighten:
      - Tasks.create now signature: { id, name, description?, metadata? }.
        Drop the `state` field. New tasks always start at stateMachine.initial.
      - Tasks.update rejects an attempt to set `state` (only name/description/metadata).
        Static rejection at the API boundary plus a runtime guard.

      Rewrite all internal task-list tests/callers in terms of fire (e.g.
      fire("plan"), fire("start"), fire("complete"), fire("archive")). The full
      task-list test suite must be green after this task. Verify with
      `grep -r "\.transition(" packages/task-list/src` empty.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 / §5.
    status:
      implement: done
      test: done
      commit: done

  - id: task-list-readme
    title: task-list — README update for configurable state machine
    prompt: |
      Update packages/task-list/README.md to document:
      - StateMachineDef / EventDef / openTaskList stateMachine option
      - defaultStateMachine and its event names (plan/start/complete/archive)
      - fire / canFire / events
      - Removal of transition (so users don't look for it)
      - The constraint that create starts at initial and update can't change state

      Keep diffs minimal — only document what changed. No new env vars to
      list. Per project rule, do not add anything outside what changed.
    status:
      implement: done
      commit: open

  - id: toolcraft-humaninloop-config
    title: toolcraft — humanInLoop field on CommandConfig + group inheritance
    prompt: |
      In packages/toolcraft, add the humanInLoop decoration to commands and
      groups. Files:

      Create packages/toolcraft/src/human-in-loop/types.ts with:
        HumanInLoopConfig<TParamsSchema> { mode: "sync"|"async"; message: (ctx) => string; declineInputPrompt? }
        HumanInLoopRuntimeOptions { provider?, taskList?, listName?, binPath? }
        HumanInLoopPending { status, approvalId, message, enqueuedAt }
        ApprovalDeclinedError extends UserError { reason?, approvalId?, commandPath }

      Create packages/toolcraft/src/human-in-loop/config.ts with:
        validateHumanInLoopOnDefine(config) — throws on:
          - both `confirm: true` AND `humanInLoop` set
          - mode not in ["sync","async"]
          - message not a function
        mergeHumanInLoopFromGroup(group, child) — handles inheritance:
          child set        → use child verbatim
          child === null   → opts out
          child === undef  → inherit from group's humanInLoop (if set)

      Modify packages/toolcraft/src/index.ts:
      - Add `humanInLoop?: HumanInLoopConfig<TParamsSchema> | null` to
        CommandConfig and Command (materialised).
      - Add `humanInLoop?: HumanInLoopConfig<AnyObjectSchema> | null` to
        GroupConfig and Group.
      - defineCommand calls validateHumanInLoopOnDefine.
      - defineGroup carries the field through inheritance via the shared
        mergeInheritedMetadata path used by scope/secrets — extend that path
        to call mergeHumanInLoopFromGroup.

      Tests in packages/toolcraft/src/human-in-loop/config.test.ts:
      - defineCommand materialises the config
      - confirm: true + humanInLoop throws
      - mode "weird" throws; non-function message throws
      - Group inheritance: inherits, opt-out via null, override

      Do NOT wire the gate yet — only types + validation + inheritance plumbing.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 / §4 (Module-boundary types).
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-approval-state-machine
    title: toolcraft — approvalStateMachine declaration
    prompt: |
      Create packages/toolcraft/src/human-in-loop/state-machine.ts:

        export type ApprovalState = "pending" | "approved-running" | "approved-done" | "approved-failed" | "declined";
        export type ApprovalEvent = "start" | "succeed" | "fail" | "decline";

        export const approvalStateMachine: StateMachineDef<ApprovalState, ApprovalEvent> = {
          initial: "pending",
          states: ["pending", "approved-running", "approved-done", "approved-failed", "declined"],
          events: {
            start:   { from: ["pending"],          to: "approved-running" },
            succeed: { from: ["approved-running"], to: "approved-done"    },
            fail:    { from: ["approved-running"], to: "approved-failed"  },
            decline: { from: ["pending"],          to: "declined"         },
          },
        };

      Re-export from packages/toolcraft/src/human-in-loop/index.ts.

      Tests in packages/toolcraft/src/human-in-loop/state-machine.test.ts:
      - validateMachine(approvalStateMachine) does not throw
      - the 4 expected events exist with the documented from/to

      No imports from agent-human-in-loop or task-list runtime code yet.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "The approval state machine".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-default-provider
    title: toolcraft — lazy default provider for platform
    prompt: |
      Create packages/toolcraft/src/human-in-loop/default-provider.ts:

        export function defaultProviderForPlatform(): HumanInLoopProvider

      - On darwin: returns osascriptProvider({ title: "Approval needed" }) from
        @poe-code/agent-human-in-loop.
      - Otherwise: returns a "noProviderConfigured" provider whose
        requestApproval throws UserError("no human-in-loop provider configured
        for this platform — pass humanInLoop.provider to the runtime").
      - Built lazily (factory call deferred to first invocation, not import time).

      Add @poe-code/agent-human-in-loop to packages/toolcraft/package.json
      runtime dependencies.

      Tests in packages/toolcraft/src/human-in-loop/default-provider.test.ts:
      - On darwin (mock platform): factory returns the osascript provider id;
        does not invoke osascript at construction.
      - On non-darwin (mock platform): requestApproval throws UserError with the
        documented message.
      - Memoisation: calling defaultProviderForPlatform() twice returns the
        same instance per runtime instance (use a closure-scoped factory).

      Reference: docs/plans/toolcraft-human-in-loop.md §2 "Default provider"
      and §3 "The gate — sync path".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-gate-sync
    title: toolcraft — invokeWithHumanInLoop sync path
    prompt: |
      Create packages/toolcraft/src/human-in-loop/gate.ts.

      Implement:
        export async function invokeWithHumanInLoop<T>(
          node: Command<any, any, any, T>,
          ctx: HandlerContext,
          runtimeOptions: HumanInLoopRuntimeOptions | undefined,
          commandPath: string,
        ): Promise<T | HumanInLoopPending>

      Behaviour for this task — sync only:
      - If !node.humanInLoop → return node.handler(ctx)
      - If node.humanInLoop.mode === "sync":
          message = node.humanInLoop.message({ params: ctx.params, commandPath })
          provider = resolveProvider(runtimeOptions)
          result = await provider.requestApproval({ message, declineInputPrompt: node.humanInLoop.declineInputPrompt })
          if declined → throw new ApprovalDeclinedError({ reason: result.reason, commandPath })
          return node.handler(ctx)
      - If mode === "async": throw an explicit "not yet implemented" error
        (filled in by a later task). This keeps the sync path testable in isolation.

      resolveProvider(runtimeOptions): if runtimeOptions?.provider present →
      use it; else → defaultProviderForPlatform(). Memoise the default per
      runtime instance.

      Tests in packages/toolcraft/src/human-in-loop/gate.test.ts using
      mockProvider from @poe-code/agent-human-in-loop:
      - Sync, approved → handler runs, returns its result. Provider received the formatted message.
      - Sync, declined (no reason) → throws ApprovalDeclinedError; handler not called.
      - Sync, declined with reason → throws ApprovalDeclinedError carrying the reason.
      - Sync, no provider on darwin → uses lazy default (verify osascript factory called with injected fake binary).
      - Sync, no provider on non-darwin → UserError with the documented message.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "The gate — sync path".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-cli-wiring
    title: toolcraft — wire gate into runCLI
    prompt: |
      In packages/toolcraft/src/cli.ts, replace the direct
      `await state.command.handler(context)` invocation (~line 2831) with
      `await invokeWithHumanInLoop(state.command, context, runtimeOptions, commandPath)`.

      Required changes:
      - Add `humanInLoop?: HumanInLoopRuntimeOptions` to the runCLI options.
      - Pass humanInLoop options through to the gate at the call site.
      - Build commandPath from the resolved group/command tree (dotted form,
        same as used elsewhere — search the codebase for an existing helper;
        if none, write one inline).
      - Catch ApprovalDeclinedError at the top-level CLI loop and render
        "Declined: <reason>" (or "Declined.") then exit non-zero.
      - Render HumanInLoopPending results as the queued banner format from
        the plan §2:
          ✓ Queued for human approval (id: <id>)
            Message: <message>
            Track:   toolcraft approvals show <id>
        and exit 0.
      - The pre-existing `confirm: true` TTY prompt block (~lines 2816–2828)
        stays, but is bypassed when humanInLoop is set on the same command —
        the build-time check from the earlier task already prevents both, so
        this is just a guard.

      Integration tests in
      packages/toolcraft/src/human-in-loop/cli-runtime.integration.test.ts:
      - Sync humanInLoop command, approved → exit 0, expected stdout.
      - Sync, declined → exit non-zero, message contains "Declined".
      Use a fake provider, no real osascript.

      Async-mode commands in this task should produce the "not yet implemented"
      error from the gate; the integration test for async lives in a later task.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "Where the code
      lives" and §5 "Files to change".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-async-enqueue
    title: toolcraft — async path + approval-tasks adapter
    prompt: |
      Implement the async branch in packages/toolcraft/src/human-in-loop/gate.ts
      and create packages/toolcraft/src/human-in-loop/approval-tasks.ts.

      approval-tasks.ts:
        ensureApprovalList(runtimeOptions): Promise<{ taskList, listName, tasks }>
          - If runtimeOptions.taskList is a TaskList → use it directly.
          - If runtimeOptions.taskList is { dir, format } → call
            openTaskList({ type: format, path/dir, stateMachine: approvalStateMachine })
            and memoise on the runtime instance (closure).
          - If unset → throw UserError("humanInLoop.taskList required for async-mode commands")
          - Verify the list's stateMachine equals approvalStateMachine
            (compare by reference first; if not the same reference, fall back
            to deep-equal of states[] and events[] keys/from/to). Mismatch →
            UserError("approvals task-list configured with a different state
            machine; pass approvalStateMachine when opening the list"). Cache
            the check result on the runtime instance.

        enqueueApproval({ tasks, payload }): { approvalId, pending }
          - approvalId = `<YYYY-MM-DDTHH-MM-SS>-<6 hex>`
          - tasks.create({ id, name: `${commandPath} (${enqueuedAt})`, metadata })
            where metadata = { schemaVersion: 1, approvalId, commandPath, params,
            message, declineInputPrompt, enqueuedAt, pid: null, result: null, error: null }
          - Returns the HumanInLoopPending marker.

        loadApproval({ tasks, approvalId }): payload | undefined

      gate.ts async branch:
      - Call ensureApprovalList + enqueueApproval.
      - Call spawnApprovalRunner(approvalId, runtimeOptions) — IMPORTED from
        a not-yet-existing spawn.ts; for this task, accept that the import
        doesn't resolve at runtime (a stub is fine: write spawn.ts with a
        no-op default that the next task replaces).
      - Return the pending marker without awaiting the child.

      Tests in gate.test.ts (extend) and approval-tasks.test.ts:
      - Async, no taskList → UserError("...taskList required...")
      - Async, with taskList instance → tasks.create called with right metadata;
        spawnApprovalRunner called with approvalId; returns HumanInLoopPending.
      - Async, with { dir, format } → openTaskList called once and memoised
        across calls (use injected openTaskList for the test).
      - Async, mismatched state machine on the list → UserError mentioning
        approvalStateMachine.

      Use memfs for in-memory yaml-file backend tests.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "The gate — async path"
      and "Integration walkthrough".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-spawn-runner
    title: toolcraft — spawn.ts detached re-exec
    prompt: |
      Replace the stub at packages/toolcraft/src/human-in-loop/spawn.ts with
      a proper implementation:

        export function spawnApprovalRunner(
          approvalId: string,
          runtimeOptions: HumanInLoopRuntimeOptions,
          spawnFn?: typeof import("node:child_process").spawn,   // injected for tests
        ): void

      Body:
        const { execPath, entryArgs } = runtimeOptions.binPath ?? {
          execPath: process.execPath,
          entryArgs: [process.argv[1]!],
        };
        const fn = spawnFn ?? (await import("node:child_process")).spawn;
        const child = fn(execPath, [...entryArgs, "approvals", "run", approvalId], {
          detached: true,
          stdio: "ignore",
          env: process.env,
          cwd: process.cwd(),
        });
        child.unref();

      (Use sync import — the real spawn signature is sync. Top-level await
      is not needed.)

      Tests in packages/toolcraft/src/human-in-loop/spawn.test.ts:
      - spawnApprovalRunner invokes the injected spawnFn with execPath +
        [...entryArgs, "approvals", "run", approvalId].
      - Spawn options include detached: true, stdio: "ignore"; child.unref()
        is called.
      - Default binPath uses process.execPath + [process.argv[1]] when
        runtimeOptions.binPath is unset.
      - Custom binPath is honoured.
      - Tests use a mock spawnFn returning a stub ChildProcess with an
        unref() spy. No real child_process.spawn invocation.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "Re-exec details".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-runner-and-approvals-commands
    title: toolcraft — runner.ts and approvals built-in commands
    prompt: |
      Create:
      - packages/toolcraft/src/human-in-loop/runner.ts
      - packages/toolcraft/src/human-in-loop/approvals-commands.ts

      runner.ts:
        export async function runApproval(
          approvalId: string,
          runtimeOptions: HumanInLoopRuntimeOptions,
          root: CommandNode<any>,
        ): Promise<void>

        Steps:
          1. ensureApprovalList(runtimeOptions); tasks.get(approvalId).
             If task.state !== "pending" → return silently (idempotent re-run).
          2. provider = resolveProvider(runtimeOptions).
          3. await provider.requestApproval({ message, declineInputPrompt }) using metadata.
          4. Declined → tasks.fire(approvalId, "decline", { metadataPatch: { error: { reason } } }); return.
          5. Approved → tasks.fire(approvalId, "start", { metadataPatch: { pid: process.pid } }).
             Look up the command by metadata.commandPath in the loaded root
             (resolve dotted path through children).
             Build a fresh HandlerContext: params from metadata.params; secrets from env (re-resolve);
             fs/env/fetch full instances; progress(message) is a no-op.
             Call node.handler(ctx) DIRECTLY (do NOT call invokeWithHumanInLoop).
             Success: tasks.fire(approvalId, "succeed", { metadataPatch: { result } }).
                If result is not JSON-serializable, fire "fail" instead with
                { error: { message: "result not JSON-serializable" } }.
             Throw: tasks.fire(approvalId, "fail", { metadataPatch: { error: { name, message, stack } } }).

      approvals-commands.ts: define a group `approvals` with three commands
      using defineCommand/defineGroup:
        approvals.list — params: { state?: string } — wraps tasks.all(filter);
          render rich table; render markdown / json renderers.
        approvals.show — params: { approvalId: string } — wraps tasks.get(id);
          render key/value rich block.
        approvals.run — params: { approvalId: string }; scope: ["cli"];
          handler calls runApproval(approvalId, ctx.runtimeOptions, root).
          (The runtime entry-points expose runtimeOptions and root to this
          built-in via a context augmentation; document the shim if needed.)

      None of the three declare humanInLoop.

      Wire into all three runtime entry-points (cli.ts, mcp.ts, sdk.ts):
      Before resolving the user's root, merge the built-in `approvals` group
      onto the root's children. If the user's root already has an `approvals`
      group → throw at startup: "Error: 'approvals' is reserved for
      human-in-loop built-ins".

      Tests in packages/toolcraft/src/human-in-loop/runner.test.ts:
      - Idempotent: state ≠ "pending" exits without provider call.
      - Approve path: fires start, runs handler, fires succeed with result.
      - Decline path: fires decline with reason in metadata.
      - Handler throws: fires fail with { name, message, stack }.
      - Non-JSON-serializable result: fires fail with the documented message.
      - Provider throws: fires fail with the provider error message.

      Tests in packages/toolcraft/src/human-in-loop/approvals-commands.test.ts:
      - approvals.list returns tasks; --state filter works (single + multiple).
      - approvals.show returns the task; unknown id throws TaskNotFoundError.
      - approvals.run is reachable via CLI; NOT reachable via MCP or SDK
        (verify scope filtering).
      - approvals.run throws if taskList runtime option is unset.
      - User-defined `approvals` group → startup error.

      Use memfs + an in-memory yaml-file backend; no real spawn.

      Reference: docs/plans/toolcraft-human-in-loop.md §3 "Runner",
      "Built-in `approvals` commands", and §4 tests.
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-mcp-sdk-wiring
    title: toolcraft — wire gate into MCP and SDK runtimes
    prompt: |
      Wire invokeWithHumanInLoop into:

      packages/toolcraft/src/mcp.ts (~line 523):
      - Replace direct `await tool.command.handler({...baseContext, params})`
        with the gate call.
      - Render HumanInLoopPending as text content with TWO entries:
          1) human summary line: "Queued for human approval (id: <id>). Track with `toolcraft approvals show <id>`."
          2) JSON of the pending marker as a text block.
        isError: false.
      - Catch ApprovalDeclinedError → return { isError: true, content: [...] }
        with two entries: the human "Declined: <reason>" line and the JSON
        { outcome: "declined", reason, commandPath }.
      - Add humanInLoop?: HumanInLoopRuntimeOptions to createMCPServer options.

      packages/toolcraft/src/sdk.ts (~lines 409–435):
      - Replace the direct handler call inside the returned async function
        with the gate call.
      - HumanInLoopPending is returned as-is (the SDK return type for
        async-mode commands becomes HumanInLoopPending — type-level only,
        runtime is a value pass-through).
      - ApprovalDeclinedError is thrown to the caller (do not catch).
      - Add humanInLoop?: HumanInLoopRuntimeOptions to createSDK options.

      Integration tests:
      - packages/toolcraft/src/human-in-loop/mcp-runtime.integration.test.ts:
        - Sync MCP, approved → tool returns handler result.
        - Sync MCP, declined → tool returns isError: true with the structured content.
        - Async MCP → tool returns the pending marker; agent calls
          approvals.show and observes pending state.
      - packages/toolcraft/src/human-in-loop/sdk-runtime.integration.test.ts:
        - Sync SDK, approved → returns handler result.
        - Sync SDK, declined → throws ApprovalDeclinedError.
        - Async SDK → returns HumanInLoopPending.
        - Async SDK → spawn fn called with the right args (use injected
          spawn from the spawn.ts seam).

      Use mockProvider, in-memory yaml-file backend, injected spawn.

      Reference: docs/plans/toolcraft-human-in-loop.md §2
      "Caller-facing behaviour" and §4 "Integration tests".
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-readme-and-qa
    title: toolcraft — README and QA-human-in-loop.md
    prompt: |
      Update packages/toolcraft/README.md to document:
      - The humanInLoop field on commands and groups
      - Group inheritance + opt-out via null
      - The HumanInLoopRuntimeOptions shape on runCLI / createMCPServer / createSDK
      - The default provider behaviour (osascript on darwin; UserError elsewhere)
      - The built-in `approvals` group commands (list, show, run)
      - The provider blueprint with the Slack example from the plan §2
      - The constraint that the host bin must call runCLI/createMCPServer/createSDK
        with the same humanInLoop options whether invoked normally or as
        `approvals run` (host wiring must not branch on argv before runCLI)
      - confirm: true is deprecated; humanInLoop replaces it
      - JSON-serializable result constraint for async commands
      - Secrets in the runner are re-resolved from process.env

      Create packages/toolcraft/QA-human-in-loop.md (markdown checklist, NOT a
      script — per project rule):
      - A real osascript dialog pops for sync mode on darwin.
      - Async mode: dialog pops in a detached subprocess; CLI returns immediately;
        ps shows the runner after CLI exit.
      - approvals list shows the running entry; after approval, state is
        approved-done and result is populated.
      - Decline-with-reason: reason ends up in the task's metadata.
      - User-defined `approvals` group → startup error.

      Per project rule: NEVER add anything beyond what changed.
    status:
      implement: open
      commit: open

  - id: full-sweep
    title: full sweep — lint, typecheck, tests, screenshots
    prompt: |
      Run from the repo root:
      - npm run test
      - npm run lint
      - npm run typecheck

      Fix any failures or type errors that surface as a result of the
      humanInLoop work. Do NOT pre-existing-fix unrelated failures.

      Visual spot-test:
      - npm run screenshot-poe-code -- approvals list

      Verify the autonomy gates listed in
      docs/plans/toolcraft-human-in-loop.md §5 "Autonomy gates":
      - grep "LEGAL_TRANSITIONS" packages/task-list/src is empty
      - grep "provider.id ===" packages/toolcraft/src is empty
      - grep "queueDir" packages/toolcraft/src is empty
      - grep -E "if .*format === \"(markdown-dir|yaml-file)\"" packages/toolcraft/src/human-in-loop is empty
      - No real child_process.spawn / osascript / filesystem write in any test
      - Both READMEs updated (task-list + toolcraft)
    status:
      test: open
      commit: open
---

# toolcraft-human-in-loop

Decorate toolcraft commands as `human-in-loop`. At call time the runtime gates the handler on a human answer. Two modes: sync blocks the caller until the human responds; async hands the request off to a separate process and returns immediately with a pending marker.

## 1. What we're building

A new field on `defineCommand` (and inheritable via `defineGroup`) that marks a command as needing human approval before the handler runs. Mode is set **per command**, in the definition. All three runtimes — CLI, MCP, SDK — honour the declared mode; MCP is sync by default in particular (the MCP tool call blocks until the human answers).

The mark drives two behaviours:

- **Sync** — at call time the runtime calls `requestApproval` and awaits it. Approved → run handler and return its result. Declined → throw `UserError` (or return a structured declined result, TBD).
- **Async** — at call time the runtime serialises everything needed to run the handler later (command id, params, resolved secrets handles, context metadata) into a queue, returns a pending marker, and a separate detached process drains its entry: it prompts the human, then runs the handler in that fresh process. The original caller does not wait.

**Provider injection.** The `HumanInLoopProvider` (from the planned `agent-human-in-loop` package) is injectable per runtime entry-point (`runCLI`, `createMCPServer`, `createSDK`). A sensible default exists (osascript on darwin) so most callers don't wire anything; production callers override. There is a documented blueprint for injection — same shape across all three entry-points.

**Storage and tracking — repurposing `task-list`.** The "queue" of pending approvals is a `task-list` (the existing package at `packages/task-list`). Each pending approval is a task; status changes are state-machine events fired on that task. The path is consumer-defined: callers pass either a pre-opened `TaskList` instance or `{ dir, format }` to the runtime entry-point. We do not ship a parallel persistence layer for approvals.

**Ownership.** `task-list` stays its own package (`@poe-code/task-list`); it does not move into toolcraft or into `agent-human-in-loop`. The host application owns the `TaskList` instance — it can use it for non-approval work too, or let toolcraft open one for it. Toolcraft has a runtime dependency on `@poe-code/task-list`; `agent-human-in-loop` does not depend on `task-list` at all (it stays a pure UI primitive). The toolcraft side defines `approvalStateMachine`, the toolcraft-only built-in `approvals.list`/`approvals.show`/`approvals.run` commands, and the gate that wires everything together.

Doing this pulls in one prerequisite change to `task-list`: the state machine becomes **configurable per list**. Today task-list ships a single hardcoded `draft → planned → in-progress → done → archived` machine. For approval tracking we need `pending → approved-running → approved-done | approved-failed | declined`, and consumers will likely want their own machines for other use cases too. This plan specifies that extension. Inspiration: the Ruby [state_machines](https://github.com/state-machines/state_machines) gem (states + events + guarded transitions + introspection), trimmed to a declarative TS object — no fluent class DSL.

The existing `confirm: boolean` on `CommandConfig` is a CLI-only TTY prompt. This plan replaces or layers over it; deciding which is part of level 3.

Non-goals (for now — confirm in level 2):

- Building the approval UI itself. That is `agent-human-in-loop` and is already planned.
- Cross-machine queues, multi-user routing, or any networked service.
- Persistent retry, deadlines, or expiry on pending approvals — bounded scope first.
- A new auth/identity model. Approver identity is "whoever clicked the dialog".
- Notifying the original caller of an async outcome. Async returns "pending"; outcome lives in the queue/log.

## 2. User-facing shape

### Decorating a command

```ts
import { defineCommand } from "toolcraft";

export const deployProd = defineCommand({
  name: "deploy-prod",
  description: "Deploy current build to production",
  params: object({ target: string() }),
  humanInLoop: {
    mode: "sync",
    message: ({ params }) => `Deploy build to ${params.target}?`,
    declineInputPrompt: "Why are you blocking the deploy?",
  },
  handler: async (ctx) => {
    // only runs after a human approves
    return runDeploy(ctx.params.target);
  },
});
```

The `humanInLoop` field — fully explicit form:

```ts
humanInLoop: {
  mode: "sync" | "async";
  message: (ctx: { params: Static<TParamsSchema>; commandPath: string }) => string;
  declineInputPrompt?: string;
}
```

There is **no** `humanInLoop: true` shorthand. Per project rule "explicit over implicit", the author writes `mode` and `message` every time. Skipping `message` would force the runtime to invent one from `name`/`params`, which is implicit-by-naming-convention and not allowed.

`message` runs after params are validated and before the gate. It receives the validated params plus the dotted path (`group.subgroup.command`). It must be sync and return a single line of text — the provider renders it.

### Inheritance via `defineGroup`

```ts
defineGroup({
  name: "deploy",
  humanInLoop: { mode: "sync", message: ({ commandPath }) => `Run ${commandPath}?` },
  children: [deployProd, deployStaging, deployRollback],
});
```

Children inherit unless they set their own `humanInLoop`. Setting `humanInLoop: null` on a child opts out explicitly. Same inheritance shape as `scope` and `secrets`.

### Provider and task-list injection — runtime entry-points

All three entry-points accept the same option shape:

```ts
import { runCLI } from "toolcraft/cli";
import { osascriptProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import { approvalStateMachine } from "toolcraft/human-in-loop";

const taskList = await openTaskList({
  type: "yaml-file",
  path: "./.poe-code/approvals.yaml",
  stateMachine: approvalStateMachine,        // see §3
});

await runCLI({
  root,
  humanInLoop: {
    provider: osascriptProvider({ title: "poe-code" }),
    taskList,                                 // pre-opened TaskList (preferred)
    listName: "approvals",                    // which list inside taskList; default "approvals"
  },
});
```

A convenience form lets the runtime open the task list itself when the host has nothing else using it:

```ts
await runCLI({
  root,
  humanInLoop: {
    provider: osascriptProvider({ title: "poe-code" }),
    taskList: { dir: "./.poe-code/approvals", format: "markdown-dir" },
  },
});
```

The shape is identical across `runCLI`, `createMCPServer`, `createSDK`. No runtime branches on `provider.id`.

### Default provider

If `humanInLoop` is omitted on the entry-point, toolcraft installs a platform-default provider lazily on first use:

- `process.platform === "darwin"` → `osascriptProvider({ title: "Approval needed" })`.
- Other platforms → a built-in `noProviderConfigured` provider that throws `UserError("no human-in-loop provider configured for this platform — pass humanInLoop.provider to the runtime")` when called.

The default is built lazily so non-mac runs that never hit a human-in-loop command never touch osascript.

### Caller-facing behaviour — sync mode

The runtime calls `provider.requestApproval` after params validation and `requires.check`, before the handler. Approved → handler runs, normal result is returned. Declined → the runtime throws `UserError`; the message is `"declined"` or `"declined: <reason>"` if `declineInputPrompt` was set and the human entered text.

Per runtime:

- **CLI** — the dialog pops; the CLI process blocks. Decline → exits non-zero with the `UserError` message. The pre-existing `confirm: true` TTY prompt is **superseded** by `humanInLoop` for any command that sets it; both fields on the same command is a build-time error (level 3 covers the deprecation path for `confirm`).
- **MCP** — the MCP tool call holds open until the human answers. Approve → returns the handler's normal result. Decline → returns `{ isError: true, content: [{ type: "text", text: "declined: ..." }] }` so the agent gets a structured signal.
- **SDK** — `await sdk.deploy.deployProd({ target })` blocks until the human answers, then returns or throws as above.

### Caller-facing behaviour — async mode

The runtime persists the request to the queue and returns a pending marker without ever calling `provider.requestApproval`. A detached subprocess is spawned; that subprocess opens the dialog, waits, then runs the handler in its own process if approved.

Pending marker shape (returned from SDK; rendered by CLI/MCP):

```ts
type HumanInLoopPending = {
  status: "pending-approval";
  approvalId: string;     // queue handle, e.g. "2026-04-26T13-22-09-abc123"
  message: string;        // the formatted prompt
  enqueuedAt: string;     // ISO timestamp
};
```

Per runtime:

**CLI**:

```text
$ toolcraft deploy deploy-prod --target prod
✓ Queued for human approval (id: 2026-04-26T13-22-09-abc123)
  Message: Deploy build to prod?
  Track:   toolcraft approvals show 2026-04-26T13-22-09-abc123
```

Exit 0. The detached subprocess is already running in the background; the CLI does not wait for it.

**MCP** — tool result is text content carrying the pending marker as JSON, plus a one-line summary so the agent can read either form:

```json
{
  "content": [
    { "type": "text", "text": "Queued for human approval (id: 2026-04-26T13-22-09-abc123). Track with `toolcraft approvals show <id>`." },
    { "type": "text", "text": "{\"status\":\"pending-approval\",\"approvalId\":\"...\",\"message\":\"...\",\"enqueuedAt\":\"...\"}" }
  ]
}
```

`isError: false`. The agent can choose to call `toolcraft approvals show` later via another tool.

**SDK** — when `humanInLoop.mode === "async"`, the typed return becomes `HumanInLoopPending` regardless of the handler's `TResult`. The handler's result type is unreachable at the call site (it runs in another process); the caller must use the queue lookup to retrieve it.

### Listing and inspecting pending approvals

Toolcraft ships built-in commands (under a reserved `approvals` group). Each command is a thin wrapper over the configured `TaskList`:

```text
$ toolcraft approvals list
ID                              COMMAND                STATE              AGE
2026-04-26T13-22-09-abc123      deploy.deploy-prod     pending            2m
2026-04-26T13-10-44-def456      deploy.deploy-prod     approved-done      14m

$ toolcraft approvals show 2026-04-26T13-22-09-abc123
state:      pending
command:    deploy.deploy-prod
params:     { "target": "prod" }
message:    Deploy build to prod?
enqueuedAt: 2026-04-26T13:22:09Z
```

Same commands available on the SDK:

```ts
await sdk.approvals.list();
await sdk.approvals.show({ approvalId });
```

These never require approval themselves. State strings come from the configured machine (`pending`, `approved-running`, `approved-done`, `approved-failed`, `declined`).

### Provider blueprint — how to write your own

The blueprint is one file implementing `HumanInLoopProvider` from `@poe-code/agent-human-in-loop`. There is no toolcraft-specific provider interface; toolcraft consumes the upstream type as-is.

```ts
// my-app/providers/slack-approval.ts
import type { HumanInLoopProvider, ApprovalRequest, ApprovalResult } from "@poe-code/agent-human-in-loop";

export function slackApprovalProvider(opts: { channel: string; client: SlackClient }): HumanInLoopProvider {
  return {
    id: "slack-approval",
    async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
      const ts = await opts.client.postApprovalMessage(opts.channel, request.message);
      const click = await opts.client.waitForButtonClick(ts);
      if (click.action === "approve") return { outcome: "approved" };
      if (request.declineInputPrompt) {
        const reason = await opts.client.openModal(click.userId, request.declineInputPrompt);
        return reason ? { outcome: "declined", reason } : { outcome: "declined" };
      }
      return { outcome: "declined" };
    },
  };
}

// wiring
await runCLI({ root, humanInLoop: { provider: slackApprovalProvider({ channel: "#deploys", client }) } });
```

The README for the queue/runtime package will carry exactly this example so future provider authors copy it.

### Errors the user sees

- `humanInLoop` set on a command but no provider available **and** platform has no default → `UserError("no human-in-loop provider configured ...")` at first call, not at startup. (Lazy: a non-darwin runtime that never invokes a human-in-loop command runs fine.)
- Both `confirm: true` and `humanInLoop` set on the same command → build-time error from `defineCommand`.
- Async mode declared on a command in CLI runtime when stdout is not a TTY and `--no-detach` is set (level 3) → falls back to sync, with a one-line warning. Otherwise async always detaches.
- Provider throws → propagates as-is. Toolcraft does not wrap provider errors.

### Decline shape — final

Sync decline produces a single canonical structured result; each runtime renders it appropriately.

```ts
// in toolcraft
export class ApprovalDeclinedError extends UserError {
  readonly reason?: string;
  readonly approvalId?: string;     // set in async-resolved decline; undefined for sync
  readonly commandPath: string;
}
```

**CLI** — `ApprovalDeclinedError` is caught at the top level; CLI prints `Declined: <reason>` (or `Declined.`) and exits non-zero.

**MCP** — `ApprovalDeclinedError` is caught and converted to a structured tool result with `isError: true`:

```json
{
  "isError": true,
  "content": [
    { "type": "text", "text": "Declined: blocked by oncall" },
    { "type": "text", "text": "{\"outcome\":\"declined\",\"reason\":\"blocked by oncall\",\"commandPath\":\"deploy.deploy-prod\"}" }
  ]
}
```

**SDK** — the error is thrown to the caller. `try { await sdk.deploy.deployProd(...) } catch (e) { if (e instanceof ApprovalDeclinedError) ... }`.

## 3. Implementation details and technical decisions

### Where the code lives

Two packages change.

**`packages/task-list/`** gains a configurable state machine — see "Task-list state machine extension" below. This is a prerequisite of the toolcraft work; it ships in the same release.

**`packages/toolcraft/`** gains the human-in-loop module:

```text
packages/toolcraft/src/human-in-loop/
├── index.ts                  # public exports (HumanInLoopOptions, ApprovalDeclinedError, approvalStateMachine, types)
├── config.ts                 # CommandConfig.humanInLoop field shape, validation, group inheritance
├── gate.ts                   # the call-site gate: invokeWithHumanInLoop(node, ctx, options)
├── approval-tasks.ts         # thin adapter: enqueue / load / fire-event over a TaskList
├── spawn.ts                  # detached re-exec: spawnApprovalRunner(approvalId, options)
├── runner.ts                 # the child-process side: load approval, prompt, run handler, transition task
├── default-provider.ts       # lazy platform default (osascript on darwin)
├── state-machine.ts          # the approval state machine declaration (config object)
└── approvals-commands.ts     # built-in `approvals.list` / `approvals.show` / `approvals.run` toolcraft commands
```

No bespoke queue file format, no bespoke list/show logic — that all lives in task-list now. The toolcraft side is pure adapter + handler-runner + commands.

The runtime entry-point option:

```ts
export interface HumanInLoopRuntimeOptions {
  provider?: HumanInLoopProvider;
  taskList?: TaskList | { dir: string; format: "markdown-dir" | "yaml-file" };
  listName?: string;            // default "approvals"
  binPath?: { execPath: string; entryArgs: readonly string[] };
}
```

`taskList` is the only field a host *must* set if any command declares `mode: "async"`. Two acceptance forms:

- **`TaskList` instance** — host owns the lifecycle. Host is expected to have called `openTaskList({ ..., stateMachine: approvalStateMachine })` (or to have a list within the store that uses that machine). Toolcraft locates the list by `listName` (default `"approvals"`).
- **`{ dir, format }`** — toolcraft calls `openTaskList({ type: format, /* dir or path */, stateMachine: approvalStateMachine })` lazily on first need and memoises the instance on the runtime. Toolcraft does **not** close it; the runtime returns the instance via an internal hook for tests but production hosts that pass this form do not need to do anything else.

Mismatch (host passed a `TaskList` whose list uses a different state machine) is detected lazily — see edge cases.

### Integration walkthrough

End-to-end for an async command in the CLI runtime:

1. Host calls `runCLI({ root, humanInLoop: { provider, taskList: { dir: "./.poe-code/approvals", format: "yaml-file" } } })`.
2. The CLI parses argv, resolves the matched command. The command declares `humanInLoop: { mode: "async", message, ... }`.
3. After param validation and `requires.check`, the CLI calls `invokeWithHumanInLoop(node, ctx, runtimeOptions, commandPath)`.
4. `invokeWithHumanInLoop` sees `mode === "async"`. It calls `ensureApprovalList(runtimeOptions)` — first call opens the task-list lazily and caches it on the runtime.
5. `enqueueApproval` formats the message (`node.humanInLoop.message({ params, commandPath })`), generates an `approvalId`, and calls `tasks.create({ id, name, state: "pending", metadata })`. task-list's backend persists.
6. `spawnApprovalRunner(approvalId, runtimeOptions)` re-execs the host bin with `approvals run <id>`, detached + unref'd.
7. The CLI's render layer prints the queued banner; CLI exits 0.
8. The detached runner boots: it calls the same `runCLI(root, { ...same runtime options... })`. The host's bin code path is identical — it must call `runCLI` with the same options whether invoked normally or as `approvals run`. (Documented constraint: host wiring must not branch on argv before `runCLI`.) The built-in `approvals.run` command receives `--approval-id <id>` and dispatches to `runner.ts:runApproval`.
9. `runApproval` opens the same task-list (via the same `taskList` option), `tasks.get(id)`, fires `start` (pid in metadata), invokes `provider.requestApproval`. On approve: looks up the original command by `commandPath`, builds a fresh ctx, calls `node.handler(ctx)` directly. Fires `succeed` or `fail` based on outcome. On decline: fires `decline`.
10. Runner exits 0. Host can call `approvals.show <id>` at any later point to read the result.

The same flow applies for MCP and SDK runtimes, except step 7 returns the pending marker as the tool/SDK return value instead of stdout text.

### Task-list state machine extension

Today `task-list` ships one hardcoded state machine. We make it pluggable. The shape is a plain TS object — no DSL, no class — modelled on `state_machines` (Ruby) but trimmed.

```ts
// packages/task-list/src/state-machine.ts
export interface StateMachineDef<TState extends string, TEvent extends string> {
  readonly initial: TState;
  readonly states: readonly TState[];
  readonly events: Readonly<Record<TEvent, EventDef<TState>>>;
}

export interface EventDef<TState extends string> {
  readonly from: readonly TState[] | "*";   // "*" = any state
  readonly to: TState;
  readonly guard?: (task: Task) => true | string;       // string = decline reason; true = allow
  readonly onEnter?: (task: Task) => void | Promise<void>;
  readonly onExit?: (task: Task) => void | Promise<void>;
}
```

Why object-not-DSL: per project rule "no zod, plain TS guards" and "Providers must be declarative and minimal: you are not allowed to add repeated information that can be inferred". The Ruby gem's class-attached fluent DSL doesn't translate cleanly — and we don't need multi-machine-per-class or namespaced events. One machine per list is sufficient.

What we keep from the gem:

- **Named events** drive transitions. Callers say `tasks.fire(id, "approve")`, not `tasks.transition(id, "approved-running")`. This is the main ergonomic win — state-from-state-to is encoded in the event name.
- **Guards**: a function that returns `true` to allow or a string (the decline reason) to reject. Throws `InvalidTransitionError` with the reason when rejected. No `if_state`/`unless_state` argument forms — guards are just functions.
- **Callbacks** (`onEnter` / `onExit`): minimal hooks per event. No `before_transition any => any` global hooks. If a consumer wants global hooks they wrap `tasks.fire` in their own helper.
- **Introspection**: `tasks.canFire(id, event)` returns `boolean`, `tasks.events(id)` returns the events legal from the task's current state.

What we drop:

- Multiple machines per object — out of scope; `task-list` already has one state field per task.
- Path analysis / `state_paths` — not used.
- Around-transition hooks, async/Fiber support — over-engineered for what a flat queue needs.
- Auto-derived predicate methods (`task.parked?`) — TS can't grow methods at runtime cleanly without a Proxy, and we don't want one.

`Tasks` API after the rewrite:

```ts
interface Tasks {
  // read
  all(filter?: { state?: string | readonly string[] }): Promise<readonly Task[]>;
  get(id: string): Promise<Task>;

  // write — non-state
  create(input: { id: string; name: string; description?: string; metadata?: Record<string, unknown> }): Promise<Task>;
  update(id: string, patch: { name?: string; description?: string; metadata?: Record<string, unknown> }): Promise<Task>;
  delete(id: string): Promise<void>;

  // write — state machine
  fire(id: string, event: string, opts?: { metadataPatch?: Record<string, unknown> }): Promise<Task>;
  canFire(id: string, event: string): Promise<boolean>;
  events(id: string): Promise<readonly string[]>;          // events legal from current state
}
```

`tasks.transition(id, to)` is **removed**. State changes go through `fire` exclusively — eliminating the "two events with the same `(from, to)`" ambiguity, dropping `AmbiguousTransitionError`, and forcing consumers to declare named events they care about. `create` no longer accepts a `state` field; new tasks always start at the machine's `initial`. `update` rejects an attempt to change `state` (only `name`/`description`/`metadata`). Pre-release license per the user's instruction; no external callers exist outside the task-list package.

Default machine compatibility: the `draft → planned → in-progress → done → archived` model is preserved as `defaultStateMachine`, with explicit event names:

```ts
export const defaultStateMachine: StateMachineDef<TaskState, "plan" | "start" | "complete" | "archive"> = {
  initial: "draft",
  states: ["draft", "planned", "in-progress", "done", "archived"],
  events: {
    plan:     { from: ["draft"],         to: "planned"     },
    start:    { from: ["planned"],       to: "in-progress" },
    complete: { from: ["in-progress"],   to: "done"        },
    archive:  { from: "*",               to: "archived"    },
  },
};
```

Passing no `stateMachine` to `openTaskList` selects this default. Existing task-list tests are rewritten in terms of `fire`.

Validation at `openTaskList`:

- `events[*].from` references states present in `states[]` (or is `"*"`).
- `events[*].to` references a state present in `states[]`.
- `initial` is in `states[]`.
- No event with `from === "*"` and `to === currentState` for any state (would create a no-op self-loop). Rejected at config time.

Plain TS — no schema library.

### The approval state machine

```ts
// packages/toolcraft/src/human-in-loop/state-machine.ts
import type { StateMachineDef } from "@poe-code/task-list";

export type ApprovalState =
  | "pending"
  | "approved-running"
  | "approved-done"
  | "approved-failed"
  | "declined";

export type ApprovalEvent = "start" | "succeed" | "fail" | "decline";

export const approvalStateMachine: StateMachineDef<ApprovalState, ApprovalEvent> = {
  initial: "pending",
  states: ["pending", "approved-running", "approved-done", "approved-failed", "declined"],
  events: {
    start:    { from: ["pending"],            to: "approved-running" },
    succeed:  { from: ["approved-running"],   to: "approved-done"    },
    fail:     { from: ["approved-running"],   to: "approved-failed"  },
    decline:  { from: ["pending"],            to: "declined"         },
  },
};
```

Approval task metadata (stored on the task record):

```jsonc
{
  "name": "deploy.deploy-prod (2026-04-26T13:22:09Z)",
  "state": "pending",
  "metadata": {
    "schemaVersion": 1,
    "approvalId": "2026-04-26T13-22-09-abc123",
    "commandPath": "deploy.deploy-prod",
    "params": { "target": "prod" },
    "message": "Deploy build to prod?",
    "declineInputPrompt": null,
    "enqueuedAt": "2026-04-26T13:22:09.000Z",
    "pid": null,                          // set on `start`
    "result": null,                       // set on `succeed`
    "error": null                         // set on `fail` or `decline`
  }
}
```

Task `id` = `approvalId`. Qualified id = `approvals/<approvalId>`. The runner calls `tasks.fire(id, "start", { metadataPatch: { pid } })`, then `fire("succeed", { metadataPatch: { result } })` or `fire("fail", { metadataPatch: { error } })`.

### Command config — type and inheritance plumbing

Add to `CommandConfig`:

```ts
export interface HumanInLoopConfig<TParamsSchema extends ObjectSchema<any>> {
  mode: "sync" | "async";
  message: (ctx: { params: Static<TParamsSchema>; commandPath: string }) => string;
  declineInputPrompt?: string;
}

export interface CommandConfig<...> {
  // ...existing fields
  humanInLoop?: HumanInLoopConfig<TParamsSchema> | null;
}
```

`Command<...>` mirrors the materialized shape (no optionality differences vs config — `null` means "explicit opt-out from group inheritance" and is preserved).

Group inheritance follows the existing `scope`/`secrets` pattern in `mergeInheritedMetadata`:

- If a child command sets `humanInLoop` → use the child's config verbatim.
- If a child sets `humanInLoop: null` → no gate, regardless of group.
- If a child omits `humanInLoop` and the parent group has it → inherit the group's config.

`defineGroup` accepts `humanInLoop?: HumanInLoopConfig<AnyObjectSchema>` at the group level (the message function's `params` is typed as the params of whichever command it ends up gating; in practice group-level messages should rely on `commandPath` and not poke at params).

### Defensive validation at `defineCommand`

- Both `confirm: true` and `humanInLoop` set → `throw new Error("command '<name>': use either confirm or humanInLoop, not both")`. Build-time, not runtime.
- `humanInLoop.mode` not in `["sync", "async"]` → throw at definition.
- `humanInLoop.message` not a function → throw at definition.

These are the only static checks. No regex, no schema lib, just plain TS guards (per project rule "no zod").

### `confirm: true` deprecation path

Existing callers using `confirm: true` keep working in v1; the field is marked deprecated in JSDoc and in the README, and the migration is one-line:

```ts
// before
confirm: true,

// after
humanInLoop: {
  mode: "sync",
  message: ({ commandPath }) => `Run ${commandPath}?`,
},
```

Removed from `Command` in a later release; not in this plan's scope.

### The gate — sync path

Implemented in `gate.ts`:

```ts
export async function invokeWithHumanInLoop<T>(
  node: Command<any, any, any, T>,
  ctx: HandlerContext<any, any, any>,
  runtimeOptions: HumanInLoopRuntimeOptions | undefined,
  commandPath: string,
): Promise<T | HumanInLoopPending> {
  if (!node.humanInLoop) return node.handler(ctx);

  const message = node.humanInLoop.message({ params: ctx.params, commandPath });
  const provider = resolveProvider(runtimeOptions);

  if (node.humanInLoop.mode === "sync") {
    const result = await provider.requestApproval({
      message,
      declineInputPrompt: node.humanInLoop.declineInputPrompt,
    });
    if (result.outcome === "declined") {
      throw new ApprovalDeclinedError({ reason: result.reason, commandPath });
    }
    return node.handler(ctx);
  }

  return enqueueAsync({ node, ctx, message, runtimeOptions, commandPath });
}
```

`resolveProvider` returns the configured provider, falling back to `defaultProviderForPlatform()`. The default is built on first call and memoized at module scope per runtime instance (not globally — each `runCLI`/`createMCPServer`/`createSDK` instance memoizes its own).

### The gate — async path

`enqueueAsync` does four things:

1. Resolve the configured `taskList` and `listName` from `runtimeOptions`. If unset → `throw new UserError("humanInLoop.taskList required for async-mode commands")`.
2. Generate `approvalId`: `<ISO>-<6 hex>`. ISO is `YYYY-MM-DDTHH-MM-SS` (filesystem-safe).
3. Call `tasks.create({ id: approvalId, name, state: "pending", metadata })` — task-list handles persistence and atomic writes per its existing backend.
4. Spawn the detached runner with `spawnApprovalRunner(approvalId, runtimeOptions)`. Return the `HumanInLoopPending` marker without awaiting the child.

The parent does not pipe stdin/stdout to the child; it spawns with `detached: true`, `stdio: "ignore"`, and `subprocess.unref()` so the parent can exit while the child keeps running.

Persistence, atomic writes, listing, and lookup are all task-list's job. Toolcraft does not own a queue file format.

State machine mismatch detection: at first async-mode call, the gate calls `tasks.events(<probe>)` (or reads the list's machine descriptor — exposed via `taskList.list(name).stateMachine`) and verifies it equals `approvalStateMachine`. Mismatch → `UserError("approvals task-list configured with a different state machine; pass approvalStateMachine when opening the list")`. One-time check, cached on the runtime instance.

### Secrets in the spawned runner

Secrets are not written to the queue file. The runner re-resolves secrets from the same `env` it inherits — `child_process.spawn` inherits `process.env` by default, and the parent does not strip it. This requires that the env in which the runner spawns has the same secret env vars as the parent. The README documents this constraint.

If a future use case requires the env to differ, the queue entry can carry a list of secret names plus a one-shot opaque handle pointing to a secrets cache; out of scope for v1.

### Re-exec details (`spawn.ts`)

```ts
const { execPath, entryArgs } = runtimeOptions.binPath ?? {
  execPath: process.execPath,
  entryArgs: [process.argv[1]!],
};

const child = spawn(execPath, [...entryArgs, "approvals", "run", approvalId], {
  detached: true,
  stdio: "ignore",
  env: process.env,
  cwd: process.cwd(),
});
child.unref();
```

The host's bin invokes `runCLI(root)` (or equivalent). The `approvals` group is automatically added to the root by toolcraft's runtime (see "Built-in commands" below) so `<host-bin> approvals run <id>` reaches the runner regardless of host wiring.

### Built-in `approvals` commands

Toolcraft's three runtime entry-points each merge a built-in `approvals` group into the user's root before resolution:

- `approvals.list` — wraps `tasks.all()`. Default `rich` renderer prints a table; supports `--state pending` filter.
- `approvals.show` — wraps `tasks.get(id)`. Default renderer prints a key/value block.
- `approvals.run` — internal-only, used by the spawned runner. Marked `scope: ["cli"]` (not exposed to MCP or SDK). Accepts `--approval-id <id>`.

Built-ins never declare `humanInLoop`; they are not gated.

If the user's root already has an `approvals` group, toolcraft throws at startup (`Error: 'approvals' is reserved for human-in-loop built-ins`). No silent merge — explicit collision.

### Runner (`runner.ts`)

The runner is what `approvals run <id>` invokes:

1. Open the configured task-list, resolve the approval list, `tasks.get(id)`. If `task.state !== "pending"` → exit 0 silently (idempotent re-runs, e.g. user re-issued the command).
2. Resolve provider via `runtimeOptions` (same options the parent used; the host's `runCLI` passes them through unchanged).
3. Call `provider.requestApproval({ message, declineInputPrompt })` using metadata from the task.
4. If declined → `tasks.fire(id, "decline", { metadataPatch: { error: { reason } } })` and exit 0.
5. If approved → `tasks.fire(id, "start", { metadataPatch: { pid: process.pid } })`, then look up the command by `commandPath` in the loaded root, build a fresh `HandlerContext` (params from the task metadata; secrets from env), call `node.handler(ctx)` directly (bypassing the gate). On success → `tasks.fire(id, "succeed", { metadataPatch: { result } })`. On throw → `tasks.fire(id, "fail", { metadataPatch: { error } })`. Exit 0 either way.

The runner does **not** call the gate (which would re-prompt). It calls `node.handler` directly.

### Edge cases

- **Async-mode command with no `taskList` set** → `UserError("...taskList required...")` at first call. Not at startup.
- **Task-list configured with a different state machine** → `UserError(...)` on first async call. Detected by comparing the list's machine descriptor to `approvalStateMachine`.
- **Detached runner cannot pop a dialog** (no display, sshd session, etc.) — provider rejects; runner fires `fail` with the provider error in metadata. Entry stays inspectable. No retry.
- **Two `approvals.run <id>` invocations race** — the second observes `state !== "pending"` and exits silently. Not a hard guarantee against double-runs (race window between read and `tasks.fire("start")`); v1 relies on async commands being idempotent or the consumer adding external locking. Documented.
- **Task store unparseable / partially written** — task-list backends already handle this; toolcraft does not add a recovery flow.
- **Host shadows `approvals` in their own root** — startup error, as above.
- **Async-mode command in MCP runtime** — works the same as CLI: returns the pending marker text. The MCP client (the agent) is expected to come back later via `approvals.show`. MCP is sync-by-default; a command author can still declare async per command if they want — that decision is theirs.
- **`approvals.run` reachable via MCP/SDK** — undesirable; `scope: ["cli"]` so only the CLI runtime exposes it.
- **`HandlerContext.fs`/`progress`/etc. in the runner** — `progress(message)` no-ops; fs/env/fetch are full instances. Documented.
- **Non-JSON-serializable handler results** — runner converts non-serializable results to `tasks.fire(id, "fail", { metadataPatch: { error: { message: "result not JSON-serializable" } } })`.
- **Approval id collision** in the configured list — `tasks.create` throws `TaskAlreadyExistsError`; the gate retries id generation once, then surfaces the error. With ISO-second + 6-hex suffix collisions are exceedingly unlikely.

### Open questions

- Should the runner emit a log file alongside the task (e.g. `<id>.log`) capturing handler stdout/stderr and the provider trace? Suggesting **no** for v1 (YAGNI). Could store the last 4 KB of stderr in `metadata.error.stderr` if a real need shows up.
- Should `approvals.list --state` accept multiple values (`--state pending,approved-running`)? Trivial in `task-list`; suggesting **yes**.
- Should we add `tasks.fire` introspection to the existing markdown-dir backend's task header (so a task's history is visible in the file)? Suggesting **no** — keeps the file format stable; consumers who want history can add an event-log file separately.
- Should `task-list` ship a `tasks.archive(id)` shortcut that calls `fire(id, "archive")` for the default machine? Convenience for the legacy callers, but introduces machine-specific helper methods. Suggesting **no** — call `fire` directly; the helper would have to special-case the default machine.

## 4. Interfaces and test plan

### Module-boundary types

`packages/task-list/src/index.ts` — additions:

```ts
export interface StateMachineDef<TState extends string = string, TEvent extends string = string> {
  readonly initial: TState;
  readonly states: readonly TState[];
  readonly events: Readonly<Record<TEvent, EventDef<TState>>>;
}

export interface EventDef<TState extends string = string> {
  readonly from: readonly TState[] | "*";
  readonly to: TState;
  readonly guard?: (task: Task) => true | string;
  readonly onEnter?: (task: Task) => void | Promise<void>;
  readonly onExit?: (task: Task) => void | Promise<void>;
}

export class InvalidTransitionError extends Error {
  readonly task: Task;
  readonly event?: string;
  readonly to?: string;
  readonly reason: string;
}

export const defaultStateMachine: StateMachineDef<TaskState, "plan" | "start" | "complete" | "archive">;

export interface OpenTaskListOptions {
  // existing fields
  readonly stateMachine?: StateMachineDef;     // default: defaultStateMachine
}

export interface List {
  readonly name: string;
  readonly stateMachine: StateMachineDef;       // exposed for introspection
  readonly tasks: Tasks;
}

export interface Tasks {
  // existing methods
  fire(id: string, event: string, opts?: { metadataPatch?: Record<string, unknown> }): Promise<Task>;
  canFire(id: string, event: string): Promise<boolean>;
  events(id: string): Promise<readonly string[]>;
}
```

`packages/toolcraft/src/index.ts` — additions:

```ts
export interface CommandConfig<...> {
  // existing fields
  humanInLoop?: HumanInLoopConfig<TParamsSchema> | null;
}

export interface HumanInLoopConfig<TParamsSchema extends ObjectSchema<any>> {
  mode: "sync" | "async";
  message: (ctx: { params: Static<TParamsSchema>; commandPath: string }) => string;
  declineInputPrompt?: string;
}

export interface HumanInLoopRuntimeOptions {
  provider?: HumanInLoopProvider;
  taskList?: TaskList | { dir: string; format: "markdown-dir" | "yaml-file" };
  listName?: string;
  binPath?: { execPath: string; entryArgs: readonly string[] };
}

export type HumanInLoopPending = {
  status: "pending-approval";
  approvalId: string;
  message: string;
  enqueuedAt: string;
};

export class ApprovalDeclinedError extends UserError {
  readonly reason?: string;
  readonly approvalId?: string;
  readonly commandPath: string;
}

// from human-in-loop module
export const approvalStateMachine: StateMachineDef<ApprovalState, ApprovalEvent>;
export type ApprovalState = "pending" | "approved-running" | "approved-done" | "approved-failed" | "declined";
export type ApprovalEvent = "start" | "succeed" | "fail" | "decline";

// the gate, exported only for advanced cases (e.g. custom runtimes)
export function invokeWithHumanInLoop<T>(
  node: Command<any, any, any, T>,
  ctx: HandlerContext,
  runtimeOptions: HumanInLoopRuntimeOptions | undefined,
  commandPath: string,
): Promise<T | HumanInLoopPending>;
```

`runCLI`, `createMCPServer`, `createSDK` each gain `humanInLoop?: HumanInLoopRuntimeOptions` on their options.

### Tests — `task-list` state machine

`packages/task-list/src/state.test.ts`:

- `validateMachine` accepts the default machine.
- `validateMachine` rejects: state in `events.from` not declared, state in `events.to` not declared, `initial` not declared, `from === "*"` self-loop.
- `assertTransition` (renamed/derived from existing): legal moves OK, illegal throw `InvalidTransitionError`.

`packages/task-list/src/tasks.fire.test.ts` — uses `memfs`, both backends:

- `fire(id, event)` transitions when the event is legal from current state.
- `fire(id, event)` throws `InvalidTransitionError` with the event name + current state when illegal.
- `fire(id, event)` throws `InvalidTransitionError` with the guard's reason when guard returns a string.
- `metadataPatch` is shallow-merged into existing metadata.
- `onEnter`/`onExit` are awaited; failures propagate.
- `canFire(id, event)` returns true/false without mutating.
- `events(id)` returns the list of events legal from the task's current state.
- `create({ id, name })` creates a task at `stateMachine.initial`. Passing `state` is rejected.
- `update(id, { state: ... } as any)` is rejected at the boundary.
- `delete(id)` removes the task; subsequent `get` throws `TaskNotFoundError`.

`packages/task-list/src/open-task-list.test.ts`:

- Default machine is used when `stateMachine` is not passed. Re-skinned existing tests pass with `fire("plan")`, `fire("start")`, `fire("complete")`, `fire("archive")`.
- Custom machine is used when passed. `list.stateMachine` returns it by reference.
- `task.state` validation reflects the configured machine's `states`, not the default's.

### Tests — `toolcraft` human-in-loop

`packages/toolcraft/src/human-in-loop/config.test.ts`:

- `defineCommand({ humanInLoop: ... })` materialises the config.
- `defineCommand({ confirm: true, humanInLoop: ... })` throws.
- `defineCommand({ humanInLoop: { mode: "weird" } })` throws.
- `defineCommand({ humanInLoop: { message: "string" as any } })` throws (non-function).
- Group inheritance: child without `humanInLoop` inherits the group's; child with `null` opts out; child with its own overrides.

`packages/toolcraft/src/human-in-loop/gate.test.ts`:

- Sync, approved → handler runs, returns its result. Provider received the formatted message.
- Sync, declined → throws `ApprovalDeclinedError` with the provider's reason; handler not called.
- Sync, no provider configured, non-darwin platform → `UserError("no human-in-loop provider configured ...")`.
- Sync, no provider, darwin → uses lazy default (osascript) — verified by injecting a fake `binary` into the default factory.
- Async, no `taskList` → `UserError("...taskList required...")`.
- Async, with `taskList` → `tasks.create` called with the right metadata; `spawnApprovalRunner` called with `approvalId`; returns `HumanInLoopPending`.
- Async, mismatched state machine on the list → `UserError(...)` referring to `approvalStateMachine`.
- `invokeWithHumanInLoop` does not call the gate when `__internalRunnerBypass` is set on ctx (the runner's path).

All gate tests use `mockProvider` from `agent-human-in-loop` (no real osascript) and an in-memory task-list (yaml-file backend over `memfs`).

`packages/toolcraft/src/human-in-loop/runner.test.ts`:

- Idempotent: when task state is anything but `pending`, exits without calling provider.
- Approve path: fires `start` (with pid), runs handler, fires `succeed` (with result).
- Decline path: fires `decline` (with reason).
- Handler throws: fires `fail` with `{ name, message, stack }`.
- Non-JSON-serializable result: fires `fail` with `"result not JSON-serializable"`.
- Provider throws: fires `fail` with the provider error message.

`packages/toolcraft/src/human-in-loop/spawn.test.ts`:

- `spawnApprovalRunner` invokes `child_process.spawn` with the configured `binPath` + `["approvals", "run", approvalId]`.
- Spawn options include `detached: true`, `stdio: "ignore"`, and `unref()` is called.
- Default `binPath` is `{ execPath: process.execPath, entryArgs: [process.argv[1]] }`.
- Spawn function is injected (not the real `child_process.spawn`) so tests don't fork.

`packages/toolcraft/src/human-in-loop/approvals-commands.test.ts`:

- `approvals.list` returns all tasks with their state. `--state pending` filters.
- `approvals.show <id>` returns the task. Unknown id → `TaskNotFoundError`.
- `approvals.run <id>` is reachable via CLI, **not** via MCP and **not** via SDK (scope check).
- `approvals.run` throws if `taskList` runtime option is unset.

### Integration tests

`packages/toolcraft/src/human-in-loop/cli-runtime.integration.test.ts` — uses the real `runCLI` with a fake provider and an in-memory backend:

- Sync `humanInLoop` command, approved → exit 0, expected stdout.
- Sync, declined → exit non-zero, message contains `Declined`.
- Async command → exit 0, stdout shows `Queued for human approval`. The fake spawn function records that it was invoked with the right args. The fake then synchronously runs the runner against the same in-memory backend (same process, same task-list instance) and we assert post-run task state.

`packages/toolcraft/src/human-in-loop/mcp-runtime.integration.test.ts`:

- Sync MCP call, approved → tool returns handler result.
- Sync MCP call, declined → tool returns `isError: true` with structured content.
- Async MCP call → tool returns the pending marker as text content; agent can then call `approvals.show` and observe `pending` state.

`packages/toolcraft/src/human-in-loop/sdk-runtime.integration.test.ts`:

- Sync SDK call, approved → returns handler result.
- Sync SDK call, declined → throws `ApprovalDeclinedError`.
- Async SDK call → returns `HumanInLoopPending`.

### Manual QA

`packages/toolcraft/QA-human-in-loop.md` (markdown checklist, not a script — per project rule):

- A real osascript dialog pops for sync mode on darwin (`npm run dev -- ...`).
- Async mode: dialog pops in a detached subprocess; CLI returns immediately. Verified by `ps` showing the runner after CLI exit.
- `approvals list` shows the running entry; after approval, state is `approved-done` and `result` is populated.
- Decline-with-reason: reason ends up in the task's metadata.

### Spot-test

`npm run dev -- approvals list` and `approvals show <id>` against a hand-populated YAML task-list — verifies rendering of states and metadata.

### Rollout

- Two-package release in lockstep: `@poe-code/task-list` (with state-machine extension) and `toolcraft` (with human-in-loop module). Same changeset.
- Existing task-list callers don't pass `stateMachine`; they get the default, which preserves the current behaviour. No migration required.
- `confirm: true` is kept and marked deprecated in JSDoc; not removed in this plan.

### Autonomy checklist

The implementing agent can ship without asking when:

- All new tests are added and pass under `npm run test`.
- `grep "provider.id ===" packages/toolcraft/src` is empty.
- `grep "if .*format ===" packages/toolcraft/src/human-in-loop` is empty (no branching on backend type — task-list owns that).
- No bespoke queue or persistence code lives in `packages/toolcraft/`. The only persistence call surface is task-list's `Tasks` API.
- `defineCommand` static checks throw on `confirm + humanInLoop` and on malformed `humanInLoop`.
- README sections updated:
  - `packages/task-list/README.md` documents the configurable state machine + `fire`/`canFire`/`events`.
  - `packages/toolcraft/README.md` documents `humanInLoop` field, runtime options, default provider, the `approvals` built-in commands, and the provider blueprint.
- No new top-level dependencies in either package's `package.json`.
- `npm run lint`, `npm run typecheck` clean from the root.
- Visual spot-test: `npm run screenshot-poe-code -- approvals list` renders the table cleanly.

## 5. Code plan

### Files to create — `packages/task-list`

| File | Purpose |
| --- | --- |
| `packages/task-list/src/state-machine.ts` | `StateMachineDef`, `EventDef`, `validateMachine`, `defaultStateMachine` (re-export of the existing default in shape of the new type). The hardcoded `LEGAL_TRANSITIONS` is rewritten as a `StateMachineDef`. |
| `packages/task-list/src/state-machine.test.ts` | Validation tests per §4. |
| `packages/task-list/src/errors.ts` (or extend existing) | `InvalidTransitionError` already exists; widened to carry `event`, `to`, `reason`. |
| `packages/task-list/src/tasks.fire.test.ts` | Tests per §4 (uses memfs, both backends). |

### Files to change — `packages/task-list`

| File | Change |
| --- | --- |
| `packages/task-list/src/state.ts` | Replace `LEGAL_TRANSITIONS` constant with a derivation from `StateMachineDef`. Export `defaultStateMachine` matching today's behaviour. `assertTransition(machine, from, to)` becomes machine-driven; `assertEvent(machine, from, event)` is the new entry point used by `fire`. |
| `packages/task-list/src/index.ts` | Re-exports for the new types and the default machine. |
| `packages/task-list/src/types.ts` | `OpenTaskListOptions.stateMachine?: StateMachineDef`. `List.stateMachine: StateMachineDef`. `Tasks.fire`/`canFire`/`events` signatures. |
| `packages/task-list/src/tasks.ts` (or wherever `Tasks` is implemented) | Implement `fire`, `canFire`, `events`. Remove `transition`. `create` rejects `state` field; `update` rejects `state` mutation. |
| `packages/task-list/src/open-task-list.ts` | Plumb `stateMachine` from options into the loaded `List`. Default to `defaultStateMachine`. Run `validateMachine` once at open. |
| `packages/task-list/src/backends/markdown-dir.ts` | No format change. State strings come from the configured machine — `state.ts` no longer hardcodes the set, so any string declared in the machine is acceptable. |
| `packages/task-list/src/backends/yaml-file.ts` | Same as above. |
| `packages/task-list/src/schema/task.schema.json` | Loosen `state` from a hardcoded enum to `string`. Backend validation uses the configured machine's `states[]` at runtime, not the JSON Schema. (Per CLAUDE.md "Regexes are not allowed" we already parse, not regex; runtime validation via the machine is fine.) |
| `packages/task-list/README.md` | Document the new state-machine option, `fire`/`canFire`/`events`, the default machine. |

### Files to create — `packages/toolcraft`

| File | Purpose |
| --- | --- |
| `packages/toolcraft/src/human-in-loop/index.ts` | Re-exports types, classes, `approvalStateMachine`, `invokeWithHumanInLoop`. |
| `packages/toolcraft/src/human-in-loop/config.ts` | `HumanInLoopConfig` type, `validateHumanInLoopOnDefine(config)` static check, `mergeHumanInLoopFromGroup(group, child)` inheritance. |
| `packages/toolcraft/src/human-in-loop/state-machine.ts` | `ApprovalState`, `ApprovalEvent`, `approvalStateMachine`. |
| `packages/toolcraft/src/human-in-loop/gate.ts` | `invokeWithHumanInLoop`, `enqueueAsync`, `resolveProvider`, `formatMessage`. |
| `packages/toolcraft/src/human-in-loop/approval-tasks.ts` | Task-list adapter: `enqueue(taskList, listName, payload)`, `loadApproval(taskList, listName, id)`, plus the state-machine compatibility check. |
| `packages/toolcraft/src/human-in-loop/spawn.ts` | `spawnApprovalRunner(approvalId, runtimeOptions)`. Accepts an injected `spawn` for tests. |
| `packages/toolcraft/src/human-in-loop/runner.ts` | The `approvals.run` body. |
| `packages/toolcraft/src/human-in-loop/default-provider.ts` | Lazy `defaultProviderForPlatform()` returning the osascript provider on darwin or a `noProviderConfigured` provider elsewhere. |
| `packages/toolcraft/src/human-in-loop/approvals-commands.ts` | `approvals.list`, `approvals.show`, `approvals.run` defined via `defineGroup` + `defineCommand`. |
| `packages/toolcraft/src/human-in-loop/types.ts` | `HumanInLoopRuntimeOptions`, `HumanInLoopPending`, `ApprovalDeclinedError`. |
| `packages/toolcraft/src/human-in-loop/*.test.ts` | Unit tests per §4 (`config`, `gate`, `runner`, `spawn`, `approvals-commands`, `state-machine`). |
| `packages/toolcraft/src/human-in-loop/cli-runtime.integration.test.ts` | Integration tests per §4. |
| `packages/toolcraft/src/human-in-loop/mcp-runtime.integration.test.ts` | Integration tests per §4. |
| `packages/toolcraft/src/human-in-loop/sdk-runtime.integration.test.ts` | Integration tests per §4. |
| `packages/toolcraft/QA-human-in-loop.md` | Manual QA checklist per §4. |

### Files to change — `packages/toolcraft`

| File | Change |
| --- | --- |
| `packages/toolcraft/src/index.ts` | Add `humanInLoop` to `CommandConfig`, `Command`, `GroupConfig`, `Group`. `defineCommand` calls `validateHumanInLoopOnDefine`. `defineGroup` carries the field through inheritance. Export human-in-loop public surface. |
| `packages/toolcraft/src/cli.ts` | Replace direct `await state.command.handler(context)` (line ~2831) with `await invokeWithHumanInLoop(state.command, context, runtimeOptions, commandPath)`. The existing `confirm` block (lines ~2816–2828) stays for now but is bypassed when `humanInLoop` is set on the same command (the build-time check prevents both, so this is just a guard). Render `HumanInLoopPending` results as the queued banner; render `ApprovalDeclinedError` as decline + non-zero exit. Merge built-in `approvals` group into root before resolution. |
| `packages/toolcraft/src/mcp.ts` | Same gate swap at line ~523. Render `HumanInLoopPending` to text content. Render `ApprovalDeclinedError` to `{ isError: true, content: [...] }`. Merge `approvals` group; force `scope: ["cli"]` on `approvals.run` so MCP filters it out. |
| `packages/toolcraft/src/sdk.ts` | Same gate swap at lines ~409–435. `HumanInLoopPending` returned as-is. `ApprovalDeclinedError` thrown to caller. Merge `approvals` group. |
| `packages/toolcraft/package.json` | Add `@poe-code/agent-human-in-loop` and `@poe-code/task-list` to runtime `dependencies`. No new devDeps beyond the existing test stack. |
| `packages/toolcraft/README.md` | Document `humanInLoop` field on commands/groups, runtime options, default provider, the `approvals` built-in commands, the provider blueprint with the slack example. Document `confirm` deprecation. |

### Function signatures — new

```ts
// packages/task-list/src/state-machine.ts
export function validateMachine(machine: StateMachineDef): void;
export function eventsFromState(machine: StateMachineDef, from: string): readonly string[];
export function findEvent(machine: StateMachineDef, from: string, event: string): EventDef | undefined;
export function findUniqueEventForTransition(machine: StateMachineDef, from: string, to: string): EventDef;

// packages/task-list/src/tasks.ts (additions)
fire(id: string, event: string, opts?: { metadataPatch?: Record<string, unknown> }): Promise<Task>;
canFire(id: string, event: string): Promise<boolean>;
events(id: string): Promise<readonly string[]>;

// packages/toolcraft/src/human-in-loop/config.ts
export function validateHumanInLoopOnDefine(config: CommandConfig<any, any, any, any>): void;
export function mergeHumanInLoopFromGroup(
  group: Group<any> | undefined,
  child: HumanInLoopConfig<any> | null | undefined,
): HumanInLoopConfig<any> | undefined;

// packages/toolcraft/src/human-in-loop/gate.ts
export function invokeWithHumanInLoop<T>(
  node: Command<any, any, any, T>,
  ctx: HandlerContext,
  runtimeOptions: HumanInLoopRuntimeOptions | undefined,
  commandPath: string,
): Promise<T | HumanInLoopPending>;

// packages/toolcraft/src/human-in-loop/approval-tasks.ts
export async function ensureApprovalList(
  runtimeOptions: HumanInLoopRuntimeOptions,
): Promise<{ taskList: TaskList; listName: string; tasks: Tasks }>;
export async function enqueueApproval(
  ctx: { tasks: Tasks; payload: ApprovalPayload },
): Promise<{ approvalId: string; pending: HumanInLoopPending }>;
export async function loadApproval(
  ctx: { tasks: Tasks; approvalId: string },
): Promise<ApprovalPayload | undefined>;

// packages/toolcraft/src/human-in-loop/spawn.ts
export function spawnApprovalRunner(
  approvalId: string,
  runtimeOptions: HumanInLoopRuntimeOptions,
  spawnFn?: typeof import("node:child_process").spawn,   // injected for tests
): void;

// packages/toolcraft/src/human-in-loop/runner.ts
export async function runApproval(
  approvalId: string,
  runtimeOptions: HumanInLoopRuntimeOptions,
  root: CommandNode<any>,
): Promise<void>;

// packages/toolcraft/src/human-in-loop/default-provider.ts
export function defaultProviderForPlatform(): HumanInLoopProvider;
```

### Build order (TDD)

Each step ends green.

1. **task-list: `StateMachineDef` types + `validateMachine`.** Write tests first. Implement. `npm run test --workspace task-list` green.
2. **task-list: refactor existing default to `defaultStateMachine`.** No behaviour change. Existing tests still pass.
3. **task-list: `fire`/`canFire`/`events` on `Tasks`.** Tests first (both backends). Implement.
4. **task-list: `OpenTaskListOptions.stateMachine` plumbing.** Custom-machine test passes; default-machine tests still pass.
5. **task-list: rewrite existing tests/callers in terms of `fire`.** Drop `transition`. `create` no longer accepts `state`. `update` rejects `state` field. All previously-green task-list tests stay green after rewrite.
6. **task-list: README update.** No code changes.
7. **toolcraft: types + config validation.** Add `humanInLoop` to `CommandConfig`/`Command`. `validateHumanInLoopOnDefine` + group inheritance. Tests first.
8. **toolcraft: `approvalStateMachine` + state machine compatibility check.** Tests.
9. **toolcraft: `gate.ts` sync path.** Tests with `mockProvider`. CLI/MCP/SDK call sites still call `node.handler` directly here — the gate is unwired.
10. **toolcraft: wire gate into CLI.** Replace `await state.command.handler(context)` with `invokeWithHumanInLoop`. Render `ApprovalDeclinedError` and `HumanInLoopPending` (the latter unreachable until step 11). CLI integration test for sync paths.
11. **toolcraft: `gate.ts` async path + `approval-tasks.ts`.** Enqueue + return pending marker. Tests with in-memory task-list and a fake spawn.
12. **toolcraft: `spawn.ts`.** Detached spawn + injection. Tests.
13. **toolcraft: `runner.ts` + `approvals-commands.ts`.** Built-in `approvals` group. Wire into all three runtimes' root-merge step. Tests for runner state transitions and command scope filtering.
14. **toolcraft: wire gate into MCP and SDK.** Render rules for both. Integration tests.
15. **toolcraft: README + QA.md.** No code changes.
16. **Sweep.** `npm run test`, `npm run lint`, `npm run typecheck` from the root. `npm run screenshot-poe-code -- approvals list` for the visual.
17. **Commit.** Conventional commits, one per package: `feat(task-list): configurable state machine` then `feat(toolcraft): human-in-loop command decoration`. The plan doc is part of the toolcraft commit.

### Autonomy gates (recap)

- `grep "LEGAL_TRANSITIONS" packages/task-list/src` empty (replaced by machine).
- `grep "provider.id ===" packages/toolcraft/src` empty.
- `grep "queueDir" packages/toolcraft/src` empty (replaced by `taskList`).
- `grep -E "if.*format === \"(markdown-dir|yaml-file)\"" packages/toolcraft/src/human-in-loop` empty (no backend branching in toolcraft).
- No real `child_process.spawn`, `osascript`, or filesystem write in any test (`memfs` + injected fakes).
- Both READMEs updated.
