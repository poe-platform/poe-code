import type { AcpEvent, PlanEvent } from "../acp/types.js";
import { truncate, isNonEmptyString, extractThreadId } from "./utils.js";

type CodexEvent = {
  type?: unknown;
  thread_id?: unknown;
  threadId?: unknown;
  threadID?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  sessionID?: unknown;
  usage?: unknown;
  item?: unknown;
  error?: unknown;
  message?: unknown;
  reason?: unknown;
};

type CodexItem = {
  id?: unknown;
  type?: unknown;
  command?: unknown;
  path?: unknown;
  text?: unknown;
  content?: unknown;
  summary?: unknown;
  server?: unknown;
  tool?: unknown;
  arguments?: unknown;
  result?: unknown;
  status?: unknown;
  exit_code?: unknown;
  aggregated_output?: unknown;
  changes?: unknown;
  query?: unknown;
  message?: unknown;
  items?: unknown;
};

export async function* adaptCodex(
  lines: AsyncIterable<string>
): AsyncGenerator<AcpEvent> {
  const toolTitleById = new Map<string, string>();
  const toolKindById = new Map<string, string>();

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      yield {
        event: "error",
        message: `[adaptCodex] Malformed JSON line: ${truncate(line, 200)}`,
        stack
      };
      continue;
    }

    const eventType = event.type;
    if (!isNonEmptyString(eventType)) continue;

    if (eventType === "thread.started") {
      const maybeThreadId = extractThreadId(event);
      yield { event: "session_start", threadId: maybeThreadId };
      continue;
    }

    if (eventType === "turn.started") {
      continue;
    }

    if (eventType === "turn.completed") {
      const usage = (event.usage ?? {}) as {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cached_input_tokens?: unknown;
      };

      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      const cachedTokens =
        typeof usage.cached_input_tokens === "number" ? usage.cached_input_tokens : 0;

      yield { event: "usage", inputTokens, outputTokens, cachedTokens };
      continue;
    }

    if (eventType === "turn.failed" || eventType === "error") {
      const message = extractErrorMessage(event) ?? "Turn failed";
      yield { event: "error", message: explainEscalationPolicyRejection(message) };
      continue;
    }

    const item = (event.item ?? null) as CodexItem | null;
    if (!item || typeof item !== "object") continue;

    const itemType = item.type;
    if (!isNonEmptyString(itemType)) continue;

    if (itemType === "todo_list" && ["item.started", "item.updated", "item.completed"].includes(eventType)) {
      if (!Array.isArray(item.items) || !item.items.every((entry: unknown) => entry !== null && typeof entry === "object"
        && typeof (entry as { text?: unknown }).text === "string" && typeof (entry as { completed?: unknown }).completed === "boolean")) continue;
      const entries: PlanEvent["entries"] = item.items.map((entry: { text: string; completed: boolean }) => ({
        content: entry.text, status: entry.completed ? "completed" : "pending", priority: "medium"
      }));
      yield { event: "plan", ...(isNonEmptyString(item.id) ? { id: item.id } : {}), entries };
      continue;
    }

    if (isNonEmptyString(item.id) && (eventType === "item.started" || (eventType === "item.completed" && !toolKindById.has(item.id)))) {

      let kind: string | undefined;
      let title: string | undefined;
      let input: unknown;

      if (itemType === "command_execution") {
        kind = "exec";
        title = truncate(isNonEmptyString(item.command) ? item.command : "", 80);
        input = { command: item.command };
      } else if (itemType === "file_edit") {
        kind = "edit";
        title = isNonEmptyString(item.path) ? item.path : "";
      } else if (itemType === "file_change") {
        kind = "edit";
        title = Array.isArray(item.changes)
          ? item.changes.flatMap((change: unknown) => {
              if (!change || typeof change !== "object") return [];
              const file = (change as { path?: unknown }).path;
              return isNonEmptyString(file) ? [file] : [];
            }).join(", ")
          : "files";
      } else if (itemType === "web_search") {
        kind = "search";
        title = isNonEmptyString(item.query) ? item.query : "web";
        input = { query: item.query };
      } else if (itemType === "thinking") {
        kind = "think";
        title = "thinking...";
      } else if (itemType === "mcp_tool_call") {
        const server = isNonEmptyString(item.server) ? item.server : "unknown";
        const tool = isNonEmptyString(item.tool) ? item.tool : "unknown";
        kind = "other";
        title = `${server}.${tool}`;
        input = item.arguments;
      }

      if (kind && title !== undefined) {
        toolTitleById.set(item.id, title);
        toolKindById.set(item.id, kind);
        yield { event: "tool_start", id: item.id, kind, title, ...(input !== undefined ? { input } : {}) };
      }
      if (eventType === "item.started") continue;
    }

    if (eventType === "item.completed") {
      if (itemType === "error" && isNonEmptyString(item.message)) {
        yield { event: "error", message: explainEscalationPolicyRejection(item.message) };
        continue;
      }
      if (itemType === "agent_message") {
        if (!isNonEmptyString(item.text)) continue;
        yield { event: "agent_message", text: item.text };
        continue;
      }

      if (itemType === "reasoning") {
        const text = isNonEmptyString(item.text)
          ? item.text
          : isNonEmptyString(item.content)
            ? item.content
            : isNonEmptyString(item.summary)
              ? item.summary
              : undefined;
        if (!text) continue;
        yield { event: "reasoning", text };
        continue;
      }

      if (!isNonEmptyString(item.id)) continue;

      if (toolKindById.has(item.id)) {
        const kindFromStart = toolKindById.get(item.id);
        const kind =
          kindFromStart ??
          (itemType === "command_execution"
            ? "exec"
            : itemType === "file_edit"
              ? "edit"
              : "other");

        const titleFromEvent = isNonEmptyString(item.path)
          ? item.path
          : itemType === "mcp_tool_call"
            ? `${isNonEmptyString(item.server) ? item.server : "unknown"}.${isNonEmptyString(item.tool) ? item.tool : "unknown"}`
            : undefined;
        const path = titleFromEvent ?? toolTitleById.get(item.id) ?? "";

        toolTitleById.delete(item.id);
        toolKindById.delete(item.id);

        const status = item.status === "declined" || item.status === "cancelled"
          ? "cancelled"
          : item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0)
            ? "failed"
            : item.status === "completed" || item.exit_code === 0 ? "completed" : undefined;
        yield { event: "tool_complete", id: item.id, kind, path, ...(status ? { status } : {}) };
        if (itemType === "command_execution" && status === "failed"
          && isNonEmptyString(item.aggregated_output)
          && (item.aggregated_output.includes("failed to register synthetic bubblewrap mount target ")
            || item.aggregated_output.includes("failed to create synthetic bubblewrap mount marker directory "))
          && item.aggregated_output.includes("No space left on device (os error 28)")) {
          yield {
            event: "error",
            message: `${item.aggregated_output.trim()}
Codex sandbox startup failed before the command ran: synthetic mount staging reported ENOSPC.
This error alone does not establish host disk exhaustion.
Check available blocks and inodes on the staging filesystem; for /tmp, use df -h /tmp and df -i /tmp.
Host diagnostics may observe a different mount namespace or a later filesystem state.
If the host reports free space, investigate sandbox-local tmpfs limits, quotas, and transient allocation pressure;
record the failing path, mount namespace, and diagnostic time before attributing a cause.
Moving the worktree to a volume with free space does not move Codex's synthetic mount staging.
To relocate registry bookkeeping, set TMPDIR before launching a new Codex process:
use an existing private directory on a filesystem with available blocks and inodes, permitted by the session policy.
For example, create a private workspace temp directory and launch Codex with TMPDIR pointing to its absolute path.
This does not relocate an already running session and does not prevent other writes to the full filesystem.
Only if capacity exhaustion is confirmed, free temporary files you own and no longer need or ask the host administrator;
then retry the command in the same sandbox. Do not delete other workers' files.
If even diagnostic commands cannot start, request the exact diagnostic command through the existing approval reviewer
with sandbox_permissions: "require_escalated", only when the session policy permits it.
Do not retry automatically outside the sandbox or bypass a denied approval.`
          };
        }
        if (itemType === "command_execution" && status === "failed"
          && isNonEmptyString(item.aggregated_output)
          && item.aggregated_output.includes("esbuild/lib/main.js:")
          && item.aggregated_output.split("\n").some((line) => line.trim() === "error: The service was stopped"
            || line.trim() === "Error: The service was stopped")) {
          yield {
            event: "error",
            message: `${item.aggregated_output.trim()}
esbuild's child service stopped; this message alone does not establish a sandbox denial.
On Linux, Codex's restricted-network sandbox can reject Bun's sendto on an AF_UNIX
child-service socket with EPERM. esbuild then reads EOF and exits without a useful error.
For Node-compatible build scripts, try Node in the same directory and same sandbox.
To confirm this boundary, capture child syscalls and check for sendto(..., NULL, 0) = -1 EPERM;
compare a minimal esbuild transform under Bun and Node on the failing Linux host.
A successful esbuild --version does not verify the service socket lifecycle.
If session policy permits, request the exact failing probe through the existing approval reviewer
with sandbox_permissions: "require_escalated" to compare execution outside the sandbox.
Do not retry automatically or bypass a denial. A passing macOS probe does not verify Linux.
Keep build prerequisite failures separate from application test failures.`
          };
        }
        if (itemType === "command_execution" && status === "failed"
          && isNonEmptyString(item.aggregated_output)
          && item.aggregated_output.trim().startsWith("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted")) {
          yield {
            event: "error",
            message: `${item.aggregated_output.trim()}
Codex could not initialize its sandbox: this host rejected bubblewrap network namespace setup.
For read-only work, verify the Landlock compatibility sandbox:
  codex --enable use_legacy_landlock -c 'sandbox_mode="read-only"' sandbox /bin/pwd
If that succeeds, start a new session:
  codex --enable use_legacy_landlock -s read-only
Poe Code supplies these flags for mode: "read".
For workspace-write, keep the session policy and existing approval reviewer.
Ask Codex to retry the exact failed command with:
  sandbox_permissions: "require_escalated"
  justification: "Sandbox startup failed before this command ran."
Only run after approval; if declined or unavailable, stop that action.
If apply_patch also fails at sandbox startup, request an approved exec_command
for the specific edit instead. Do not retry automatically outside the sandbox.
With approval_policy=never or policies incompatible with approved escalation,
use a host that supports bubblewrap and the required sandbox policy.`
          };
        }
      }
    }
  }
}

function explainEscalationPolicyRejection(message: string): string {
  if (!message.toLowerCase().includes("active permission policy prohibits granting escalation")) return message;
  return `${message}
Escalation is unavailable under the active policy. For an authorized command,
use normal sandbox execution with sandbox_permissions: "use_default"
only if the active sandbox permits that command. This does not guarantee network access.
If the sandboxed command also fails, report that permission or transport failure separately;
earlier approvals and cached results do not establish current access or readiness.
Do not bypass the policy or retry automatically outside the sandbox.`;
}

function extractErrorMessage(event: CodexEvent): string | undefined {
  if (isNonEmptyString(event.message)) return event.message;

  const error = event.error;
  if (isNonEmptyString(error)) return error;
  if (typeof error === "object" && error !== null) {
    const errorObj = error as { message?: unknown };
    if (isNonEmptyString(errorObj.message)) return errorObj.message;
  }

  if (isNonEmptyString(event.reason)) return event.reason;
  return undefined;
}
