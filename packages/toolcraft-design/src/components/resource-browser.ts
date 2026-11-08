import { resolveOutputFormat } from "../internal/output-format.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import type { ThemePalette } from "../tokens/colors.js";

export interface ResourceBrowserItem {
  label: string;
  meta?: string[];
  preview?: string;
  badge?: string;
}

export interface ResourceBrowserGroup {
  title: string;
  description?: string;
  emptyHint?: string;
  items: ResourceBrowserItem[];
}

export interface RenderResourceBrowserOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  groups: ResourceBrowserGroup[];
  footer?: string;
}

export function renderResourceBrowser(options: RenderResourceBrowserOptions): string {
  switch (resolveOutputFormat()) {
    case "markdown":
      return renderMarkdown(options);
    case "json":
      return renderJson(options);
    default:
      return renderTerminal(options);
  }
}

function renderTerminal(options: RenderResourceBrowserOptions): string {
  const blocks = [renderTitle(options)];
  for (const group of options.groups) {
    blocks.push(renderTerminalGroup(options.theme, group));
  }
  if (options.footer !== undefined) {
    blocks.push(options.theme.muted(options.footer));
  }
  return blocks.join("\n\n");
}

function renderTitle(options: RenderResourceBrowserOptions): string {
  return [
    options.theme.header(options.title),
    options.subtitle === undefined ? undefined : options.theme.muted(options.subtitle)
  ].filter((value): value is string => value !== undefined).join("  ");
}

function renderTerminalGroup(theme: ThemePalette, group: ResourceBrowserGroup): string {
  const lines = [
    `${theme.header(group.title)}  ${theme.muted(String(group.items.length))}`,
    ...(group.description === undefined ? [] : [theme.muted(group.description)])
  ];
  if (group.items.length === 0) {
    lines.push(theme.muted(group.emptyHint ?? "No items"));
    return lines.join("\n");
  }
  for (const [index, item] of group.items.entries()) {
    lines.push(...renderTerminalItem(theme, item));
    if (index < group.items.length - 1) {
      lines.push("");
    }
  }
  return lines.join("\n");
}

function renderTerminalItem(theme: ThemePalette, item: ResourceBrowserItem): string[] {
  return [
    `${theme.accent(">")} ${theme.header(item.label)}${item.badge === undefined ? "" : `  ${theme.info(item.badge)}`}`,
    ...(item.meta === undefined || item.meta.length === 0 ? [] : [`  ${theme.muted(item.meta.join(" · "))}`]),
    ...(item.preview === undefined || item.preview.length === 0 ? [] : [`  ${theme.muted(item.preview)}`])
  ];
}

function renderMarkdown(options: RenderResourceBrowserOptions): string {
  const blocks = [`# ${stripAnsi(options.title)}`];
  if (options.subtitle !== undefined) {
    blocks.push(stripAnsi(options.subtitle));
  }
  for (const group of options.groups) {
    const lines = [`## ${stripAnsi(group.title)} (${group.items.length})`];
    if (group.description !== undefined) {
      lines.push(stripAnsi(group.description));
    }
    if (group.items.length === 0) {
      lines.push(stripAnsi(group.emptyHint ?? "No items"));
    } else {
      lines.push(...group.items.map((item) => renderMarkdownItem(item)));
    }
    blocks.push(lines.join("\n\n"));
  }
  if (options.footer !== undefined) {
    blocks.push(stripAnsi(options.footer));
  }
  return blocks.join("\n\n");
}

function renderMarkdownItem(item: ResourceBrowserItem): string {
  const meta = item.meta === undefined || item.meta.length === 0 ? "" : ` — ${item.meta.map(stripAnsi).join(" · ")}`;
  const preview = item.preview === undefined || item.preview.length === 0 ? "" : `: ${stripAnsi(item.preview)}`;
  return `- **${stripAnsi(item.label)}**${meta}${preview}`;
}

function renderJson(options: RenderResourceBrowserOptions): string {
  return JSON.stringify({
    title: stripAnsi(options.title),
    ...(options.subtitle === undefined ? {} : { subtitle: stripAnsi(options.subtitle) }),
    groups: options.groups.map((group) => ({
      title: stripAnsi(group.title),
      ...(group.description === undefined ? {} : { description: stripAnsi(group.description) }),
      ...(group.emptyHint === undefined ? {} : { emptyHint: stripAnsi(group.emptyHint) }),
      items: group.items.map((item) => ({
        label: stripAnsi(item.label),
        ...(item.meta === undefined ? {} : { meta: item.meta.map(stripAnsi) }),
        ...(item.preview === undefined ? {} : { preview: stripAnsi(item.preview) }),
        ...(item.badge === undefined ? {} : { badge: stripAnsi(item.badge) })
      }))
    })),
    ...(options.footer === undefined ? {} : { footer: stripAnsi(options.footer) })
  }, null, 2);
}
