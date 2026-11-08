import fs from "node:fs";
type ProviderMetadata = {
  service: string;
};

const PROVIDERS = new Map<string, ProviderMetadata>([
  ["claude-code", { service: "claude-code" }],
  ["codex", { service: "codex" }],
  ["opencode", { service: "opencode" }]
]);

type RequiredEnvName = "LABEL_NAME" | "ISSUE_NUMBER" | "GITHUB_OUTPUT";

function readEnv(name: RequiredEnvName): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing ${name} environment variable.\n`);
    process.exit(1);
  }
  return value;
}

function normalizeLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("agent:")) {
    return trimmed.slice("agent:".length);
  }
  return trimmed;
}

type GitHubLabel = {
  name?: unknown;
};

function parseLabels(raw: string | undefined): GitHubLabel[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    process.stderr.write(
      `Failed to parse ISSUE_LABELS: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return [];
  }
}

function extractModelOverride(labels: GitHubLabel[]): string | null {
  for (const label of labels) {
    const rawName = typeof label.name === "string" ? label.name.trim() : "";
    if (rawName.toLowerCase().startsWith("model:")) {
      const value = rawName.slice("model:".length).trim();
      if (value) {
        return value;
      }
    }
  }
  return null;
}

export function emitOutputs(
  values: Record<string, string | number>,
  outputPath = readEnv("GITHUB_OUTPUT"),
  fileSystem: Pick<typeof fs, "appendFileSync" | "lstatSync"> = fs
): void {
  assertNotSymbolicLink(outputPath, fileSystem);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fileSystem.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function assertNotSymbolicLink(
  outputPath: string,
  fileSystem: Pick<typeof fs, "lstatSync">
): void {
  try {
    if (fileSystem.lstatSync(outputPath).isSymbolicLink()) {
      throw new Error(`Refusing to use symbolic link path: ${outputPath}`);
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function resolveProvider(label: string): ProviderMetadata {
  const normalized = normalizeLabel(label);
  const provider = PROVIDERS.get(normalized);
  if (!provider) {
    const suggestions = Array.from(PROVIDERS.keys()).join(", ");
    process.stderr.write(
      `Unsupported provider label: ${label}. Available providers: ${suggestions}\n`
    );
    process.exit(1);
  }
  return provider;
}

function buildBranch(service: string, issueNumber: string): string {
  const branchService = service.split(" ").join("-");
  return `agent/${branchService}/issue-${issueNumber}`;
}

function resolvePrLabel(rawLabel: string, service: string): string {
  const trimmed = rawLabel.trim();
  if (trimmed.startsWith("agent:")) {
    return trimmed;
  }
  return `agent:${service}`;
}

function main(): void {
  const label = readEnv("LABEL_NAME");
  const issueNumber = readEnv("ISSUE_NUMBER");
  const provider = resolveProvider(label);
  const labels = parseLabels(process.env.ISSUE_LABELS);
  const modelOverride = extractModelOverride(labels);
  emitOutputs({
    service: provider.service,
    ...(modelOverride ? { model: modelOverride } : {}),
    model_override: modelOverride ?? "",
    branch: buildBranch(provider.service, issueNumber),
    pr_label: resolvePrLabel(label, provider.service),
    exclude_reviewer: provider.service
  });
}

main();
