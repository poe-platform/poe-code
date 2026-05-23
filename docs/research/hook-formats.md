# Coding-Agent Hook Formats

Sources:

- <https://code.claude.com/docs/en/hooks>
- <https://developers.openai.com/codex/hooks>
- <https://developers.openai.com/codex/config-reference>
- <https://opencode.ai/docs/plugins/>
- OpenCode canonical hook type surface: `@opencode-ai/plugin` `packages/plugin/src/index.ts` in <https://github.com/anomalyco/opencode>
- Goose: <https://block.github.io/goose/> and <https://github.com/block/goose>

## Claude Code

### Files, format, layers

| Scope          | Canonical location                   | Format                                  | Merge / precedence behavior                                                                                                |
| -------------- | ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| User/global    | `~/.claude/settings.json`            | JSON settings object containing `hooks` | Active alongside project, local, managed, plugin, skill, and agent hooks; matching handlers run.                           |
| Project/shared | `<repo>/.claude/settings.json`       | JSON settings object containing `hooks` | Repo-committable project layer.                                                                                            |
| Project/local  | `<repo>/.claude/settings.local.json` | JSON settings object containing `hooks` | Machine-local, normally gitignored project layer.                                                                          |
| Managed policy | managed policy settings              | JSON settings object containing `hooks` | Admin-controlled; `allowManagedHooksOnly` suppresses user, project, and plugin hooks except force-enabled managed plugins. |
| Plugin         | `<plugin>/hooks/hooks.json`          | JSON hook object                        | Loaded while plugin is enabled.                                                                                            |
| Skill / agent  | component frontmatter                | frontmatter hook declaration            | Loaded while that component is active.                                                                                     |

