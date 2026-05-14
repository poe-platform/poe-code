import chalk from "chalk";
import { resolveOutputFormat } from "../internal/output-format.js";
import { getTheme } from "../internal/theme-detect.js";
import { typography } from "../tokens/typography.js";

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
    if (format === "markdown") return `\`${content}\``;
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
    if (format === "markdown") return `\`${content}\``;
    return chalk.yellow(content);
  },
  example(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `\`${content}\``;
    return getTheme().muted(content);
  },
  usageCommand(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `\`${content}\``;
    return chalk.green(content);
  },
  link(content: string): string {
    const format = resolveOutputFormat();
    if (format === "json") return content;
    if (format === "markdown") return `[${content}](${content})`;
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
