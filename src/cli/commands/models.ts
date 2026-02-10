import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { loadCredentials } from "../../services/credentials.js";
import { ApiError } from "../errors.js";
import { getTheme, renderTable } from "@poe-code/design-system";

interface ModelEntry {
  id: string;
  created: number;
  owned_by: string;
  context_window: {
    context_length: number | null;
    max_output_tokens: number | null;
  } | null;
  supported_features: string[] | null;
  pricing: {
    prompt: number | null;
    completion: number | null;
    request: number | null;
    input_cache_read: number | null;
    input_cache_write: number | null;
  } | null;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  } | null;
  reasoning: {
    budget: unknown;
    required: boolean;
    supports_reasoning_effort: boolean;
  } | null;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_048_576) {
    const value = tokens / 1_048_576;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`;
  }
  if (tokens >= 1_024) {
    const value = tokens / 1_024;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}K`;
  }
  return String(tokens);
}

function formatPrice(perToken: number): string {
  const perMTok = Math.round(perToken * 1_000_000 * 100) / 100;
  return `$${perMTok.toFixed(2)}`;
}

function formatOptionalPrice(value: number | null): string {
  return value != null ? formatPrice(value) : "-";
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasFeature(model: ModelEntry, feature: string): boolean {
  if (feature === "reasoning") return model.reasoning != null;
  return (model.supported_features ?? []).includes(feature);
}

export function registerModelsCommand(
  program: Command,
  container: CliContainer
): void {
  program
    .command("models")
    .description("List available Poe API models.")
    .option("--provider <name>", "Filter by provider name")
    .option("--model <name>", "Filter by model id")
    .option("--feature <name>", "Filter by feature (tools, web_search, reasoning)")
    .option("--input <modalities>", "Filter by input modalities (e.g. text,image)")
    .option("--output <modalities>", "Filter by output modalities (e.g. text)")
    .option("--view <name>", "Table view: capabilities or pricing", "capabilities")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "models"
      );
      const commandOptions = this.opts<{
        provider?: string;
        model?: string;
        feature?: string;
        input?: string;
        output?: string;
        view: string;
      }>();

      resources.logger.intro("models");

      try {
        const apiKey = await loadCredentials({
          fs: container.fs,
          filePath: container.env.credentialsPath
        });

        if (flags.dryRun) {
          resources.logger.dryRun(
            "Dry run: would fetch models from Poe API."
          );
          return;
        }

        const headers: Record<string, string> = {};
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const response = await container.httpClient(
          `${container.env.poeBaseUrl}/v1/models`,
          {
            method: "GET",
            headers
          }
        );

        if (!response.ok) {
          throw new ApiError(
            `Failed to fetch models (HTTP ${response.status})`,
            {
              httpStatus: response.status,
              endpoint: "/v1/models"
            }
          );
        }

        const result = (await response.json()) as {
          object: string;
          data: ModelEntry[];
        };

        const allModels = result.data;

        if (allModels.length === 0) {
          resources.logger.info("No models found.");
          return;
        }

        let filtered = allModels;
        if (commandOptions.provider) {
          const term = commandOptions.provider.toLowerCase();
          filtered = filtered.filter((m) =>
            m.owned_by.toLowerCase().includes(term)
          );
        }
        if (commandOptions.model) {
          const term = commandOptions.model.toLowerCase();
          filtered = filtered.filter((m) =>
            m.id.toLowerCase().includes(term)
          );
        }
        if (commandOptions.feature) {
          const feature = commandOptions.feature.toLowerCase();
          filtered = filtered.filter((m) => hasFeature(m, feature));
        }
        if (commandOptions.input) {
          const required = commandOptions.input.toLowerCase().split(",");
          filtered = filtered.filter((m) => {
            const modalities = m.architecture?.input_modalities ?? [];
            return required.every((r) => modalities.includes(r));
          });
        }
        if (commandOptions.output) {
          const required = commandOptions.output.toLowerCase().split(",");
          filtered = filtered.filter((m) => {
            const modalities = m.architecture?.output_modalities ?? [];
            return required.every((r) => modalities.includes(r));
          });
        }

        if (filtered.length === 0) {
          resources.logger.info("No models match the given filters.");
          return;
        }

        filtered.sort((a, b) => b.created - a.created);

        const theme = getTheme();
        let columns;
        let rows;

        if (commandOptions.view === "pricing") {
          columns = [
            { name: "Model", title: "Model", alignment: "left" as const, maxLen: 35 },
            { name: "Context", title: "Context", alignment: "right" as const, maxLen: 9 },
            { name: "Input", title: "Input $/MTok", alignment: "right" as const, maxLen: 12 },
            { name: "Output", title: "Output $/MTok", alignment: "right" as const, maxLen: 13 },
            { name: "CacheRead", title: "Cache Read", alignment: "right" as const, maxLen: 10 },
            { name: "CacheWrite", title: "Cache Write", alignment: "right" as const, maxLen: 11 },
            { name: "Request", title: "Request", alignment: "right" as const, maxLen: 9 }
          ];

          rows = filtered.map((model) => {
            const pricing = model.pricing;
            return {
              Model: theme.accent(`${model.owned_by.toLowerCase()}/${model.id}`),
              Context: model.context_window?.context_length != null ? formatTokenCount(model.context_window.context_length) : "-",
              Input: formatOptionalPrice(pricing?.prompt ?? null),
              Output: formatOptionalPrice(pricing?.completion ?? null),
              CacheRead: formatOptionalPrice(pricing?.input_cache_read ?? null),
              CacheWrite: formatOptionalPrice(pricing?.input_cache_write ?? null),
              Request: formatOptionalPrice(pricing?.request ?? null)
            };
          });
        } else {
          const allFeatures = Array.from(
            new Set(filtered.flatMap((m) => m.supported_features ?? []))
          ).sort();

          columns = [
            { name: "Model", title: "Model", alignment: "left" as const, maxLen: 35 },
            { name: "Date", title: "Date Added", alignment: "left" as const, maxLen: 12 },
            { name: "Modality", title: "Modality", alignment: "left" as const, maxLen: 18 },
            { name: "Context", title: "Context", alignment: "right" as const, maxLen: 9 },
            { name: "Reasoning", title: "Reasoning", alignment: "left" as const, maxLen: 9 },
            ...allFeatures.map((feature) => ({
              name: feature,
              title: feature,
              alignment: "left" as const,
              maxLen: Math.max(feature.length, 3)
            }))
          ];

          rows = filtered.map((model) => {
            const row: Record<string, string> = {
              Model: theme.accent(`${model.owned_by.toLowerCase()}/${model.id}`),
              Date: theme.muted(formatDate(model.created)),
              Modality: model.architecture
                ? `${model.architecture.input_modalities.join(",")}->${model.architecture.output_modalities.join(",")}`
                : "-",
              Context: model.context_window?.context_length != null ? formatTokenCount(model.context_window.context_length) : "-",
              Reasoning: model.reasoning ? theme.success("✓") : ""
            };
            for (const feature of allFeatures) {
              row[feature] = (model.supported_features ?? []).includes(feature)
                ? theme.success("✓")
                : "";
            }
            return row;
          });
        }

        resources.logger.info(renderTable({ theme, columns, rows }));
      } catch (error) {
        if (error instanceof Error) {
          resources.logger.logException(error, "models", {
            operation: "fetch-models"
          });
        }
        throw error;
      }
    });
}
