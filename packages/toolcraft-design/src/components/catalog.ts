import type { ThemePalette } from "../tokens/colors.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { text } from "./text.js";

export type CatalogTone = "accent" | "muted" | "success" | "warning" | "error" | "info";

export interface CatalogMetric {
  label: string;
  value: string | number;
  tone?: CatalogTone;
}

export interface CatalogItem {
  label: string;
  value: string;
  detail?: string;
  tone?: CatalogTone;
}

export interface CatalogGroup {
  title: string;
  description?: string;
  items: CatalogItem[];
}

export interface RenderCatalogOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  metrics?: CatalogMetric[];
  groups: CatalogGroup[];
}

function applyTone(theme: ThemePalette, value: string, tone?: CatalogTone): string {
  return tone === undefined ? value : theme[tone](value);
}

function renderMetrics(metrics: CatalogMetric[], theme: ThemePalette): string {
  return metrics
    .map((metric) => applyTone(theme, `${metric.value} ${metric.label}`, metric.tone))
    .join(theme.muted(" · "));
}

function renderTerminal(options: RenderCatalogOptions): string {
  const title = [
    options.theme.header(options.title),
    options.subtitle === undefined ? undefined : options.theme.muted(options.subtitle)
  ]
    .filter((value): value is string => value !== undefined)
    .join("  ");
  const blocks = [
    [title, options.metrics?.length ? renderMetrics(options.metrics, options.theme) : undefined]
      .filter((value): value is string => value !== undefined)
      .join("\n")
  ];

  for (const group of options.groups) {
    const labelWidth = Math.max(...group.items.map((item) => item.label.length), 0);
    const valueWidth = Math.max(...group.items.map((item) => item.value.length), 0);
    const lines = [
      `${options.theme.header(group.title)}  ${options.theme.muted(String(group.items.length))}`,
      ...(group.description === undefined ? [] : [options.theme.muted(group.description)]),
      ...group.items.map((item) => {
        const identity = `${applyTone(options.theme, item.label.padEnd(labelWidth), item.tone)}  ${item.value.padEnd(valueWidth)}`;
        return item.detail === undefined
          ? identity.trimEnd()
          : `${identity}  ${options.theme.muted(item.detail)}`;
      })
    ];
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}

function escapeMarkdown(value: string): string {
  return stripAnsi(value);
}

function renderMarkdown(options: RenderCatalogOptions): string {
  const blocks = [`# ${escapeMarkdown(options.title)}`];
  if (options.subtitle !== undefined) {
    blocks.push(escapeMarkdown(options.subtitle));
  }
  if (options.metrics?.length) {
    blocks.push(
      `**${options.metrics.map((metric) => `${metric.value} ${metric.label}`).join(" · ")}**`
    );
  }

  for (const group of options.groups) {
    const header = [`## ${escapeMarkdown(group.title)} (${group.items.length})`];
    if (group.description !== undefined) {
      header.push(escapeMarkdown(group.description));
    }
    const items = group.items.map((item) => {
      const detail = item.detail === undefined ? "" : ` — ${escapeMarkdown(item.detail)}`;
      return `- ${text.command(escapeMarkdown(item.label))} ${text.command(escapeMarkdown(item.value))}${detail}`;
    });
    blocks.push(`${header.join("\n\n")}\n\n${items.join("\n")}`);
  }

  return blocks.join("\n\n");
}

function renderJson(options: RenderCatalogOptions): string {
  return JSON.stringify(
    {
      title: stripAnsi(options.title),
      ...(options.subtitle === undefined ? {} : { subtitle: stripAnsi(options.subtitle) }),
      metrics: (options.metrics ?? []).map((metric) => ({
        ...metric,
        label: stripAnsi(metric.label),
        value: typeof metric.value === "string" ? stripAnsi(metric.value) : metric.value
      })),
      groups: options.groups.map((group) => ({
        title: stripAnsi(group.title),
        ...(group.description === undefined ? {} : { description: stripAnsi(group.description) }),
        items: group.items.map((item) => ({
          ...item,
          label: stripAnsi(item.label),
          value: stripAnsi(item.value),
          ...(item.detail === undefined ? {} : { detail: stripAnsi(item.detail) })
        }))
      }))
    },
    null,
    2
  );
}

export function renderCatalog(options: RenderCatalogOptions): string {
  switch (resolveOutputFormat()) {
    case "markdown":
      return renderMarkdown(options);
    case "json":
      return renderJson(options);
    default:
      return renderTerminal(options);
  }
}
