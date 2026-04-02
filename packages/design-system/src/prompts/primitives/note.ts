import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

function getVisibleWidth(value: string): number {
  return stripAnsi(value).length;
}

function renderTerminalNote(message: string, title?: string): string {
  const messageLines = message.split("\n");
  const strippedLines = messageLines.map(stripAnsi);
  const visibleTitle = stripAnsi(title ?? "");
  const contentWidth = Math.max(
    visibleTitle.length,
    ...strippedLines.map((line) => line.length)
  );
  const topBorder = title
    ? `╭  ${title} ${"─".repeat(contentWidth - visibleTitle.length + 1)}╮`
    : `╭${"─".repeat(contentWidth + 4)}╮`;
  const content = messageLines.map((line) => {
    const padding = " ".repeat(contentWidth - getVisibleWidth(line));
    return `│  ${line}${padding}  │`;
  });

  return [topBorder, ...content, `╰${"─".repeat(contentWidth + 4)}╯`].join("\n");
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
