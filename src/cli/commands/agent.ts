import type { Command } from "commander";
import {
  createToolRenderState,
  renderAcpEvent,
  sessionUpdateToEvents,
  type SessionUpdate
} from "@poe-code/agent-spawn";
import { POE_PROVIDER_ID } from "@poe-code/providers";
import { isUserError } from "@poe-code/user-error";
import type { CliContainer } from "../container.js";
import { ReportedError, ValidationError, isSilentError } from "../errors.js";
import { requireNonEmpty } from "../options.js";
import {
  apiKeyFlagDescription,
  createExecutionResources,
  resolveCommandFlags,
  warnApiKeyFlag
} from "./shared.js";

interface AgentCommandOptions {
  model?: string;
  apiKey?: string;
}

/**
 * Rejects a model id the Poe catalog does not list before the run reaches the
 * API. An unknown id is a typo, and the upstream 404 names neither the id nor
 * the command that lists the valid ones. Best effort: when the catalog cannot be
 * read the run proceeds rather than blocking on an unrelated failure.
 */
async function assertModelIsInCatalog(
  container: CliContainer,
  model: string,
  apiKey: string | undefined
): Promise<void> {
  let credential = apiKey;
  if (credential === undefined) {
    try {
      credential =
        (await container.providerRegistry.resolveCredential(POE_PROVIDER_ID, undefined, {
          envVars: container.env.variables,
          readOnly: true
        })) ?? undefined;
    } catch {
      return;
    }
  }

  const ids = new Set<string>();
  try {
    const response = await container.httpClient(`${container.env.poeBaseUrl}/v1/models`, {
      method: "GET",
      headers: credential ? { Authorization: `Bearer ${credential}` } : {}
    });
    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    for (const entry of body.data ?? []) {
      if (typeof entry.id !== "string") {
        continue;
      }
      const id = entry.id.toLowerCase();
      ids.add(id);
      if (typeof entry.owned_by === "string") {
        ids.add(`${entry.owned_by.toLowerCase()}/${id}`);
      }
    }
  } catch {
    return;
  }

  if (ids.size === 0 || ids.has(model.toLowerCase())) {
    return;
  }

  throw new ValidationError(
    `Unknown model "${model}". Run "poe-code models" to list the available model ids.`
  );
}

export function registerAgentCommand(program: Command, container: CliContainer): void {
  program
    .command("agent")
    .description("Run a one-shot Poe agent prompt.")
    .argument("<prompt>", "Prompt text to send")
    .requiredOption("--model <model>", "Model identifier")
    .option("--api-key <key>", apiKeyFlagDescription("POE_API_KEY"))
    .action(async function (this: Command, prompt: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "agent");
      const options = this.opts<AgentCommandOptions>();
      const model =
        options.model === undefined ? undefined : requireNonEmpty(options.model, "--model");
      const apiKey =
        options.apiKey === undefined ? undefined : requireNonEmpty(options.apiKey, "--api-key");

      resources.logger.intro("agent");
      warnApiKeyFlag(resources.logger, options.apiKey, "POE_API_KEY");

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
        if (model === undefined) {
          throw new ValidationError("--model is required.");
        }
        const requestedModel = model;
        await assertModelIsInCatalog(container, requestedModel, apiKey);

        const { createAgentSession } = await import("@poe-code/poe-agent");
        session = await createAgentSession({
          model: requestedModel,
          apiKey,
          cwd: container.env.cwd
        });

        const toolRenderState = createToolRenderState();
        const response = await session.sendMessage(prompt, {
          onSessionUpdate(update: SessionUpdate) {
            for (const event of sessionUpdateToEvents(update, toolRenderState)) {
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
      } catch (error) {
        if (isSilentError(error)) {
          throw error;
        }
        // Render the failure before finalize() closes the panel, otherwise the
        // panel reads as a success and the error lands outside it.
        const raw = error instanceof Error ? error : new Error(String(error));
        // A user error carries its own guidance: rendering it as a validation
        // failure keeps the stack trace and the log pointer out of the panel.
        const failure = isUserError(raw) ? new ValidationError(raw.message) : raw;
        resources.logger.errorWithStack(failure);
        throw new ReportedError(failure.message);
      } finally {
        if (session) {
          await session.dispose();
        }
        resources.context.finalize();
      }
    });
}
