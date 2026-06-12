import { renderAcpEvent, renderAcpStream } from "@poe-code/agent-spawn";
import { renderMarkdown, resolveOutputFormat } from "toolcraft-design";
import { spawnPoeAgentWithAcp } from "../../providers/poe-agent.js";
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
      model: options.model,
      cwd: options.cwd ?? process.cwd(),
      resumeThreadId: options.resumeThreadId,
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
      if (result.threadId) {
        resources.logger.info(
          `Resume: poe-code spawn --agent poe-agent --resume-thread-id ${result.threadId}`
        );
      }
    }

    process.exitCode = result.exitCode;
  };
}
