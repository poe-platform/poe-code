import type { Command } from "commander";
import parseDuration from "parse-duration";
import { stringify as yamlStringify } from "yaml";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { ApiError } from "../errors.js";
import { getTheme, renderTable, withSpinner } from "@poe-code/design-system";

interface ModelParameter {
  name: string;
  schema: {
    type?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
  };
  default_value?: unknown;
  description?: string;
}

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
  parameters: ModelParameter[];
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

function formatParameterType(schema: ModelParameter["schema"]): string {
  if (schema.enum) return "enum";
  return schema.type ?? "unknown";
}

function truncate(value: string, maxLen: number): string {
  if (value.length > maxLen) {
    return `${value.slice(0, maxLen - 3)}...`;
  }
  return value;
}

const MAX_VALUES_LENGTH = 105;
const MAX_DEFAULT_LENGTH = 36;

function formatParameterValues(schema: ModelParameter["schema"]): string {
  let result = "";
  if (schema.enum) {
    result = schema.enum.join(", ");
  } else if (schema.type === "number" && (schema.minimum != null || schema.maximum != null)) {
    result = `${schema.minimum ?? ""}..${schema.maximum ?? ""}`;
  }
  return truncate(result, MAX_VALUES_LENGTH);
}

function formatDefaultValue(value: unknown): string {
  if (value == null) return "";
  return truncate(String(value), MAX_DEFAULT_LENGTH);
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
    .option("--tools", "Show only models with tool support")
    .option("--since <duration>", "Show models added within duration (e.g. 7d, 2w, 3mo)")
    .option("--view <name>", "Table view: capabilities, pricing, parameters, or raw", "capabilities")
    .addHelpText("after", [
      "",
      "Filters:",
      "  --provider   Substring match on provider/owner (e.g. anthropic, openai)",
      "  --model      Substring match on model id (e.g. sonnet, gpt)",
      "  --feature    Exact match: tools, web_search, or reasoning",
      "  --input      Comma-separated input modalities: text, image, audio, video",
      "  --output     Comma-separated output modalities: text, image, audio",
      "  --tools      Shorthand for --feature tools",
      "  --since      Duration: s, m, h, d, w, mo, y (e.g. 7d, 2w, 3mo, 1y)",
      "",
      "Views:",
      "  capabilities  Model features, modalities, and context window (default)",
      "  pricing       Cost per million tokens with cache pricing",
      "  parameters    Model parameters grouped by model with type and defaults",
      "  raw           Full model data in YAML format",
      "",
      "Examples:",
      "  $ poe-code models --provider anthropic",
      "  $ poe-code models --feature reasoning --since 3mo",
      "  $ poe-code models --input image --view pricing",
      "  $ poe-code models --model claude --view parameters",
      "  $ poe-code models --since 2w --output text"
    ].join("\n"))
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
        tools?: boolean;
        since?: string;
        view: string;
      }>();

      resources.logger.intro("models");

      try {
        const apiKey = await container.readApiKey();

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

        const result = await withSpinner({
          message: "Fetching models...",
          fn: async () => {
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

            return (await response.json()) as {
              object: string;
              data: ModelEntry[];
            };
          },
          stopMessage: (r) => `${r.data.length} models`
        });

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
        if (commandOptions.tools) {
          filtered = filtered.filter((m) => hasFeature(m, "tools"));
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
        if (commandOptions.since) {
          const duration = parseDuration(commandOptions.since);
          if (duration != null) {
            const cutoff = Date.now() - duration;
            filtered = filtered.filter((m) => m.created >= cutoff);
          }
        }

        if (filtered.length === 0) {
          resources.logger.info("No models match the given filters.");
          return;
        }

        filtered.sort((a, b) => b.created - a.created);

        const theme = getTheme();

        if (commandOptions.view === "raw") {
          resources.logger.info(yamlStringify(filtered));
          return;
        }

        let columns;
        let rows;

        if (commandOptions.view === "parameters") {
          const withParams = filtered.filter((m) => m.parameters.length > 0);
          if (withParams.length === 0) {
            resources.logger.info("No models with parameters match the given filters.");
            return;
          }

          columns = [
            { name: "Model", title: "Model", alignment: "left" as const, maxLen: 35 },
            { name: "Parameter", title: "Parameter", alignment: "left" as const, maxLen: 28 },
            { name: "Type", title: "Type", alignment: "left" as const, maxLen: 9 },
            { name: "Default", title: "Default", alignment: "left" as const, maxLen: 12 },
            { name: "Values", title: "Values/Range", alignment: "left" as const, maxLen: 35 }
          ];

          rows = [];
          for (const model of withParams) {
            const modelLabel = theme.accent(`${model.owned_by.toLowerCase()}/${model.id}`);
            rows.push({ Model: modelLabel, Parameter: "", Type: "", Default: "", Values: "" });
            for (const param of model.parameters) {
              rows.push({
                Model: "",
                Parameter: param.name,
                Type: formatParameterType(param.schema),
                Default: formatDefaultValue(param.default_value),
                Values: formatParameterValues(param.schema)
              });
            }
          }
        } else if (commandOptions.view === "pricing") {
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
