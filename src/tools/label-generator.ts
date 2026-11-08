import type { ProviderService } from "../cli/service-registry.js";
import { getSpawnConfig } from "@poe-code/agent-spawn";

export interface ServiceLabelInfo {
  service: string;
  displayName: string;
  label: string;
  color: string;
  description: string;
}

export function collectSpawnLabels(
  adapters: ProviderService[]
): ServiceLabelInfo[] {
  const spawnable = adapters.filter(
    (adapter) => typeof adapter.spawn === "function" || getSpawnConfig(adapter.name)
  );
  const labels = spawnable.map((adapter) => {
    const colorSource =
      adapter.branding?.colors?.light ??
      adapter.branding?.colors?.dark ??
      "#000000";
    return {
      service: adapter.name,
      displayName: adapter.label,
      label: `agent:${adapter.name}`,
      color: normalizeColor(colorSource),
      description: `${adapter.label} automation label`
    };
  });
  return labels.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "en")
  );
}

export function renderLabelDocument(labels: ServiceLabelInfo[]): string {
  const workflowLabels = labels.map((entry) => ({
    name: entry.label,
    color: entry.color,
    description: entry.description
  }));

  const jsonBlock = JSON.stringify(workflowLabels, null, 2);
  const tableRows = labels
    .map(
      (entry) =>
        `| ${entry.displayName} | \`${entry.label}\` | \`#${entry.color}\` |`
    )
    .join("\n");

  const lines = [
    "# Agent Labels",
    "",
    "> Generated via `npm run labels:generate`. Do not edit manually.",
    "",
    "## GitHub Label Definitions",
    "",
    "```json",
    jsonBlock,
    "```",
    "",
    "## Services",
    "",
    "| Service | Label | Color |",
    "| --- | --- | --- |",
    tableRows,
    ""
  ];

  return lines.join("\n");
}

export function normalizeColor(source: string): string {
  if (!source) {
    return "000000";
  }
  const trimmed = source.trim();
  const withoutHash = trimmed.startsWith("#")
    ? trimmed.slice(1)
    : trimmed;

  let filtered = "";
  for (const char of withoutHash) {
    const code = char.codePointAt(0);
    if (!code) {
      continue;
    }
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 70;
    const isLower = code >= 97 && code <= 102;
    if (isDigit || isUpper || isLower) {
      filtered += char;
    }
  }

  if (filtered.length === 0) {
    return "000000";
  }

  const upper = filtered.toUpperCase();
  if (upper.length >= 6) {
    return upper.slice(0, 6);
  }

  const padded = `${upper}000000`.slice(0, 6);
  return padded;
}
