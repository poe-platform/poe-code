import { Option, type Command } from "commander";
import parseDuration from "parse-duration";
import { stringify as yamlStringify } from "yaml";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { ApiError, ValidationError } from "../errors.js";
import { getTheme, renderTable, withSpinner } from "toolcraft-design";
import { POE_PROVIDER_ID } from "@poe-code/providers";

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
  supported_endpoints: string[] | null;
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

interface PreprocessedModelEntry extends ModelEntry {
  normalized_supported_endpoints: string[];
}

const modelViewNames = ["capabilities", "pricing", "parameters", "raw"] as const;
type ModelViewName = typeof modelViewNames[number];

interface ModelsCommandOptions {
  provider?: string;
  model?: string;
  search?: string;
  feature?: string;
  endpoint?: string;
  input?: string;
  output?: string;
  tools?: boolean;
  since?: string;
  view: ModelViewName;
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

function namespacedModelId(model: ModelEntry): string {
  return `${model.owned_by.toLowerCase()}/${model.id.toLowerCase()}`;
}

function hasFeature(model: ModelEntry, feature: string): boolean {
  if (feature === "reasoning") return model.reasoning != null;
  return (model.supported_features ?? []).includes(feature);
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().toLowerCase();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function preprocessModels(models: ModelEntry[]): {
  models: PreprocessedModelEntry[];
  availableEndpoints: string[];
  availableProviders: string[];
  availableFeatures: string[];
  availableInputModalities: string[];
  availableOutputModalities: string[];
} {
  const availableEndpoints = new Set<string>();
  const availableProviders = new Set<string>();
  const availableFeatures = new Set<string>(["reasoning"]);
  const availableInputModalities = new Set<string>();
  const availableOutputModalities = new Set<string>();
  const preprocessedModels = models.map((model) => {
    const normalizedSupportedEndpoints = (model.supported_endpoints ?? [])
      .map(normalizeEndpoint);

    for (const endpoint of normalizedSupportedEndpoints) {
      availableEndpoints.add(endpoint);
    }
    availableProviders.add(model.owned_by.toLowerCase());
    for (const feature of model.supported_features ?? []) {
      availableFeatures.add(feature);
    }
    for (const modality of model.architecture?.input_modalities ?? []) {
      availableInputModalities.add(modality);
    }
    for (const modality of model.architecture?.output_modalities ?? []) {
      availableOutputModalities.add(modality);
    }

    return {
      ...model,
      normalized_supported_endpoints: normalizedSupportedEndpoints
    };
  });

  return {
    models: preprocessedModels,
    availableEndpoints: Array.from(availableEndpoints).sort(),
    availableProviders: Array.from(availableProviders).sort(),
    availableFeatures: Array.from(availableFeatures).sort(),
    availableInputModalities: Array.from(availableInputModalities).sort(),
    availableOutputModalities: Array.from(availableOutputModalities).sort()
  };
}

function toRawModel(model: PreprocessedModelEntry): ModelEntry {
  const { normalized_supported_endpoints: ignored_normalized_supported_endpoints, ...rawModel } = model;
  return rawModel;
}

function hasActiveFilters(options: ModelsCommandOptions): boolean {
  return options.provider !== undefined ||
    options.model !== undefined ||
    options.search !== undefined ||
    options.feature !== undefined ||
    options.endpoint !== undefined ||
    options.input !== undefined ||
    options.output !== undefined ||
    options.tools === true ||
    options.since !== undefined;
}

function parseSinceDuration(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const duration = parseDuration(value);
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    throw new ValidationError(
      `Invalid --since duration "${value}". Use a positive duration such as 7d, 2w, 3mo, or 1y.`
    );
  }
  return duration;
}

function normalizeRequiredFilter(name: string, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new ValidationError(`Invalid ${name} value: must be non-empty.`);
  }
  return normalized;
}

function normalizeSearchFilter(value: string): string {
  const normalized = normalizeRequiredFilter("--search", value);
  const withoutTrailingSlash = normalized.endsWith("/")
    ? normalized.slice(0, -1).trimEnd()
    : normalized;
  if (withoutTrailingSlash.length === 0) {
    throw new ValidationError("Invalid --search value: must be non-empty.");
  }
  return withoutTrailingSlash;
}

function unknownFilterError(flag: string, value: string, known: string[]): ValidationError {
  const prefix = value.slice(0, 3);
  const suggestions = known.filter((candidate) =>
    candidate.includes(value) ||
    value.includes(candidate) ||
    (prefix.length === 3 && candidate.startsWith(prefix))
  );
  const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
  return new ValidationError(
    `Unknown ${flag} value "${value}".${hint} Known ${flag} values: ${known.length > 0 ? known.join(", ") : "none"}`
  );
}

