import { renderAcpEvent, renderAcpStream } from "@poe-code/agent-spawn";
import { renderMarkdown, resolveOutputFormat } from "@poe-code/design-system";
import { spawnPoeAgentWithAcp } from "../../providers/poe-agent.js";
import { DEFAULT_FRONTIER_MODEL } from "../constants.js";
import type { CustomSpawnHandler } from "./spawn.js";

const REDACTED_PROMPT_ARG = "[prompt redacted]";

export function createPoeAgentSpawnHandler(): CustomSpawnHandler {
  return async ({ options, flags, resources }) => {
    const shouldEmitUiOutput = resolveOutputFormat() !== "json";

    if (flags.dryRun) {
      resources.logger.info(
        `Dry run: would spawn Poe Agent.\nPrompt: ${REDACTED_PROMPT_ARG} (${options.prompt.length} chars)`
      );
      return;
    }

    const { events, done } = spawnPoeAgentWithAcp({
      prompt: options.prompt,
      model: options.model ?? DEFAULT_FRONTIER_MODEL,
      cwd: options.cwd ?? process.cwd(),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {})
    });

    await renderAcpStream(events);
    const result = await done;

    if (!shouldEmitUiOutput) {
      renderAcpEvent({
        event: "spawn_result",
        exitCode: result.exitCode,
        ...(result.threadId ? { threadId: result.threadId } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
        protocolVersion: 1
      });
    }

    if (result.exitCode !== 0) {
      if (!shouldEmitUiOutput) {
        process.exitCode = result.exitCode;
        return;
      }
      const detail = result.stderr.trim() || result.stdout.trim();
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`Poe Agent spawn failed with exit code ${result.exitCode}${suffix}`);
    }

    if (shouldEmitUiOutput) {
      const trimmedStdout = result.stdout.trim();
      if (trimmedStdout) {
        resources.logger.info(renderMarkdown(trimmedStdout).trimEnd());
      }
    }

    process.exitCode = result.exitCode;
  };
}
