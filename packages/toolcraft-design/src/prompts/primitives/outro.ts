import { color } from "../../components/color.js";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

export function outro(message: string): void {
  const format = resolveOutputFormat();
  const stripped = stripAnsi(message);

  if (format === "markdown") {
    process.stdout.write(`---\n${stripped}\n`);
    return;
  }

  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ type: "outro", message: stripped })}\n`
    );
    return;
  }

  process.stdout.write(`${color.gray("│")}\n${color.gray("└")}  ${message}\n\n`);
}
