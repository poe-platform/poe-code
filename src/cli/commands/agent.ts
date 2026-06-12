import type { Command } from "commander";
import { renderAcpEvent, type AcpEvent, type SessionUpdate } from "@poe-code/agent-spawn";
import type { CliContainer } from "../container.js";
import { DEFAULT_FRONTIER_MODEL } from "../constants.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";

interface AgentCommandOptions {
  model?: string;
  apiKey?: string;
}

export function registerAgentCommand(program: Command, container: CliContainer): void {
  program
    .command("agent")
    .description("Run a one-shot Poe agent prompt.")
    .argument("<prompt>", "Prompt text to send")
    .option("--model <model>", `Model identifier (default: ${DEFAULT_FRONTIER_MODEL})`)
    .option("--api-key <key>", "Poe API key")
    .action(async function (this: Command, prompt: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "agent");
      const options = this.opts<AgentCommandOptions>();

      resources.logger.intro("agent");

      if (flags.dryRun) {
        resources.context.complete({
          success: "Agent response received.",
          dry: "Dry run: would send a prompt to Poe agent."
        });
        resources.context.finalize();
        return;
      }

      let session:
        | Awaited<ReturnType<(typeof import("@poe-code/poe-agent"))["createAgentSession"]>>
        | undefined;

      try {
        const { createAgentSession } = await import("@poe-code/poe-agent");
        session = await createAgentSession({
          model: options.model ?? DEFAULT_FRONTIER_MODEL,
          apiKey: options.apiKey,
          cwd: container.env.cwd
        });

        const startedToolCalls = new Set<string>();
        const response = await session.sendMessage(prompt, {
          onSessionUpdate(update: SessionUpdate) {
            for (const event of toAcpEvents(update, startedToolCalls)) {
              renderAcpEvent(event);
            }
          }
        });
        if (typeof response.content === "string") {
          resources.logger.info(response.content);
        }

        resources.context.complete({
          success: "Agent response received.",
          dry: "Dry run: would send a prompt to Poe agent."
        });
      } finally {
        if (session) {
          await session.dispose();
        }
        resources.context.finalize();
      }
    });
}

function toAcpEvents(update: SessionUpdate, started: Set<string>): AcpEvent[] {
  if (update.sessionUpdate === "tool_call") {
    if (started.has(update.toolCallId)) return [];
    started.add(update.toolCallId);
    return [
      {
        event: "tool_start",
        kind: "exec",
        title: update.title,
        id: update.toolCallId
      }
    ];
  }

  if (update.sessionUpdate === "tool_call_update") {
    if (update.status === "completed" || update.status === "failed") {
      return [
        {
          event: "tool_complete",
          kind: "exec",
          path: typeof update.rawOutput === "string" ? update.rawOutput : "",
          id: update.toolCallId
        }
      ];
    }
  }

  return [];
}
