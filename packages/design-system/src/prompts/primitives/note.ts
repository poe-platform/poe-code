import { color } from "../../components/color.js";
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
  const titleLine = `${color.green("◇")}  ${color.reset(title ?? "")} ${color.gray(
    `${"─".repeat(Math.max(contentWidth - visibleTitle.length - 1, 1))}╮`
  )}`;
  const content = contentLines.map((line) => {
    const padding = " ".repeat(contentWidth - getVisibleWidth(line));
    return `${color.gray("│")}  ${line}${padding}${color.gray("│")}`;
  });
  const bottom = color.gray(`├${"─".repeat(contentWidth + 2)}╯`);

  return [color.gray("│"), titleLine, ...content, bottom].join("\n");
}

export function note(message: string, title?: string): void {
  const format = resolveOutputFormat();
  const strippedMessage = stripAnsi(message);
  const strippedTitle = stripAnsi(title ?? "").replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");

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