Top-level schema:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/policy.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```

### Events

| Event                 | Semantics                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `SessionStart`        | Session begins, resumes, clears, or returns from compaction; inject startup context and persisted shell env.  |
| `Setup`               | One-time setup triggered by `--init-only`, or `--init` / `--maintenance` in print mode.                       |
| `InstructionsLoaded`  | A `CLAUDE.md` or `.claude/rules/*.md` file is added to context.                                               |
| `UserPromptSubmit`    | User prompt is submitted before model processing; can reject or enrich it.                                    |
| `UserPromptExpansion` | User-entered command expands into a prompt before model processing; can reject or enrich it.                  |
| `PreToolUse`          | Before a tool executes; can allow, deny, ask, defer, rewrite input, or add context.                           |
| `PermissionRequest`   | A permission dialog is about to be shown; can allow or deny and optionally modify allowed input/permissions.  |
| `PermissionDenied`    | Auto-mode classifier denied a tool call; can tell the model it may retry.                                     |
| `PostToolUse`         | Tool call succeeded; can feed back blocking guidance or add context after side effects occurred.              |
| `PostToolUseFailure`  | Tool call failed; can feed failure guidance back to Claude.                                                   |
| `PostToolBatch`       | A parallel tool batch resolved before the next model call; can add batch-level context or block continuation. |
| `Notification`        | Claude sends a notification; side effects only.                                                               |
| `SubagentStart`       | A subagent starts; can inject subagent context.                                                               |
| `SubagentStop`        | A subagent finishes; can require it to continue.                                                              |
| `TaskCreated`         | A task is being created; can reject creation.                                                                 |
| `TaskCompleted`       | A task is being marked complete; can reject completion.                                                       |
| `Stop`                | Claude finishes a response; can require another turn.                                                         |
| `StopFailure`         | A turn terminates due to API failure; logging/notification only.                                              |
| `TeammateIdle`        | An agent-team teammate is about to become idle; can keep it working.                                          |
| `ConfigChange`        | Configuration changes during a session; can reject applicable changes.                                        |
| `CwdChanged`          | Working directory changes; refresh environment/context side effects.                                          |
| `FileChanged`         | A watched file changes; refresh environment/context side effects.                                             |
| `WorktreeCreate`      | Worktree creation is requested; handler supplies replacement worktree path.                                   |
| `WorktreeRemove`      | Worktree removal occurs; cleanup side effects.                                                                |
| `PreCompact`          | Before context compaction; can block compaction.                                                              |
| `PostCompact`         | After context compaction; follow-up side effects only.                                                        |
| `SessionEnd`          | Session exits or switches; cleanup side effects only.                                                         |
| `Elicitation`         | MCP server requests structured user input; can accept, decline, or cancel.                                    |
| `ElicitationResult`   | User answered an MCP elicitation; can override or decline the response.                                       |

### Input and output contract

All command hooks receive one JSON object on stdin; HTTP hooks receive the same JSON as the POST body. Common fields are `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and, on applicable events, `permission_mode`, `effort`, `agent_id`, and `agent_type`. Command hooks use exit `0` for JSON/stdout processing, exit `2` for blocking behavior where supported, and other non-zero exits as non-blocking errors unless an event defines otherwise. Shared JSON fields are `continue`, `stopReason`, `suppressOutput`, and `systemMessage`; event-specific decisions use either top-level `decision` / `reason` or `hookSpecificOutput`.

| Event               | Additional input fields                                                                       | Decision / output schema                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`      | `source` (`startup`, `resume`, `clear`, or `compact`), `model`, optional `agent_type`         | Plain stdout adds context; `hookSpecificOutput: { hookEventName: "SessionStart", additionalContext?, initialUserMessage?, watchPaths? }`; does not block. `CLAUDE_ENV_FILE` persists exported env for later Bash calls. |
| `UserPromptSubmit`  | `prompt`                                                                                      | `{ "decision": "block", "reason": "..." }` rejects prompt; `hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "..." }` or plain stdout adds context.                                          |
| `PreToolUse`        | `tool_name`, `tool_input`, `tool_use_id`                                                      | `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" / "deny" / "ask" / "defer", permissionDecisionReason?, updatedInput?, additionalContext? }`; exit `2` denies.                           |
| `PermissionRequest` | `tool_name`, `tool_input`, `tool_use_id`, permission suggestions where emitted by the request | `hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" / "deny", message?, updatedInput?, updatedPermissions?, interrupt? } }`; allow/deny is on behalf of the user.                  |
| `PostToolUse`       | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`                                     | `{ "decision": "block", "reason": "...", "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "..." } }`; blocking cannot undo tool side effects.                                               |
| `Stop`              | `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`             | `{ "decision": "block", "reason": "..." }` continues Claude with the reason as instruction; omit decision to stop.                                                                                                      |

### Matchers, handlers, placeholders

| Subject                  | Contract                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matcher syntax           | `"*"`, `""`, or omitted matches all; strings containing only letters, digits, `_`, and the separator character `\|` are exact names or exact-name alternatives; any other characters produce a JavaScript regular expression. `FileChanged` additionally splits `matcher` on `\|` to build a literal filename watch list.                                                                     |
| Matcher fields           | Tool events and permission events match `tool_name`; `SessionStart` matches `source`; `Setup` matches trigger (`init` / `maintenance`); `SessionEnd` matches reason; `Notification` matches notification type; `SubagentStart` / `SubagentStop` match `agent_type`; `PreCompact` / `PostCompact` match trigger; `ConfigChange` matches config source; several events do not support matchers. |
| Handler types            | `command`, `http`, `mcp_tool`, `prompt`, `agent`. `SessionStart` and `Setup` accept only `command` and `mcp_tool`; prompt/agent event support is narrower and decision-oriented.                                                                                                                                                                                                              |
| Command execution        | With `args`, `command` is exec form; without `args`, it is shell form. Common command fields include `timeout`, `statusMessage`, `async`, `once`, and platform/shell controls.                                                                                                                                                                                                                |
| HTTP execution           | Sends JSON input as HTTP POST body; response body is processed like command stdout.                                                                                                                                                                                                                                                                                                           |
| MCP execution            | Calls a configured MCP server/tool and processes returned text like command stdout.                                                                                                                                                                                                                                                                                                           |
| Prompt / agent execution | Sends `$ARGUMENTS`-expanded hook JSON to a model or tool-using subagent; response is `{ "ok": true }` or `{ "ok": false, "reason": "..." }`.                                                                                                                                                                                                                                                  |
| Path placeholders        | `${CLAUDE_PROJECT_DIR}` is the project root; `${CLAUDE_PLUGIN_ROOT}` is the installed plugin root; `${CLAUDE_PLUGIN_DATA}` is persistent plugin data. Plugin hooks also expand `${user_config.*}`.                                                                                                                                                                                            |
| Spawned environment      | Command hooks export `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA`; `SessionStart`, `Setup`, `CwdChanged`, and `FileChanged` expose `CLAUDE_ENV_FILE`; remote web execution sets `CLAUDE_CODE_REMOTE=true`.                                                                                                                                                            |

## Codex

### Files, format, layers

| Scope              | Canonical location                                                        | Format                                     | Merge / precedence behavior                                                                                      |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| User/global        | `~/.codex/hooks.json`                                                     | JSON hook object                           | Loaded with inline hooks and other active layers; matching hooks all run.                                        |
| User/global inline | `~/.codex/config.toml` `[hooks]`                                          | TOML tables                                | Merged with sibling `hooks.json`; Codex warns if both are present in one layer.                                  |
| Project            | `<repo>/.codex/hooks.json`                                                | JSON hook object                           | Loaded only for a trusted project layer.                                                                         |
| Project inline     | `<repo>/.codex/config.toml` `[hooks]`                                     | TOML tables                                | Loaded only for a trusted project layer.                                                                         |
| Managed            | `requirements.toml` `[hooks]` / managed configuration layers              | TOML tables                                | Managed and policy-trusted; `allow_managed_hooks_only = true` excludes user, project, session, and plugin hooks. |
| Plugin             | `<plugin>/hooks/hooks.json`, or `.codex-plugin/plugin.json` `hooks` entry | JSON hook object or inline manifest object | Enabled plugin hooks load alongside other sources and require trust review unless managed.                       |

JSON schema:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .codex/hooks/policy.py",
            "timeout": 30,
            "statusMessage": "Checking command"
          }
        ]
      }
    ]
  }
}
```

Equivalent inline TOML:

```toml
[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "python3 .codex/hooks/policy.py"
timeout = 30
statusMessage = "Checking command"
```

### Events

| Event               | Semantics                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `SessionStart`      | Thread starts, resumes, clears, or returns from compaction; supplies developer context.                  |
| `SubagentStart`     | Subagent starts; supplies developer context to the subagent.                                             |
| `PreToolUse`        | Before supported Bash, `apply_patch`, or MCP execution; can deny or rewrite supported calls.             |
| `PermissionRequest` | Before Codex displays a required approval prompt; can allow or deny.                                     |
| `PostToolUse`       | After supported Bash, `apply_patch`, or MCP execution; can replace result feedback or stop continuation. |
| `PreCompact`        | Before conversation compaction; can stop before compacting.                                              |
| `PostCompact`       | After conversation compaction; can stop afterward.                                                       |
| `UserPromptSubmit`  | Before a user prompt enters the turn; can reject or add developer context.                               |
| `SubagentStop`      | Subagent finishes; can request another subagent pass.                                                    |
| `Stop`              | Turn finishes; can request another model pass.                                                           |

### Input and output contract

Every command hook receives JSON on stdin. Common fields are `session_id`, `transcript_path: string | null`, `cwd`, `hook_event_name`, and Codex extension `model`; turn-scoped events add Codex extension `turn_id`. `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, and `Stop` add `permission_mode`. Shared output fields for context/stop-capable events are `continue`, `stopReason`, `systemMessage`, and parsed-but-not-implemented `suppressOutput`.

| Event               | Additional input fields                                                 | Decision / output schema                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`      | `source` (`startup`, `resume`, `clear`, or `compact`)                   | Plain stdout adds developer context; `hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." }`; shared output fields apply.                                                                                                                                                                                    |
| `UserPromptSubmit`  | `turn_id`, `prompt`                                                     | Plain stdout or `hookSpecificOutput.additionalContext` adds developer context; `{ "decision": "block", "reason": "..." }` or exit `2` rejects the prompt.                                                                                                                                                                              |
| `PreToolUse`        | `turn_id`, `tool_name`, `tool_use_id`, `tool_input`                     | `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." }` denies; `permissionDecision: "allow", updatedInput: {...}` rewrites; `additionalContext` adds context; legacy `{ "decision": "block", "reason": "..." }` and exit `2` also deny. `ask` and `defer` are unsupported. |
| `PermissionRequest` | `turn_id`, `tool_name`, `tool_input`; optional `tool_input.description` | `hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" / "deny", message? } }`; any deny wins, otherwise allow bypasses prompting; unsupported fields fail closed.                                                                                                                                   |
| `PostToolUse`       | `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response`    | `{ "decision": "block", "reason": "...", "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "..." } }`; `continue: false` stops normal result processing; no side effects are undone.                                                                                                                        |
| `Stop`              | `turn_id`, `stop_hook_active`, `last_assistant_message`                 | `{ "decision": "block", "reason": "..." }` continues the turn; shared output fields apply; plain text is invalid.                                                                                                                                                                                                                      |

### Matchers, handlers, placeholders

| Subject            | Contract                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matcher syntax     | `matcher` is a regex string; `"*"`, `""`, or omission matches all. Unlike Claude Code, Codex does not define an exact-string-vs-regex shorthand split: write explicit anchors when exact matching matters.                                                                                                                                  |
| Matcher fields     | `PreToolUse`, `PermissionRequest`, and `PostToolUse` filter tool name; `apply_patch` also accepts matcher aliases `Edit` and `Write`. `SessionStart` filters `source`; `PreCompact` / `PostCompact` filter `manual` / `auto`; `SubagentStart` / `SubagentStop` filter agent type. `UserPromptSubmit` and `Stop` ignore configured matchers. |
| Supported handlers | Only `type: "command"` executes. `prompt` and `agent` parse but are skipped; Claude-only `http` and `mcp_tool` have no Codex handler execution contract. `async: true` handlers are skipped.                                                                                                                                                |
| Command execution  | Command runs with session `cwd`; `timeout` is seconds and defaults to `600`; `statusMessage` is optional; `commandWindows` / TOML `command_windows` overrides on Windows.                                                                                                                                                                   |
| Project pathing    | No `${CLAUDE_PROJECT_DIR}` replacement is documented; repo-local examples resolve a stable root with `$(git rev-parse --show-toplevel)`.                                                                                                                                                                                                    |
| Plugin env         | `PLUGIN_ROOT` and `PLUGIN_DATA` identify Codex plugin installation/data paths; Codex also sets `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for compatible plugin hooks.                                                                                                                                                                   |

## OpenCode

### Files, format, layers

| Scope                         | Canonical location                                | Format                                                    | Merge / precedence behavior                     |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Global local plugin           | `~/.config/opencode/plugins/*.js` or `*.ts`       | JavaScript / TypeScript plugin module                     | Loaded after global and project config plugins. |
| Project local plugin          | `<repo>/.opencode/plugins/*.js` or `*.ts`         | JavaScript / TypeScript plugin module                     | Loaded last.                                    |
| Global package configuration  | `~/.config/opencode/opencode.json` `plugin` array | JSON package references; package exports plugin functions | Loaded first.                                   |
| Project package configuration | `<repo>/opencode.json` `plugin` array             | JSON package references; package exports plugin functions | Loaded second.                                  |

All plugin sources load and hook functions run sequentially in load order. Duplicate npm packages with identical package name and version load once; a local plugin and an npm plugin with similar names both load.

Top-level TypeScript plugin shape:

```ts
import type { Plugin } from "@opencode-ai/plugin";

export const PolicyPlugin: Plugin = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "bash") output.args.command = "echo blocked";
  },
  "permission.ask": async (input, output) => {
    output.status = "deny";
  }
});
```

### Events

The public plugin documentation exposes generic bus events through the `event` hook; the typed plugin interface additionally exposes direct mutation hooks.

| Surface         | Event / hook                                                                                                                                                                          | Semantics                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Generic `event` | `command.executed`                                                                                                                                                                    | Command completed.                                                                        |
| Generic `event` | `file.edited`, `file.watcher.updated`                                                                                                                                                 | File changed by editing or watcher update.                                                |
| Generic `event` | `installation.updated`                                                                                                                                                                | Installation state changed.                                                               |
| Generic `event` | `lsp.client.diagnostics`, `lsp.updated`                                                                                                                                               | Language server diagnostics or state changed.                                             |
| Generic `event` | `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`                                                                                                  | Message or part changed.                                                                  |
| Generic `event` | `permission.asked`, `permission.replied`                                                                                                                                              | Permission request was raised or answered.                                                |
| Generic `event` | `server.connected`                                                                                                                                                                    | Server connection became available.                                                       |
| Generic `event` | `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`                                       | Session lifecycle/state change.                                                           |
| Generic `event` | `todo.updated`                                                                                                                                                                        | Todo state changed.                                                                       |
| Generic `event` | `shell.env`                                                                                                                                                                           | Shell environment is being assembled.                                                     |
| Generic `event` | `tool.execute.before`, `tool.execute.after`                                                                                                                                           | Tool is about to execute or has executed.                                                 |
| Generic `event` | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`                                                                                                                          | Terminal UI interaction.                                                                  |
| Direct hook     | `chat.message`, `chat.params`, `chat.headers`                                                                                                                                         | Mutate submitted message, model parameters, or request headers.                           |
| Direct hook     | `permission.ask`                                                                                                                                                                      | Decide permission status before prompting.                                                |
| Direct hook     | `command.execute.before`                                                                                                                                                              | Mutate parts before command execution.                                                    |
| Direct hook     | `tool.execute.before`, `tool.execute.after`                                                                                                                                           | Mutate tool arguments before execution or returned title/output/metadata after execution. |
| Direct hook     | `shell.env`                                                                                                                                                                           | Inject environment variables for shell execution.                                         |
| Direct hook     | `tool.definition`                                                                                                                                                                     | Mutate tool descriptions/schema supplied to the model.                                    |
| Direct hook     | `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `experimental.session.compacting`, `experimental.compaction.autocontinue`, `experimental.text.complete` | Experimental model-context, compaction, continuation, and text transformations.           |

### Input, output, matching, handlers

| Claude/Codex concept           | OpenCode contract                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse` equivalent        | `"tool.execute.before": (input: { tool, sessionID, callID }, output: { args }) => Promise<void>`; mutate `output.args`, or throw to prevent execution.                                                |
| `PostToolUse` equivalent       | `"tool.execute.after": (input: { tool, sessionID, callID, args }, output: { title, output, metadata }) => Promise<void>`; mutate output; there is no standard `{ decision: "block" }` JSON envelope.  |
| `PermissionRequest` equivalent | `"permission.ask": (input: Permission, output: { status: "ask" / "deny" / "allow" }) => Promise<void>`; set `output.status`. Generic `permission.asked` is observation, not the direct decision hook. |
| `UserPromptSubmit` equivalent  | `"chat.message"` receives `{ sessionID, agent?, model?, messageID?, variant? }` and mutable `{ message, parts }`.                                                                                     |
| `SessionStart` equivalent      | No direct `SessionStart` hook; observe generic `session.created`.                                                                                                                                     |
| `Stop` equivalent              | No direct blocking stop hook; observe generic `session.idle` / session status events.                                                                                                                 |
| Matcher syntax                 | None. Hook selection is the returned object key; per-tool/per-event filtering is ordinary TypeScript logic (`input.tool === "bash"`, `event.type === "session.idle"`).                                |
| Handler types                  | Plugin functions only; shell/HTTP/MCP/model work is arbitrary plugin implementation, not declarative handler variants.                                                                                |
| Placeholders / env             | No Claude/Codex-style hook placeholders. Plugin initializer receives `directory`, `worktree`, `project`, `client`, `$`, and `serverUrl`; derive paths from context.                                   |

## Goose

Goose does not expose a documented Claude/Codex-style coding-agent lifecycle hook configuration surface: no canonical global/project hook files, no hook schema, no hook event list, no matcher language, no declarative hook handlers, and no hook-specific placeholders. Goose extensions and permission configuration are agent capabilities/configuration, not lifecycle hook files. A hook bridge therefore has no Goose target format until Goose publishes a native lifecycle-hook contract.

## claude-code → codex conversion deltas

| Divergence                 | Claude Code source contract                                                                                                                                                                                                                                                                                                       | Codex target contract                                                                                                                                        | Bridge action                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Shared event set           | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`                                                                                                                                                                        | Same named events exist.                                                                                                                                     | Transform only these event groups; validate output fields separately.                                                            |
| Claude-only events         | `Setup`, `InstructionsLoaded`, `UserPromptExpansion`, `PermissionDenied`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `TaskCreated`, `TaskCompleted`, `StopFailure`, `TeammateIdle`, `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `SessionEnd`, `Elicitation`, `ElicitationResult` | Absent.                                                                                                                                                      | Drop event groups; report unsupported-event diagnostics.                                                                         |
| Handler types              | `command`, `http`, `mcp_tool`, `prompt`, `agent`.                                                                                                                                                                                                                                                                                 | Only `type: "command"` executes; `prompt` / `agent` are parsed but skipped; `http` / `mcp_tool` are unsupported.                                             | Preserve command handlers only; drop `http`, `mcp_tool`, `prompt`, and `agent`.                                                  |
| Command fields             | Supports exec-form `args`, shell form, `async`, `once`, path placeholders, HTTP/MCP-specific fields.                                                                                                                                                                                                                              | Supports command string, `timeout`, `statusMessage`, `commandWindows` / `command_windows`; `async: true` is skipped.                                         | Emit only Codex-supported command fields; reject/drop behavior-changing Claude-only fields.                                      |
| Project root placeholder   | `${CLAUDE_PROJECT_DIR}` is substituted/exported.                                                                                                                                                                                                                                                                                  | No corresponding documented placeholder; examples use `$(git rev-parse --show-toplevel)`.                                                                    | Rewrite project-root script paths to git-root shell expansion when command remains shell-compatible; otherwise mark nonportable. |
| Plugin root placeholder    | `${CLAUDE_PLUGIN_ROOT}` and env `CLAUDE_PLUGIN_ROOT`.                                                                                                                                                                                                                                                                             | Canonical Codex env is `PLUGIN_ROOT`; compatibility env `CLAUDE_PLUGIN_ROOT` is also exported for plugin hooks.                                              | Prefer rewriting to `$PLUGIN_ROOT`; compatibility permits leaving env reads when preserving a plugin command.                    |
| Plugin data placeholder    | `${CLAUDE_PLUGIN_DATA}` and env `CLAUDE_PLUGIN_DATA`.                                                                                                                                                                                                                                                                             | Canonical Codex env is `PLUGIN_DATA`; compatibility env `CLAUDE_PLUGIN_DATA` is also exported for plugin hooks.                                              | Prefer rewriting to `$PLUGIN_DATA`; compatibility permits leaving env reads when preserving a plugin command.                    |
| Session env persistence    | `CLAUDE_ENV_FILE` is available on selected environment lifecycle hooks.                                                                                                                                                                                                                                                           | No corresponding documented hook environment persistence file.                                                                                               | Drop persistence behavior; surface lossy conversion.                                                                             |
| Matcher syntax             | Match-all sentinel; simple names separated by `\|` are exact alternatives; patterns with other characters are JavaScript regex; `FileChanged` is a special case.                                                                                                                                                                  | Regex strings; match-all sentinel; aliases `Edit` / `Write` map to `apply_patch`; `UserPromptSubmit` and `Stop` ignore matchers.                             | Anchor generated exact filters (`^Bash$`, `^(Edit\|Write)$`); omit ignored matchers and preserve only representable filters.     |
| Tool interception          | Claude supports its full documented tool event set and `PreToolUse` decisions `allow`, `deny`, `ask`, `defer`.                                                                                                                                                                                                                    | Codex intercepts supported Bash, `apply_patch`, and MCP paths; `ask` / `defer` are unsupported; interception is not complete for richer shell/non-MCP tools. | Preserve `allow` rewrite and `deny`; drop/diagnose `ask` and `defer`; record coverage loss.                                      |
| Permission decision fields | Allows richer `PermissionRequest` decision payload including updated input/permission operations.                                                                                                                                                                                                                                 | Allows `behavior: "allow" / "deny"` and optional denial message; future-reserved mutation fields fail closed.                                                | Strip unsupported mutation fields and mark conversion lossy.                                                                     |
| Output semantics           | Shared JSON and event-specific fields include Claude-only context/control features.                                                                                                                                                                                                                                               | Subset implemented; unsupported parsed fields can fail a hook run.                                                                                           | Project each event output to Codex's supported schema, never copy blindly.                                                       |
| Write target               | JSON settings files and plugin JSON.                                                                                                                                                                                                                                                                                              | Supports `hooks.json` and inline `[hooks]` TOML in `config.toml`; both in one layer merge with a warning.                                                    | v1 chooses JSON `hooks.json` only; TOML target emission is out of v1 scope.                                                      |
| Layer behavior             | All active matching layers execute; managed policy can restrict non-managed hooks.                                                                                                                                                                                                                                                | All active matching sources execute; trusted-project gate and trust-review flow apply; managed-only policy can restrict sources.                             | Write only the selected target layer and avoid assuming replacement semantics.                                                   |
