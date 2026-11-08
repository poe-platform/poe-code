import { color } from "./color.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { getTheme } from "../internal/theme-detect.js";
import { typography } from "../tokens/typography.js";

function renderMarkdownInline(content: string): string {
  return content.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

function renderMarkdownCode(content: string): string {
  const value = renderMarkdownInline(content);
  let longestRun = 0;
  let currentRun = 0;
  for (const char of value) {
    if (char === "`") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
      continue;
    }
    currentRun = 0;
  }
  const delimiter = "`".repeat(longestRun + 1);
  const paddedValue = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${delimiter}${paddedValue}${delimiter}`;
}

function renderMarkdownLink(content: string): string {
  const value = renderMarkdownInline(content);
  const label = value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
  const url = value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  return `[${label}](${url})`;
}

export const text = {
  intro(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `**${content}**`;
    return getTheme().intro(content);
  },
  heading(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `## ${content}`;
    return getTheme().header(content);
  },
  section(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `**${content}**`;
    return typography.bold(content);
  },
  sectionHeader(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `## ${content}`;
    return typography.bold(content.toUpperCase());
  },
  command(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return renderMarkdownCode(content);
    return getTheme().accent(content);
  },
  argument(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `<${content}>`;
    return getTheme().muted(content);
  },
  option(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return renderMarkdownCode(content);
    return color.yellow(content);
  },
  example(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return renderMarkdownCode(content);
    return getTheme().muted(content);
  },
  usageCommand(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return renderMarkdownCode(content);
    return color.green(content);
  },
  link(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return renderMarkdownLink(content);
    return getTheme().accent(content);
  },
  muted(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `*${content}*`;
    return getTheme().muted(content);
  },
  error(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `**${content}**`;
    return getTheme().error(content);
  },
  badge(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `[${content}]`;
    return getTheme().badge(content);
  },
  selectLabel(label: string, detail?: string): string {
    if (!detail) {
      return label;
    }
    const format = resolveOutputFormat();
    if (format !== "terminal") {
      return `${label} — ${detail}`;
    }
    return `${label} ${typography.dim("—")} ${typography.dim(detail)}`;
  }
} as const;