function parseModalityFilter(name: string, value: string): string[] {
  const modalities = value.split(",").map((part) => part.trim().toLowerCase());
  if (modalities.some((part) => part.length === 0)) {
    throw new ValidationError(
      `Invalid ${name} value: modalities must be non-empty comma-separated values.`
    );
  }
  return modalities;
}

function validateModelsResponse(models: ModelEntry[]): void {
  for (const [index, model] of models.entries()) {
    if (typeof model.created !== "number" || !Number.isFinite(model.created)) {
      throw new ApiError(
        `Invalid models response: data[${index}].created must be a finite number.`,
        { endpoint: "/v1/models" }
      );
    }
  }
}

async function fetchModels(
  container: CliContainer,
  headers: Record<string, string>
): Promise<{ object: string; data: ModelEntry[] }> {
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
}

function writeYaml(value: unknown): void {
  const output = yamlStringify(value);
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

export function registerModelsCommand(
  program: Command,
  container: CliContainer
): void {
  program
    .command("models")
    .alias("m")
    .description("List available Poe API models.")
    .option("--provider <name>", "Filter by provider name")
    .option("--model <name>", "Filter by exact model id (bare or provider/id)")
    .option("--search <term>", "Search the rendered provider/id label")
    .option("--feature <name>", "Filter by feature (tools, web_search, reasoning)")
    .option("--endpoint <path>", "Filter by supported endpoint (e.g. /v1/responses)")
    .option("--input <modalities>", "Filter by input modalities (e.g. text,image)")
    .option("--output <modalities>", "Filter by output modalities (e.g. text)")
    .option("--tools", "Show only models with tool support")
    .option("--since <duration>", "Show models added within duration (e.g. 7d, 2w, 3mo)")
    .addOption(
      new Option(
        "--view <name>",
        "Table view: capabilities, pricing, parameters, or raw"
      ).choices(Array.from(modelViewNames)).default("capabilities")
    )
    .addHelpText("after", [
      "",
      "Filters:",
      "  --provider   Substring match on provider/owner (e.g. anthropic, openai)",
      "  --model      Exact model id match, bare or namespaced (case-insensitive,",
      "               e.g. gpt-5.2-codex or openai/gpt-5.2-codex)",
      "  --search     Substring match on the displayed provider/id label",
      "               (e.g. sonnet, openai, anthropic/claude)",
      "  --feature    Exact match: tools, web_search, or reasoning",
      "  --endpoint   Exact supported endpoint match (e.g. /v1/responses)",
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
      "  $ poe-code models --endpoint /v1/responses",
      "  $ poe-code models --input image --view pricing",
      "  $ poe-code models --search claude --view parameters",
      "  $ poe-code models --model anthropic/claude-opus-4.7 --view raw",
      "  $ poe-code models --since 2w --output text"
    ].join("\n"))
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "models"
      );
      const commandOptions = this.opts<ModelsCommandOptions>();
      const rawView = commandOptions.view === "raw";

      if (!rawView) {
        resources.logger.intro("models");
      }

      try {
        const sinceDuration = parseSinceDuration(commandOptions.since);
        const providerFilter = commandOptions.provider !== undefined
          ? normalizeRequiredFilter("--provider", commandOptions.provider)
          : undefined;
        const modelFilter = commandOptions.model !== undefined
          ? normalizeRequiredFilter("--model", commandOptions.model)
          : undefined;
        const searchFilter = commandOptions.search !== undefined
          ? normalizeSearchFilter(commandOptions.search)
          : undefined;
        const endpointFilter = commandOptions.endpoint !== undefined
          ? normalizeEndpoint(normalizeRequiredFilter("--endpoint", commandOptions.endpoint))
          : undefined;
        const featureFilter = commandOptions.feature !== undefined
          ? normalizeRequiredFilter("--feature", commandOptions.feature)
          : undefined;
        const inputFilter = commandOptions.input !== undefined
          ? parseModalityFilter("--input", commandOptions.input)
          : undefined;
        const outputFilter = commandOptions.output !== undefined
          ? parseModalityFilter("--output", commandOptions.output)
          : undefined;
        let apiKey: string | null = null;
        try {
          apiKey = await container.providerRegistry.resolveCredential(POE_PROVIDER_ID, undefined, {
            envVars: container.env.variables,
            readOnly: flags.dryRun
          });
        } catch {
          apiKey = null;
        }

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

        const result = rawView
          ? await fetchModels(container, headers)
          : await withSpinner<{ object: string; data: ModelEntry[] }>({
            message: "Fetching models...",
            fn: () => fetchModels(container, headers),
            stopMessage: (r) => `${r.data.length} models fetched`
          });

        validateModelsResponse(result.data);
        const {
          models: allModels,
          availableEndpoints,
          availableProviders,
          availableFeatures,
          availableInputModalities,
          availableOutputModalities
        } = preprocessModels(result.data);

        if (!rawView && allModels.length === 0) {
          resources.logger.info("No models found.");
          return;
        }

        if (providerFilter !== undefined &&
          !availableProviders.some((provider) => provider.includes(providerFilter))) {
          throw unknownFilterError("--provider", providerFilter, availableProviders);
        }
        if (featureFilter !== undefined && !availableFeatures.includes(featureFilter)) {
          throw unknownFilterError("--feature", featureFilter, availableFeatures);
        }
        for (const modality of inputFilter ?? []) {
          if (!availableInputModalities.includes(modality)) {
            throw unknownFilterError("--input", modality, availableInputModalities);
          }
        }
        for (const modality of outputFilter ?? []) {
          if (!availableOutputModalities.includes(modality)) {
            throw unknownFilterError("--output", modality, availableOutputModalities);
          }
        }

        let filtered = allModels;
        if (providerFilter !== undefined) {
          filtered = filtered.filter((m) =>
            m.owned_by.toLowerCase().includes(providerFilter)
          );
        }
        if (modelFilter !== undefined) {
          filtered = filtered.filter((m) =>
            m.id.toLowerCase() === modelFilter ||
            namespacedModelId(m) === modelFilter
          );
        }
        if (searchFilter !== undefined) {
          filtered = filtered.filter((m) =>
            namespacedModelId(m).includes(searchFilter)
          );
        }
        if (featureFilter !== undefined) {
          filtered = filtered.filter((m) => hasFeature(m, featureFilter));
        }
        if (endpointFilter !== undefined) {
          if (!availableEndpoints.includes(endpointFilter)) {
            const availableLabel = availableEndpoints.length > 0
              ? availableEndpoints.join(", ")
              : "none";
            throw new ValidationError(
              `Unsupported endpoint "${endpointFilter}". Available endpoints: ${availableLabel}`
            );
          }
          filtered = filtered.filter((m) =>
            m.normalized_supported_endpoints.includes(endpointFilter)
          );
        }
        if (commandOptions.tools) {
          filtered = filtered.filter((m) => hasFeature(m, "tools"));
        }
        if (inputFilter !== undefined) {
          filtered = filtered.filter((m) => {
            const modalities = m.architecture?.input_modalities ?? [];
            return inputFilter.every((r) => modalities.includes(r));
          });
        }
        if (outputFilter !== undefined) {
          filtered = filtered.filter((m) => {
            const modalities = m.architecture?.output_modalities ?? [];
            return outputFilter.every((r) => modalities.includes(r));
          });
        }
        const beforeSinceCount = filtered.length;
        if (sinceDuration !== undefined) {
          const cutoff = Date.now() - sinceDuration;
          filtered = filtered.filter((m) => m.created >= cutoff);
        }

        if (!rawView && hasActiveFilters(commandOptions)) {
          resources.logger.info(`${filtered.length}/${allModels.length} models`);
        }

        if (!rawView && filtered.length === 0) {
          resources.logger.info(
            sinceDuration !== undefined && beforeSinceCount > 0
              ? `No models added in the last ${commandOptions.since} (of ${beforeSinceCount} total).`
              : "No models match the given filters."
          );
          return;
        }

        filtered.sort((a, b) => b.created - a.created);

        if (rawView) {
          writeYaml(filtered.map(toRawModel));
          return;
        }

        const theme = getTheme();

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
            { name: "Modality", title: "Modality", alignment: "left" as const, maxLen: 24 },
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
            const row: Record<string, string> = Object.assign(Object.create(null), {
              Model: theme.accent(`${model.owned_by.toLowerCase()}/${model.id}`),
              Date: theme.muted(formatDate(model.created)),
              Modality: model.architecture
                ? `${model.architecture.input_modalities.join(",")}->${model.architecture.output_modalities.join(",")}`
                : "-",
              Context: model.context_window?.context_length != null ? formatTokenCount(model.context_window.context_length) : "-",
              Reasoning: model.reasoning ? theme.success("✓") : ""
            });
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
