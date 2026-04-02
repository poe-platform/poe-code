import chalk from "chalk";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

function getVisibleWidth(value: string): number {
  return stripAnsi(value).length;
}

function renderTerminalNote(message: string, title?: string): string {
  const contentLines = ["", ...message.split("\n"), ""];
  const visibleTitle = stripAnsi(title ?? "");
  const contentWidth = Math.max(
    visibleTitle.length,
    ...contentLines.map((line) => getVisibleWidth(line))
  ) + 2;
  const titleLine = `${chalk.green("◇")}  ${chalk.reset(title ?? "")} ${chalk.gray(
    `${"─".repeat(Math.max(contentWidth - visibleTitle.length - 1, 1))}╮`
  )}`;
  const content = contentLines.map((line) => {
    const padding = " ".repeat(contentWidth - getVisibleWidth(line));
    return `${chalk.gray("│")}  ${line}${padding}${chalk.gray("│")}`;
  });
  const bottom = chalk.gray(`├${"─".repeat(contentWidth + 2)}╯`);

  return [chalk.gray("│"), titleLine, ...content, bottom].join("\n");
}

export function note(message: string, title?: string): void {
  const format = resolveOutputFormat();
  const strippedMessage = stripAnsi(message);
  const strippedTitle = stripAnsi(title ?? "");

  if (format === "markdown") {
    const lines = strippedMessage.split("\n");
    const heading = strippedTitle ? `> **${strippedTitle}**\n` : "";
    const body = lines.map((line) => `> ${line}`).join("\n");
    process.stdout.write(`${heading}${body}\n`);
    return;
  }

  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({
        type: "note",
        title: strippedTitle,
        message: strippedMessage
      })}\n`
    );
    return;
  }

  process.stdout.write(`${renderTerminalNote(message, title)}\n`);
}
