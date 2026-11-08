import { color } from "../../components/color.js";
import { text } from "../../components/text.js";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

export function intro(title: string): void {
  const format = resolveOutputFormat();
  if (format === "json") {
    return;
  }

  if (format === "markdown") {
    const safeTitle = stripAnsi(title).replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
    process.stdout.write(`# ${safeTitle}\n\n`);
    return;
  }

  process.stdout.write(`${color.gray("┌")}  ${text.intro(title)}\n`);
}
